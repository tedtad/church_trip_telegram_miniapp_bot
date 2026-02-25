import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sendCharityDonationThankYou } from '@/lib/charity-automation';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const body = await request.json();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const notes = String(body?.notes || '').trim();

  const { data, error } = await supabase
    .from('charity_donations')
    .update({
      approval_status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      approval_notes: notes,
    })
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaignId = String((data as any)?.campaign_id || '').trim();
  const amount = Number((data as any)?.donation_amount || 0);
  if (campaignId && amount > 0) {
    const { data: campaign } = await supabase
      .from('charity_campaigns')
      .select('id, collected_amount')
      .eq('id', campaignId)
      .maybeSingle();
    if (campaign) {
      const nextCollected = Number(campaign.collected_amount || 0) + amount;
      await supabase
        .from('charity_campaigns')
        .update({ collected_amount: Number(nextCollected.toFixed(2)), updated_at: new Date().toISOString() })
        .eq('id', campaignId);
    }
  }

  await sendCharityDonationThankYou(supabase, params.id, 'approved');
  return NextResponse.json({ donation: data });
}
