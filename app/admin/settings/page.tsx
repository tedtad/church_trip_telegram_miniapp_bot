'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Upload, Save, AlertCircle, CheckCircle, Send } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-auth'

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    id: 'default',
    app_name: 'TicketHub',
    app_description: 'Telegram Ticket Reservation System',
    app_color: '#06b6d4',
    logo_url: null as string | null,
    receipt_cache_ttl: 3600,
    max_file_size: 10,
    maintenance_mode: false,
    telegram_channel_url: '',
    telegram_channel_chat_id: '',
    telegram_channel_name: '',
    telegram_post_new_trip: true,
    telegram_post_weekly_summary: true,
    telegram_post_daily_countdown: true,
    telegram_recommendation_interval_hours: 24,
    charity_channel_chat_id: '',
    charity_channel_url: '',
    charity_group_chat_id: '',
    charity_group_url: '',
    charity_auto_post_new_campaign: true,
    charity_auto_post_summary: true,
    gnpl_enabled: false,
    gnpl_require_admin_approval: true,
    gnpl_default_term_days: 14,
    gnpl_penalty_enabled: true,
    gnpl_penalty_percent: 5,
    gnpl_penalty_period_days: 7,
    gnpl_reminder_enabled: true,
    gnpl_reminder_days_before: 0,
    receipt_intelligence_enabled: false,
    receipt_sample_collection_enabled: false,
  })

  const [loading, setLoading] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [runningChannelJob, setRunningChannelJob] = useState(false)
  const [runningCharityJob, setRunningCharityJob] = useState(false)
  const [runningGnplJob, setRunningGnplJob] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoadingSettings(true)
        const session = getAdminSession()
        const response = await fetch('/api/admin/settings', {
          cache: 'no-store',
          headers: session?.admin?.id ? { 'x-admin-id': String(session.admin.id) } : undefined,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data?.ok) {
          setMessage({ type: 'error', text: String(data?.error || 'Failed to load settings') })
          return
        }
        if (!data?.settings) return

        setSettings((prev) => ({
          ...prev,
          ...data.settings,
          app_name: String(data.settings.app_name || prev.app_name),
          app_description: String(data.settings.app_description || prev.app_description),
          app_color:
            /^#[0-9a-f]{6}$/i.test(String(data.settings.app_color || ''))
              ? String(data.settings.app_color)
              : prev.app_color,
          logo_url: data.settings.logo_url ? String(data.settings.logo_url) : null,
          max_file_size: Number(data.settings.max_file_size || prev.max_file_size),
          receipt_cache_ttl: Number(data.settings.receipt_cache_ttl || prev.receipt_cache_ttl),
          maintenance_mode: Boolean(data.settings.maintenance_mode),
          telegram_channel_url: String(data.settings.telegram_channel_url || ''),
          telegram_channel_chat_id: String(data.settings.telegram_channel_chat_id || ''),
          telegram_channel_name: String(data.settings.telegram_channel_name || ''),
          telegram_post_new_trip: data.settings.telegram_post_new_trip !== false,
          telegram_post_weekly_summary: data.settings.telegram_post_weekly_summary !== false,
          telegram_post_daily_countdown: data.settings.telegram_post_daily_countdown !== false,
          telegram_recommendation_interval_hours: Number(data.settings.telegram_recommendation_interval_hours || 24),
          charity_channel_chat_id: String(data.settings.charity_channel_chat_id || ''),
          charity_channel_url: String(data.settings.charity_channel_url || ''),
          charity_group_chat_id: String(data.settings.charity_group_chat_id || ''),
          charity_group_url: String(data.settings.charity_group_url || ''),
          charity_auto_post_new_campaign: data.settings.charity_auto_post_new_campaign !== false,
          charity_auto_post_summary: data.settings.charity_auto_post_summary !== false,
          gnpl_enabled: Boolean(data.settings.gnpl_enabled),
          gnpl_require_admin_approval: data.settings.gnpl_require_admin_approval !== false,
          gnpl_default_term_days: Number(data.settings.gnpl_default_term_days || 14),
          gnpl_penalty_enabled: data.settings.gnpl_penalty_enabled !== false,
          gnpl_penalty_percent: Number(data.settings.gnpl_penalty_percent || 5),
          gnpl_penalty_period_days: Number(data.settings.gnpl_penalty_period_days || 7),
          gnpl_reminder_enabled: data.settings.gnpl_reminder_enabled !== false,
          gnpl_reminder_days_before: Number(data.settings.gnpl_reminder_days_before || 0),
          receipt_intelligence_enabled: Boolean(data.settings.receipt_intelligence_enabled),
          receipt_sample_collection_enabled: Boolean(data.settings.receipt_sample_collection_enabled),
        }))
      } catch (error) {
        console.error('[settings] Load failed:', error)
      } finally {
        setLoadingSettings(false)
      }
    }

    loadSettings()
  }, [])

  const handleSave = async () => {
    setLoading(true)
    try {
      const session = getAdminSession()
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.admin?.id ? { 'x-admin-id': String(session.admin.id) } : {}),
        },
        body: JSON.stringify(settings),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to save settings')
      }
      if (data?.settings) {
        setSettings((prev) => ({ ...prev, ...data.settings }))
      }
      setMessage({ type: 'success', text: 'Settings saved successfully' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save' })
    } finally {
      setLoading(false)
    }
  }

  const runChannelJob = async () => {
    try {
      setRunningChannelJob(true)
      const session = getAdminSession()
      const response = await fetch('/api/cron/telegram/channel-posts?manual=true', {
        method: 'POST',
        headers: session?.admin?.id ? { 'x-admin-id': String(session.admin.id) } : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to run channel posting')
      }

      setMessage({
        type: 'success',
        text: `Channel job executed. New trips: ${data?.newTripsPosted || 0}, weekly summary: ${
          data?.weeklySummaryPosted ? 'yes' : 'no'
        }, daily countdown: ${data?.dailyCountdownPosted ? 'yes' : 'no'}, recommended post: ${
          data?.recommendedPosted ? 'yes' : 'no'
        }, final summaries: ${
          Number(data?.finalTripSummariesPosted || 0)
        }.`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to run channel posting' })
    } finally {
      setRunningChannelJob(false)
    }
  }

  const runCharityJob = async () => {
    try {
      setRunningCharityJob(true)
      const session = getAdminSession()
      const response = await fetch('/api/cron/telegram/charity-updates?manual=true&force=true', {
        method: 'POST',
        headers: session?.admin?.id ? { 'x-admin-id': String(session.admin.id) } : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to run charity update job')
      }

      setMessage({
        type: 'success',
        text: `Charity summary job executed. Ranking posted: ${data?.posted ? 'yes' : 'no'}, final summaries: ${
          Number(data?.finalPosted || 0)
        }.`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to run charity update job' })
    } finally {
      setRunningCharityJob(false)
    }
  }

  const runGnplReminderJob = async () => {
    try {
      setRunningGnplJob(true)
      const session = getAdminSession()
      const response = await fetch('/api/cron/telegram/gnpl-reminders?manual=true', {
        method: 'POST',
        headers: session?.admin?.id ? { 'x-admin-id': String(session.admin.id) } : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to run GNPL reminder job')
      }

      setMessage({
        type: 'success',
        text: `GNPL reminder job executed. Processed: ${Number(data?.processed || 0)}, penalties applied: ${
          Number(data?.penaltiesApplied || 0)
        }, reminders sent: ${Number(data?.remindersSent || 0)}.`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to run GNPL reminder job' })
    } finally {
      setRunningGnplJob(false)
    }
  }

  if (loadingSettings) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-slate-300">Loading settings...</div>
    )
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      const session = getAdminSession()
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/admin/settings/upload-logo', {
        method: 'POST',
        headers: session?.admin?.id ? { 'x-admin-id': String(session.admin.id) } : undefined,
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Upload failed')

      setSettings((prev) => ({ ...prev, logo_url: data.logo_url }))
      setMessage({ type: 'success', text: 'Logo uploaded successfully' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Upload failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">⚙️ App Settings</h1>
        <p className="text-muted-foreground mt-1">Manage application configuration and branding</p>
      </div>

      {message && (
        <div className={`rounded-lg border p-4 flex gap-3 ${message.type === 'success' ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
          {message.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          )}
          <p className={message.type === 'success' ? 'text-green-900' : 'text-red-900'}>{message.text}</p>
        </div>
      )}

      {/* Branding Section */}
      <Card>
        <CardHeader>
          <CardTitle>🎨 Branding</CardTitle>
          <CardDescription>Customize app appearance and logo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo Upload */}
          <div>
            <label className="text-sm font-medium">App Logo</label>
            <div className="mt-2 flex gap-4 items-start">
              {settings.logo_url && (
                <img
                  src={settings.logo_url}
                  alt="App Logo"
                  className="w-20 h-20 object-contain rounded-lg border border-slate-200"
                />
              )}
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  disabled={loading}
                  className="hidden"
                  id="logo-upload"
                />
                <label htmlFor="logo-upload">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    asChild
                  >
                    <span>
                      <Upload className="w-4 h-4 mr-2" />
                      {loading ? 'Uploading...' : 'Upload Logo'}
                    </span>
                  </Button>
                </label>
                <p className="text-xs text-muted-foreground mt-2">Recommended: 200x200px, PNG or JPEG</p>
              </div>
            </div>
          </div>

          {/* App Name */}
          <div>
            <label className="text-sm font-medium">App Name</label>
            <input
              type="text"
              value={settings.app_name}
              onChange={(e) => setSettings((prev) => ({ ...prev, app_name: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="TicketHub"
            />
          </div>

          {/* App Description */}
          <div>
            <label className="text-sm font-medium">App Description</label>
            <textarea
              value={settings.app_description}
              onChange={(e) => setSettings((prev) => ({ ...prev, app_description: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md min-h-24"
              placeholder="Telegram Ticket Reservation System"
            />
          </div>

          {/* Theme Color */}
          <div>
            <label className="text-sm font-medium">Primary Color</label>
            <div className="mt-1 flex gap-2 items-center">
              <input
                type="color"
                value={settings.app_color}
                onChange={(e) => setSettings((prev) => ({ ...prev, app_color: e.target.value }))}
                className="h-10 w-20 rounded cursor-pointer"
              />
              <input
                type="text"
                value={settings.app_color}
                onChange={(e) => setSettings((prev) => ({ ...prev, app_color: e.target.value }))}
                className="px-3 py-2 border rounded-md w-32"
                placeholder="#06b6d4"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Charity Telegram Automation</CardTitle>
          <CardDescription>
            Configure campaign channel/group defaults and automated contributor ranking posts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Charity Channel Chat ID</label>
            <input
              type="text"
              value={settings.charity_channel_chat_id}
              onChange={(e) => setSettings((prev) => ({ ...prev, charity_channel_chat_id: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="@charity_channel or -1001234567890"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Charity Channel URL</label>
            <input
              type="url"
              value={settings.charity_channel_url}
              onChange={(e) => setSettings((prev) => ({ ...prev, charity_channel_url: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="https://t.me/charity_channel"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Charity Group Chat ID (optional)</label>
            <input
              type="text"
              value={settings.charity_group_chat_id}
              onChange={(e) => setSettings((prev) => ({ ...prev, charity_group_chat_id: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="-1001234567890"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Charity Group URL (optional)</label>
            <input
              type="url"
              value={settings.charity_group_url}
              onChange={(e) => setSettings((prev) => ({ ...prev, charity_group_url: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="https://t.me/+groupInvite"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.charity_auto_post_new_campaign}
                onChange={(e) => setSettings((prev) => ({ ...prev, charity_auto_post_new_campaign: e.target.checked }))}
              />
              Auto Post New Campaign
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.charity_auto_post_summary}
                onChange={(e) => setSettings((prev) => ({ ...prev, charity_auto_post_summary: e.target.checked }))}
              />
              Auto Post Weekly/Monthly/Yearly Rankings
            </label>
          </div>

          <Button
            onClick={runCharityJob}
            disabled={runningCharityJob}
            variant="outline"
            className="w-full"
          >
            <Send className="w-4 h-4 mr-2" />
            {runningCharityJob ? 'Running Charity Job...' : 'Run Charity Ranking Job Now'}
          </Button>
        </CardContent>
      </Card>

      {/* File Handling Section */}
      <Card>
        <CardHeader>
          <CardTitle>📁 File Handling</CardTitle>
          <CardDescription>Configure receipt upload and caching</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Max File Size (MB)</label>
            <input
              type="number"
              value={settings.max_file_size}
              onChange={(e) => setSettings((prev) => ({ ...prev, max_file_size: Number(e.target.value) }))}
              min="1"
              max="50"
              className="mt-1 w-full px-3 py-2 border rounded-md"
            />
            <p className="text-xs text-muted-foreground mt-1">Maximum size for uploaded receipt files</p>
          </div>

          <div>
            <label className="text-sm font-medium">Receipt Cache TTL (seconds)</label>
            <input
              type="number"
              value={settings.receipt_cache_ttl}
              onChange={(e) => setSettings((prev) => ({ ...prev, receipt_cache_ttl: Number(e.target.value) }))}
              min="300"
              max="86400"
              className="mt-1 w-full px-3 py-2 border rounded-md"
            />
            <p className="text-xs text-muted-foreground mt-1">How long to cache receipts in memory for faster loading</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Receipt Intelligence</CardTitle>
          <CardDescription>
            Enable enhanced receipt-link/reference validation and optional sample collection for future ML.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.receipt_intelligence_enabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, receipt_intelligence_enabled: e.target.checked }))
              }
            />
            Enable strict receipt intelligence checks
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.receipt_sample_collection_enabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, receipt_sample_collection_enabled: e.target.checked }))
              }
            />
            Collect anonymized receipt-analysis samples (for future ML training dataset)
          </label>
          <p className="text-xs text-muted-foreground">
            When enabled, known links like Telebirr and CBE receipt URLs are analyzed and mismatches can be blocked.
          </p>
        </CardContent>
      </Card>

      {/* Maintenance Section */}
      <Card>
        <CardHeader>
          <CardTitle>🔧 Maintenance</CardTitle>
          <CardDescription>System-wide settings</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.maintenance_mode}
              onChange={(e) => setSettings((prev) => ({ ...prev, maintenance_mode: e.target.checked }))}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm font-medium">Maintenance Mode</span>
          </label>
          <p className="text-xs text-muted-foreground mt-2">When enabled, non-admin users will see a maintenance message</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GNPL Credit Settings</CardTitle>
          <CardDescription>
            Configure Go Now Pay Later approval flow, penalty, and repayment reminders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.gnpl_enabled}
                onChange={(e) => setSettings((prev) => ({ ...prev, gnpl_enabled: e.target.checked }))}
              />
              Enable GNPL
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.gnpl_require_admin_approval}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, gnpl_require_admin_approval: e.target.checked }))
                }
              />
              Require admin approval
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Default term (days)</label>
              <input
                type="number"
                min={1}
                value={settings.gnpl_default_term_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    gnpl_default_term_days: Math.max(1, Number(e.target.value || 14)),
                  }))
                }
                className="mt-1 w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Penalty rate (%)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={settings.gnpl_penalty_percent}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    gnpl_penalty_percent: Math.max(0, Number(e.target.value || 0)),
                  }))
                }
                className="mt-1 w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Penalty period (days)</label>
              <input
                type="number"
                min={1}
                value={settings.gnpl_penalty_period_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    gnpl_penalty_period_days: Math.max(1, Number(e.target.value || 7)),
                  }))
                }
                className="mt-1 w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.gnpl_penalty_enabled}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, gnpl_penalty_enabled: e.target.checked }))
                }
              />
              Enable periodic penalty
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.gnpl_reminder_enabled}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, gnpl_reminder_enabled: e.target.checked }))
                }
              />
              Enable due reminders
            </label>
          </div>

          <div>
            <label className="text-sm font-medium">Reminder lead days</label>
            <input
              type="number"
              min={0}
              value={settings.gnpl_reminder_days_before}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  gnpl_reminder_days_before: Math.max(0, Number(e.target.value || 0)),
                }))
              }
              className="mt-1 w-full px-3 py-2 border rounded-md"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Set 0 to notify exactly on due date.
            </p>
          </div>

          <Button
            onClick={runGnplReminderJob}
            disabled={runningGnplJob}
            variant="outline"
            className="w-full"
          >
            <Send className="w-4 h-4 mr-2" />
            {runningGnplJob ? 'Running GNPL Job...' : 'Run GNPL Reminder Job Now'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram Channel Automation</CardTitle>
          <CardDescription>
            Configure where trip updates are posted and control automated posting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Channel Chat ID</label>
            <input
              type="text"
              value={settings.telegram_channel_chat_id}
              onChange={(e) => setSettings((prev) => ({ ...prev, telegram_channel_chat_id: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="@your_channel or -1001234567890"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Required for posting. Use the channel username (e.g. @jateguzo_news) or numeric chat id.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Channel URL (for Mini App)</label>
            <input
              type="url"
              value={settings.telegram_channel_url}
              onChange={(e) => setSettings((prev) => ({ ...prev, telegram_channel_url: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="https://t.me/your_channel"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Channel Display Name</label>
            <input
              type="text"
              value={settings.telegram_channel_name}
              onChange={(e) => setSettings((prev) => ({ ...prev, telegram_channel_name: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border rounded-md"
              placeholder="Jate Guzo Updates"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.telegram_post_new_trip}
                onChange={(e) => setSettings((prev) => ({ ...prev, telegram_post_new_trip: e.target.checked }))}
              />
              Post New Trip Alerts
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.telegram_post_weekly_summary}
                onChange={(e) => setSettings((prev) => ({ ...prev, telegram_post_weekly_summary: e.target.checked }))}
              />
              Weekly Ticket Summary
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.telegram_post_daily_countdown}
                onChange={(e) => setSettings((prev) => ({ ...prev, telegram_post_daily_countdown: e.target.checked }))}
              />
              Daily Trip Countdown
            </label>
          </div>

          <div>
            <label className="text-sm font-medium">Recommended Post Interval (hours)</label>
            <input
              type="number"
              min="1"
              max="168"
              value={settings.telegram_recommendation_interval_hours}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  telegram_recommendation_interval_hours: Math.max(1, Number(e.target.value || 24)),
                }))
              }
              className="mt-1 w-full px-3 py-2 border rounded-md"
            />
          </div>

          <Button
            onClick={runChannelJob}
            disabled={runningChannelJob}
            variant="outline"
            className="w-full"
          >
            <Send className="w-4 h-4 mr-2" />
            {runningChannelJob ? 'Running Channel Job...' : 'Run Channel Job Now'}
          </Button>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={loading}
        className="w-full"
        size="lg"
      >
        <Save className="w-4 h-4 mr-2" />
        {loading ? 'Saving...' : 'Save Settings'}
      </Button>
    </div>
  )
}
