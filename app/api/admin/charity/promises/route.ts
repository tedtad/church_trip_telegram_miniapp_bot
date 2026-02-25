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

    const campaignId = String(request.nextUrl.searchParams.get('campaign') || '').trim();
    const status = String(request.nextUrl.searchParams.get('status') || '').trim().toLowerCase();
    const type = String(request.nextUrl.searchParams.get('type') || '').trim().toLowerCase();

    let query = supabase
      .from('charity_promises')
      .select('*, charity_campaigns(name, cause)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (campaignId) query = query.eq('campaign_id', campaignId);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('promise_type', type);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, promises: data || [] });
  } catch (error) {
    console.error('[admin-charity-promises] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load promises' }, { status: 500 });
  }
}
