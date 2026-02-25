import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

export async function GET() {
  const supabase = await createClient();
  const appSettings = await getMiniAppRuntimeSettings(supabase);
  if (appSettings.maintenanceMode) {
    return NextResponse.json(
      { ok: false, error: 'MINIAPP_MAINTENANCE', message: getMiniAppMaintenanceMessage(appSettings) },
      { status: 503 }
    );
  }
  if (!appSettings.charityEnabled) {
    return NextResponse.json({ ok: false, error: 'Charity module is currently disabled.' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('charity_campaigns')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[v0] Error fetching campaigns:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, campaigns: data || [] });
}
