import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import {
  canActorApproveManualCash,
  computeAdminCashRemittance,
  computeAdminCashSales,
  isMissingColumn,
  loadManualCashApproverRole,
} from '@/lib/manual-cash';

const MAX_RECEIPT_BYTES = 6 * 1024 * 1024;

function parseDataUrl(dataUrl: string) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || '').trim().toLowerCase();
  const base64Data = String(match[2] || '').replace(/\s+/g, '');
  if (!mimeType || !base64Data) return null;
  return { mimeType, base64Data };
}

function estimateBase64Bytes(base64Data: string) {
  const cleaned = String(base64Data || '').replace(/\s+/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function extensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'application/pdf') return '.pdf';
  return '.jpg';
}

async function insertRemittanceWithFallback(supabase: any, payload: Record<string, unknown>) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await supabase.from('manual_cash_remittances').insert(working).select('*').single();
    if (!result.error) return result.data || null;
    const missingCandidates = [
      'already_remitted_amount',
      'outstanding_amount',
      'bank_receipt_url',
      'bank_receipt_file_name',
      'approval_status',
      'updated_at',
      'notes',
    ];
    const missing = missingCandidates.find((column) => isMissingColumn(result.error, column));
    if (!missing || !(missing in working)) break;
    delete (working as any)[missing];
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'reports_view',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const approverRole = await loadManualCashApproverRole(supabase);
    const canApprove = canActorApproveManualCash(auth.actor.role, approverRole);
    const scope = String(request.nextUrl.searchParams.get('scope') || '').trim().toLowerCase();
    const status = String(request.nextUrl.searchParams.get('status') || '').trim().toLowerCase();

    let query = supabase
      .from('manual_cash_remittances')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (!canApprove || scope === 'mine') {
      query = query.eq('submitted_by_admin_id', auth.actor.id);
    }
    if (status) {
      query = query.eq('approval_status', status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      canApprove,
      approverRole,
      remittances: data || [],
    });
  } catch (error) {
    console.error('[admin-manual-cash-remittances] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load remittances' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'tickets_manual_sale',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const methodInput = String(body?.remittanceMethod || body?.method || '').trim().toLowerCase();
    const remittanceMethod = methodInput === 'bank_deposit' ? 'bank_deposit' : 'cash_handover';
    const remittedAmountRaw = Number(body?.remittedAmount || 0);
    const remittedAmount =
      Number.isFinite(remittedAmountRaw) && remittedAmountRaw > 0
        ? Number(remittedAmountRaw.toFixed(2))
        : 0;
    const notes = String(body?.notes || '').trim();
    const bankReceiptUrlInput = String(body?.bankReceiptUrl || '').trim();
    const bankReceiptFileNameInput = String(body?.bankReceiptFileName || '').trim();
    const bankReceiptDataUrl = String(body?.bankReceiptDataUrl || '').trim();

    if (remittedAmount <= 0) {
      return NextResponse.json({ ok: false, error: 'Remitted amount must be greater than zero' }, { status: 400 });
    }

    const sales = await computeAdminCashSales(supabase, auth.actor.id);
    const remittance = await computeAdminCashRemittance(supabase, auth.actor.id);
    const outstandingAmount = Math.max(0, Number((sales.totalCashSold - remittance.approvedRemittedAmount).toFixed(2)));

    if (outstandingAmount <= 0) {
      return NextResponse.json({ ok: false, error: 'No outstanding cash amount to remit' }, { status: 400 });
    }
    if (remittedAmount + 0.0001 < outstandingAmount) {
      return NextResponse.json(
        {
          ok: false,
          error: `Submitted amount is below outstanding balance. Outstanding: ${outstandingAmount.toFixed(2)}`,
          outstandingAmount,
        },
        { status: 400 }
      );
    }

    let bankReceiptUrl = bankReceiptUrlInput || '';
    let bankReceiptFileName = bankReceiptFileNameInput || null;
    if (remittanceMethod === 'bank_deposit') {
      if (!bankReceiptUrl && !bankReceiptDataUrl) {
        return NextResponse.json({ ok: false, error: 'Bank receipt link or file is required' }, { status: 400 });
      }

      if (!bankReceiptUrl && bankReceiptDataUrl) {
        const parsed = parseDataUrl(bankReceiptDataUrl);
        if (!parsed) {
          return NextResponse.json({ ok: false, error: 'Invalid receipt file payload' }, { status: 400 });
        }
        const receiptBytes = estimateBase64Bytes(parsed.base64Data);
        if (receiptBytes <= 0 || receiptBytes > MAX_RECEIPT_BYTES) {
          return NextResponse.json({ ok: false, error: 'Receipt file size is invalid' }, { status: 400 });
        }

        const extension = extensionFromMime(parsed.mimeType);
        const fileName =
          bankReceiptFileNameInput || `manual_cash_receipt_${Date.now()}${extension}`;
        const path = `manual-cash/${auth.actor.id}/${Date.now()}-${fileName.replace(/[^\w.-]+/g, '_')}`;
        const binary = Buffer.from(parsed.base64Data, 'base64');
        const uploadResult = await supabase.storage.from('receipts').upload(path, binary, {
          upsert: false,
          contentType: parsed.mimeType,
        });
        if (uploadResult.error) {
          return NextResponse.json({ ok: false, error: 'Failed to upload bank receipt' }, { status: 500 });
        }
        bankReceiptUrl = String(uploadResult.data?.path || path);
        bankReceiptFileName = fileName;
      }
    }

    const remittanceRecord = await insertRemittanceWithFallback(supabase, {
      submitted_by_admin_id: auth.actor.id,
      total_cash_sold: sales.totalCashSold,
      already_remitted_amount: remittance.approvedRemittedAmount,
      outstanding_amount: outstandingAmount,
      remitted_amount: remittedAmount,
      remittance_method: remittanceMethod,
      bank_receipt_url: bankReceiptUrl || null,
      bank_receipt_file_name: bankReceiptFileName || null,
      notes: notes || null,
      approval_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    if (!remittanceRecord?.id) {
      return NextResponse.json({ ok: false, error: 'Failed to create remittance request' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      remittance: remittanceRecord,
      summary: {
        totalCashSold: sales.totalCashSold,
        approvedRemittedAmount: remittance.approvedRemittedAmount,
        outstandingAmount,
      },
    });
  } catch (error) {
    console.error('[admin-manual-cash-remittances] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to submit remittance' }, { status: 500 });
  }
}
