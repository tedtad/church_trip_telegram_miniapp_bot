import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const campaign = request.nextUrl.searchParams.get('campaign');

  let query = supabase
    .from('charity_donations')
    .select('id, donor_name, donor_phone, donation_amount, payment_method, reference_number, approval_status, created_at, charity_campaigns(name)')

  if (campaign) query = query.eq('campaign_id', campaign);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Convert to CSV
  const headers = ['Donor Name', 'Phone', 'Amount (ETB)', 'Payment Method', 'Reference #', 'Status', 'Campaign', 'Date']
  const rows = (data || []).map((d: any) => [
    d.donor_name,
    d.donor_phone,
    d.donation_amount,
    d.payment_method,
    d.reference_number,
    d.approval_status,
    d.charity_campaigns?.name || 'N/A',
    new Date(d.created_at).toLocaleString(),
  ])

  const csv = [headers, ...rows]
    .map((row) => row.map((cell: string | number) => `"${cell}"`).join(','))
    .join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="charity-donations-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
