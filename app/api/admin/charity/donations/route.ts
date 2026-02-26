import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const supabase = await createAdminClient();
  const auth = await requireAdminPermission({
    supabase,
    request,
    permission: 'charity_manage',
  });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const campaign = request.nextUrl.searchParams.get('campaign');

  let query = supabase
    .from('charity_donations')
    .select('*, charity_campaigns(name, cause)');

  if (campaign) {
    query = query.eq('campaign_id', campaign);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ donations: data || [] });
}
