import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { sendCharityDonationThankYou } from '@/lib/charity-automation';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createAdminClient();
  const auth = await requireAdminPermission({
    supabase,
    request,
    permission: 'charity_manage',
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await Promise.resolve(context.params);

  const { data: donation, error: donationError } = await supabase
    .from('charity_donations')
    .select('*, charity_campaigns(*)')
    .eq('id', id)
    .single();

  if (donationError) {
    return NextResponse.json({ error: 'Donation not found' }, { status: 404 });
  }

  // Create thank you card record
  const { data: card, error: cardError } = await supabase
    .from('thank_you_cards')
    .insert([
      {
        donation_id: id,
        template_id: 'default',
        card_url: `/api/charity/thank-you-card/${id}.pdf`,
        sent_via_telegram: true,
        sent_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (cardError) {
    return NextResponse.json({ error: cardError.message }, { status: 500 });
  }

  // Update donation to mark card as generated
  await supabase
    .from('charity_donations')
    .update({ thank_you_card_generated: true, thank_you_card_sent_at: new Date().toISOString() })
    .eq('id', id);

  await sendCharityDonationThankYou(supabase, id, donation?.approval_status === 'approved' ? 'approved' : 'submitted');
  return NextResponse.json({ card });
}
