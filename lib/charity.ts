import { createClient } from '@/lib/supabase/server'

export interface CharityCampaign {
  id: string
  name: string
  description: string
  cause: string
  goal_amount: number
  collected_amount: number
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  start_date: string
  end_date: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface CharityDonation {
  id: string
  campaign_id: string
  telegram_user_id: bigint
  donor_name: string
  donor_phone: string
  donation_amount: number
  payment_method: string
  reference_number: string
  receipt_file_url: string
  receipt_file_name: string
  uploaded_at: string
  approval_status: 'pending' | 'approved' | 'rejected'
  approval_notes: string
  approved_by: string
  approved_at: string
  rejection_reason: string
  thank_you_card_generated: boolean
  thank_you_card_sent_at: string
  created_at: string
  updated_at: string
}

export interface ThankYouCard {
  id: string
  donation_id: string
  template_id: string
  card_url: string
  sent_via_telegram: boolean
  sent_at: string
  viewed_at: string
  created_at: string
  updated_at: string
}

export async function getActiveCampaigns() {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_campaigns')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[v0] Error fetching campaigns:', error)
    return []
  }

  return data as CharityCampaign[]
}

export async function getCampaignById(id: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_campaigns')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[v0] Error fetching campaign:', error)
    return null
  }

  return data as CharityCampaign
}

export async function createDonation(donation: Omit<CharityDonation, 'id' | 'created_at' | 'updated_at'>) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_donations')
    .insert([donation])
    .select()
    .single()

  if (error) {
    console.error('[v0] Error creating donation:', error)
    throw error
  }

  return data as CharityDonation
}

export async function getDonationsByUser(telegramUserId: bigint) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_donations')
    .select('*, charity_campaigns(*)')
    .eq('telegram_user_id', telegramUserId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[v0] Error fetching user donations:', error)
    return []
  }

  return data
}

export async function approveDonation(
  donationId: string,
  adminId: string,
  notes: string
) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_donations')
    .update({
      approval_status: 'approved',
      approved_by: adminId,
      approved_at: new Date().toISOString(),
      approval_notes: notes,
    })
    .eq('id', donationId)
    .select()
    .single()

  if (error) {
    console.error('[v0] Error approving donation:', error)
    throw error
  }

  return data as CharityDonation
}

export async function rejectDonation(
  donationId: string,
  adminId: string,
  reason: string
) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_donations')
    .update({
      approval_status: 'rejected',
      approved_by: adminId,
      approved_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', donationId)
    .select()
    .single()

  if (error) {
    console.error('[v0] Error rejecting donation:', error)
    throw error
  }

  return data as CharityDonation
}

export async function getCampaignStats(campaignId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('charity_donations')
    .select('donation_amount, approval_status')
    .eq('campaign_id', campaignId)
    .eq('approval_status', 'approved')

  if (error) {
    console.error('[v0] Error fetching campaign stats:', error)
    return { totalDonations: 0, totalAmount: 0, donorCount: 0 }
  }

  const totalAmount = data?.reduce((sum, d) => sum + d.donation_amount, 0) || 0
  const totalDonations = data?.length || 0

  return { totalDonations, totalAmount, donorCount: totalDonations }
}

export async function generateThankYouCard(donationId: string) {
  const supabase = createClient()

  // Get donation details
  const { data: donation, error: donationError } = await supabase
    .from('charity_donations')
    .select('*, charity_campaigns(*)')
    .eq('id', donationId)
    .single()

  if (donationError) {
    console.error('[v0] Error fetching donation for thank you card:', donationError)
    throw donationError
  }

  // Create thank you card record
  const { data: card, error: cardError } = await supabase
    .from('thank_you_cards')
    .insert([
      {
        donation_id: donationId,
        template_id: 'default',
        card_url: `/api/charity/thank-you-card/${donationId}.pdf`,
      },
    ])
    .select()
    .single()

  if (cardError) {
    console.error('[v0] Error creating thank you card:', cardError)
    throw cardError
  }

  // Update donation to mark card as generated
  await supabase
    .from('charity_donations')
    .update({ thank_you_card_generated: true })
    .eq('id', donationId)

  return card as ThankYouCard
}
