import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { analyzeReceiptSubmission, normalizeReferenceToken, parseReceiptDateToken } from '@/lib/receipt-intelligence';

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

async function insertSample(supabase: any, payload: Record<string, unknown>) {
  let workingPayload: Record<string, unknown> = { ...payload };
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const result = await supabase.from('receipt_intelligence_samples').insert(workingPayload).select('*').single();
    if (!result.error) return result;

    const missingColumn = detectMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in workingPayload)) {
      return result;
    }
    delete workingPayload[missingColumn];
  }

  return { data: null, error: new Error('Failed to insert sample') };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'settings_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const limit = Math.max(1, Math.min(500, Number(request.nextUrl.searchParams.get('limit') || 100)));
    const { data, error } = await supabase
      .from('receipt_intelligence_samples')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, samples: data || [] });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load samples' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'settings_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const paymentMethod = String(body?.paymentMethod || '').trim();
    const receiptLink = String(body?.receiptLink || '').trim();
    const referenceInput = normalizeReferenceToken(body?.referenceNumber);
    const receiptDateInput = parseReceiptDateToken(body?.receiptDate);
    const amountPaid = Number(body?.amountPaid || 0);
    const strict = body?.strict === true;
    const label = String(body?.label || '').trim() || null;

    const analysis = analyzeReceiptSubmission({
      receiptLink,
      referenceInput,
      receiptDateInput,
      amountPaid: Number.isFinite(amountPaid) && amountPaid > 0 ? amountPaid : 0,
      strict,
    });
    if (analysis.error) {
      return NextResponse.json({ ok: false, error: analysis.error, analysis }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      source_type: 'admin_seed',
      payment_method: paymentMethod || null,
      provider: analysis.link.provider || null,
      receipt_link: analysis.link.url || null,
      reference_input: referenceInput || null,
      extracted_reference: analysis.link.reference || analysis.reference || null,
      amount_input: Number.isFinite(amountPaid) ? Number(amountPaid.toFixed(2)) : null,
      extracted_amount: analysis.link.amount,
      receipt_date_input: receiptDateInput || null,
      extracted_date: analysis.link.date || null,
      validation_mode: strict ? 'rules' : 'basic',
      validation_score: Number(analysis.score.toFixed(2)),
      validation_flags: analysis.flags,
      verdict: 'pending',
      label,
    };

    const inserted = await insertSample(supabase, payload);
    if (inserted.error || !inserted.data) {
      return NextResponse.json(
        { ok: false, error: (inserted.error as any)?.message || 'Failed to store sample' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, sample: inserted.data, analysis });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to save sample' },
      { status: 500 }
    );
  }
}
