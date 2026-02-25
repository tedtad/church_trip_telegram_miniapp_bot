import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

type StatementEntry = {
  reference: string;
  amount: number;
};

function normalizeReference(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function toBaseReference(value: string) {
  return String(value || '').replace(/-\d{6}$/, '');
}

function parseCsvRows(csvText: string): StatementEntry[] {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const rows = lines[0].toLowerCase().includes('reference') ? lines.slice(1) : lines;
  const entries: StatementEntry[] = [];
  for (const row of rows) {
    const cells = row.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const reference = normalizeReference(cells[0] || '');
    const amountValue = Number(cells[1] || 0);
    if (!reference || !Number.isFinite(amountValue) || amountValue <= 0) continue;
    entries.push({ reference, amount: amountValue });
  }
  return entries;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'reconciliation_view',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const csvText = String(body?.csvText || '').trim();
    const providedEntries = Array.isArray(body?.entries) ? body.entries : [];
    const entries: StatementEntry[] = providedEntries.length
      ? providedEntries
          .map((entry: any) => ({
            reference: normalizeReference(entry?.reference),
            amount: Number(entry?.amount || 0),
          }))
          .filter((entry: StatementEntry) => entry.reference && Number.isFinite(entry.amount) && entry.amount > 0)
      : parseCsvRows(csvText);

    if (!entries.length) {
      return NextResponse.json({ ok: false, error: 'No statement entries found' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('receipts')
      .select('id, reference_number, amount_paid, approval_status, payment_method, created_at')
      .order('created_at', { ascending: false })
      .limit(20000);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const receiptMap = new Map<string, any>();
    const baseMap = new Map<string, any>();
    for (const row of data || []) {
      const reference = normalizeReference((row as any).reference_number || '');
      if (!reference) continue;
      if (!receiptMap.has(reference)) receiptMap.set(reference, row);
      const base = toBaseReference(reference);
      if (!baseMap.has(base)) baseMap.set(base, row);
    }

    const matched: Array<Record<string, unknown>> = [];
    const missing: Array<Record<string, unknown>> = [];
    const mismatched: Array<Record<string, unknown>> = [];

    for (const entry of entries) {
      const byExact = receiptMap.get(entry.reference);
      const byBase = baseMap.get(toBaseReference(entry.reference));
      const receipt = byExact || byBase;
      if (!receipt) {
        missing.push(entry);
        continue;
      }

      const recorded = Number((receipt as any).amount_paid || 0);
      const delta = Math.abs(recorded - entry.amount);
      if (delta > 1) {
        mismatched.push({
          reference: entry.reference,
          statementAmount: entry.amount,
          recordedAmount: Number(recorded.toFixed(2)),
          receiptReference: String((receipt as any).reference_number || ''),
          approvalStatus: String((receipt as any).approval_status || ''),
          paymentMethod: String((receipt as any).payment_method || ''),
        });
        continue;
      }

      matched.push({
        reference: entry.reference,
        statementAmount: entry.amount,
        receiptReference: String((receipt as any).reference_number || ''),
        recordedAmount: Number(recorded.toFixed(2)),
        approvalStatus: String((receipt as any).approval_status || ''),
        paymentMethod: String((receipt as any).payment_method || ''),
      });
    }

    return NextResponse.json({
      ok: true,
      summary: {
        entries: entries.length,
        matched: matched.length,
        missing: missing.length,
        mismatched: mismatched.length,
      },
      matched,
      missing,
      mismatched,
    });
  } catch (error) {
    console.error('[admin-reconciliation-match] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to reconcile statement' }, { status: 500 });
  }
}
