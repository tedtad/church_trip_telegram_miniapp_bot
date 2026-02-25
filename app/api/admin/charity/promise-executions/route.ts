import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'charity_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const status = String(request.nextUrl.searchParams.get('status') || '').trim().toLowerCase();
    const type = String(request.nextUrl.searchParams.get('type') || '').trim().toLowerCase();
    const campaignId = String(request.nextUrl.searchParams.get('campaign') || '').trim();

    let query = supabase
      .from('charity_promise_executions')
      .select('*, charity_promises(id, donor_name, donor_phone, promise_type, campaign_id), charity_campaigns(name, cause)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (status) query = query.eq('approval_status', status);
    if (type) query = query.eq('execution_type', type);
    if (campaignId) query = query.eq('campaign_id', campaignId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, executions: data || [] });
  } catch (error) {
    console.error('[admin-charity-promise-executions] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load promise executions' }, { status: 500 });
  }
}
