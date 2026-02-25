'use client'

import { useEffect, useMemo, useState } from 'react'
import { Heart, CheckCircle, XCircle, Download, Loader, Plus, Mail, FileText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Campaign {
  id: string
  name: string
  cause: string
  description: string
  goal_amount: number
  collected_amount: number
  status: string
  created_at: string
  telegram_channel_url?: string | null
  telegram_group_url?: string | null
}

interface Donation {
  id: string
  campaign_id: string
  donor_name: string
  donor_phone: string
  donation_amount: number
  payment_method: string
  reference_number: string
  approval_status: string
  approved_by: string
  thank_you_card_generated: boolean
  created_at: string
}

export default function CharityPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'campaigns' | 'donations'>('campaigns')
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null)
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [runningSummary, setRunningSummary] = useState(false)
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    cause: '',
    description: '',
    goal_amount: '',
  })

  const summary = useMemo(() => {
    const totalCampaigns = campaigns.length
    const activeCampaigns = campaigns.filter((campaign) => {
      const status = String(campaign.status || '').toLowerCase()
      return !['closed', 'completed', 'inactive', 'archived'].includes(status)
    }).length
    const totalGoal = campaigns.reduce((sum, campaign) => sum + Number(campaign.goal_amount || 0), 0)
    const totalCollected = campaigns.reduce((sum, campaign) => sum + Number(campaign.collected_amount || 0), 0)
    const totalDonations = donations.length
    const pendingDonations = donations.filter((d) => d.approval_status === 'pending').length
    const approvedDonations = donations.filter((d) => d.approval_status === 'approved').length
    const rejectedDonations = donations.filter((d) => d.approval_status === 'rejected').length
    const approvedAmount = donations
      .filter((d) => d.approval_status === 'approved')
      .reduce((sum, donation) => sum + Number(donation.donation_amount || 0), 0)
    const approvalRate = totalDonations > 0 ? (approvedDonations / totalDonations) * 100 : 0

    return {
      totalCampaigns,
      activeCampaigns,
      totalGoal,
      totalCollected,
      totalDonations,
      pendingDonations,
      approvedDonations,
      rejectedDonations,
      approvedAmount,
      approvalRate,
    }
  }, [campaigns, donations])

  useEffect(() => {
    loadData()
  }, [selectedCampaign])

  async function loadData() {
    try {
      setLoading(true)
      const [campaignsRes, donationsRes] = await Promise.all([
        fetch('/api/admin/charity/campaigns'),
        selectedCampaign
          ? fetch(`/api/admin/charity/donations?campaign=${selectedCampaign}`)
          : fetch('/api/admin/charity/donations'),
      ])

      if (campaignsRes.ok) {
        const data = await campaignsRes.json()
        setCampaigns(data.campaigns || [])
      }

      if (donationsRes.ok) {
        const data = await donationsRes.json()
        setDonations(data.donations || [])
      }
    } catch (err) {
      console.error('[v0] Error loading charity data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function createCampaign() {
    if (!newCampaign.name || !newCampaign.cause || !newCampaign.goal_amount) {
      alert('Please fill in all required fields')
      return
    }

    try {
      const res = await fetch('/api/admin/charity/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCampaign),
      })

      if (res.ok) {
        setNewCampaign({ name: '', cause: '', description: '', goal_amount: '' })
        setShowNewCampaign(false)
        loadData()
      }
    } catch (err) {
      console.error('[v0] Error creating campaign:', err)
    }
  }

  async function approveDonation(donationId: string) {
    const notes = prompt('Approval notes (optional):')
    if (notes === null) return

    try {
      const res = await fetch(`/api/admin/charity/donations/${donationId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })

      if (res.ok) {
        loadData()
      }
    } catch (err) {
      console.error('[v0] Error approving donation:', err)
    }
  }

  async function rejectDonation(donationId: string) {
    const reason = prompt('Rejection reason:')
    if (reason === null) return

    try {
      const res = await fetch(`/api/admin/charity/donations/${donationId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })

      if (res.ok) {
        loadData()
      }
    } catch (err) {
      console.error('[v0] Error rejecting donation:', err)
    }
  }

  async function generateThankYouCard(donationId: string) {
    try {
      const res = await fetch(`/api/admin/charity/donations/${donationId}/thank-you-card`, {
        method: 'POST',
      })

      if (res.ok) {
        loadData()
        alert('Thank you card generated and sent')
      }
    } catch (err) {
      console.error('[v0] Error generating thank you card:', err)
    }
  }

  async function exportToCSV() {
    try {
      const query = selectedCampaign ? `?campaign=${selectedCampaign}` : ''
      const res = await fetch(`/api/admin/charity/export${query}`)

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `charity-donations-${new Date().toISOString().split('T')[0]}.csv`
        a.click()
      }
    } catch (err) {
      console.error('[v0] Error exporting data:', err)
    }
  }

  async function runRankingSummary() {
    try {
      setRunningSummary(true)
      const response = await fetch('/api/cron/telegram/charity-updates?manual=true&force=true', {
        method: 'POST',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to run charity ranking job')
      }
      alert(`Charity ranking post executed. Posted: ${data?.posted ? 'yes' : 'no'}`)
    } catch (error) {
      alert((error as Error)?.message || 'Failed to run charity ranking job')
    } finally {
      setRunningSummary(false)
    }
  }

  if (loading && campaigns.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Heart className="w-8 h-8 text-red-500" />
          Charity Management
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className="bg-slate-900/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardDescription>Total Campaigns</CardDescription>
            <CardTitle className="text-2xl">{summary.totalCampaigns}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-400">
            Active: {summary.activeCampaigns}
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardDescription>Campaign Collection</CardDescription>
            <CardTitle className="text-2xl">ETB {summary.totalCollected.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-400">
            Goal: ETB {summary.totalGoal.toLocaleString()}
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardDescription>Donations</CardDescription>
            <CardTitle className="text-2xl">{summary.totalDonations}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-400">
            Pending: {summary.pendingDonations} | Approved: {summary.approvedDonations}
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardDescription>Approved Amount</CardDescription>
            <CardTitle className="text-2xl">ETB {summary.approvedAmount.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-400">
            Approval rate: {summary.approvalRate.toFixed(1)}% | Rejected: {summary.rejectedDonations}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'campaigns'
              ? 'border-b-2 border-cyan-500 text-cyan-500'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Campaigns
        </button>
        <button
          onClick={() => setActiveTab('donations')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'donations'
              ? 'border-b-2 border-cyan-500 text-cyan-500'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Donations
        </button>
      </div>

      {activeTab === 'campaigns' ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Active Campaigns</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={runRankingSummary}
                disabled={runningSummary}
              >
                {runningSummary ? 'Posting...' : 'Post Ranking Summary'}
              </Button>
              <Button
                onClick={() => setShowNewCampaign(!showNewCampaign)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                New Campaign
              </Button>
            </div>
          </div>

          {showNewCampaign && (
            <Card className="bg-slate-900/50 border-slate-700">
              <CardHeader>
                <CardTitle>Create New Campaign</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm mb-1">Campaign Name</label>
                  <input
                    type="text"
                    value={newCampaign.name}
                    onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Cause</label>
                  <input
                    type="text"
                    value={newCampaign.cause}
                    onChange={(e) => setNewCampaign({ ...newCampaign, cause: e.target.value })}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Description</label>
                  <textarea
                    value={newCampaign.description}
                    onChange={(e) => setNewCampaign({ ...newCampaign, description: e.target.value })}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Goal Amount (ETB)</label>
                  <input
                    type="number"
                    value={newCampaign.goal_amount}
                    onChange={(e) => setNewCampaign({ ...newCampaign, goal_amount: e.target.value })}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={createCampaign} className="flex-1">
                    Create Campaign
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowNewCampaign(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {campaigns.map((campaign) => (
              <Card
                key={campaign.id}
                className="bg-slate-900/50 border-slate-700 cursor-pointer hover:border-slate-500"
                onClick={() => {
                  setSelectedCampaign(campaign.id)
                  setActiveTab('donations')
                }}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{campaign.name}</span>
                    <span className="text-sm font-normal text-slate-400">{campaign.status}</span>
                  </CardTitle>
                  <CardDescription>{campaign.cause}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                      {campaign.description && (
                        <p className="text-sm text-slate-300">{campaign.description}</p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs">
                        {campaign.telegram_channel_url ? (
                          <a
                            href={campaign.telegram_channel_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-300 underline"
                          >
                            Campaign Channel
                          </a>
                        ) : null}
                        {campaign.telegram_group_url ? (
                          <a
                            href={campaign.telegram_group_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-300 underline"
                          >
                            Campaign Group
                          </a>
                        ) : null}
                      </div>
                      <div className="flex justify-between text-sm">
                      <span className="text-slate-400">
                        Goal: ETB {campaign.goal_amount.toLocaleString()}
                      </span>
                      <span className="text-green-400">
                        Collected: ETB {campaign.collected_amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{
                          width: `${Math.min(
                            (campaign.collected_amount / campaign.goal_amount) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              {selectedCampaign
                ? campaigns.find((c) => c.id === selectedCampaign)?.name
                : 'All Donations'}
            </h2>
            <div className="flex gap-2">
              {selectedCampaign && (
                <Button
                  variant="outline"
                  onClick={() => setSelectedCampaign(null)}
                  className="text-xs"
                >
                  Clear Filter
                </Button>
              )}
              <Button onClick={exportToCSV} className="gap-2">
                <Download className="w-4 h-4" />
                Export CSV
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Donor</th>
                  <th className="text-left py-3 px-4 font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 font-semibold">Reference</th>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 font-semibold">Card</th>
                  <th className="text-right py-3 px-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {donations.map((donation) => (
                  <tr key={donation.id} className="border-b border-slate-700 hover:bg-slate-900/30">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium">{donation.donor_name}</p>
                        <p className="text-xs text-slate-400">{donation.donor_phone}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      ETB {donation.donation_amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-400">
                      {donation.reference_number}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                          donation.approval_status === 'approved'
                            ? 'bg-green-900/50 text-green-300'
                            : donation.approval_status === 'rejected'
                              ? 'bg-red-900/50 text-red-300'
                              : 'bg-yellow-900/50 text-yellow-300'
                        }`}
                      >
                        {donation.approval_status === 'approved' && (
                          <CheckCircle className="w-3 h-3" />
                        )}
                        {donation.approval_status === 'rejected' && <XCircle className="w-3 h-3" />}
                        {donation.approval_status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {donation.thank_you_card_generated ? (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Sent
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex gap-1 justify-end">
                        {donation.approval_status === 'pending' && (
                          <>
                            <button
                              onClick={() => approveDonation(donation.id)}
                              className="p-1 rounded hover:bg-green-900/30 text-green-400"
                              title="Approve"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => rejectDonation(donation.id)}
                              className="p-1 rounded hover:bg-red-900/30 text-red-400"
                              title="Reject"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {donation.approval_status === 'approved' && !donation.thank_you_card_generated && (
                          <button
                            onClick={() => generateThankYouCard(donation.id)}
                            className="p-1 rounded hover:bg-blue-900/30 text-blue-400"
                            title="Generate Thank You Card"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
