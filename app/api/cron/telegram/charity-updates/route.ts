import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { postCharityFinalCampaignSummaries, postCharityRankingSummary } from '@/lib/charity-automation';

const CRON_SECRET = String(process.env.TELEGRAM_CRON_SECRET || process.env.CRON_SECRET || '').trim();

function isAuthorized(request: NextRequest) {
  const manual = request.nextUrl.searchParams.get('manual') === 'true';
  const vercelCron = String(request.headers.get('x-vercel-cron') || '').trim() === '1';
  const providedSecret =
    String(request.headers.get('x-cron-secret') || '').trim() ||
    String(request.nextUrl.searchParams.get('secret') || '').trim();
  const adminHeader = String(request.headers.get('x-admin-id') || '').trim();

  if (vercelCron) return true;
  if (!CRON_SECRET) return manual ? Boolean(adminHeader) : true;
  if (providedSecret && providedSecret === CRON_SECRET) return true;
  if (manual && adminHeader) return true;
  return false;
}

async function runJob(request: NextRequest) {
  const force = request.nextUrl.searchParams.get('force') === 'true';
  const supabase = await createAdminClient();
  const result = await postCharityRankingSummary(supabase, force);
  const final = await postCharityFinalCampaignSummaries(supabase);
  return NextResponse.json({
    ok: true,
    posted: result.posted,
    finalPosted: final.posted,
    force,
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runJob(request);
  } catch (error) {
    console.error('[cron-charity-updates] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runJob(request);
  } catch (error) {
    console.error('[cron-charity-updates] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
