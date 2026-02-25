import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sendCharityDonationThankYou } from '@/lib/charity-automation';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();

  const { data: donation, error: donationError } = await supabase
    .from('charity_donations')
    .select('*, charity_campaigns(*)')
    .eq('id', params.id)
    .single();

  if (donationError) {
    return NextResponse.json({ error: 'Donation not found' }, { status: 404 });
  }

  // Create thank you card record
  const { data: card, error: cardError } = await supabase
    .from('thank_you_cards')
    .insert([
      {
        donation_id: params.id,
        template_id: 'default',
        card_url: `/api/charity/thank-you-card/${params.id}.pdf`,
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
    .eq('id', params.id);

  await sendCharityDonationThankYou(supabase, params.id, donation?.approval_status === 'approved' ? 'approved' : 'submitted');
  return NextResponse.json({ card });
}
