'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy, Download, Plus, RotateCw, Trash2 } from 'lucide-react'

interface Invitation {
  id: string
  invitation_code: string
  qr_code_data: string
  trip_id?: string
  max_uses?: number
  current_uses: number
  is_active: boolean
  created_at: string
  expires_at?: string
}

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [language, setLanguage] = useState<'en' | 'am'>('en')

  const t = {
    en: {
      title: 'Invitation Links & QR Codes',
      subtitle: 'Create and manage customer invitations',
      create: 'Create New Invitation',
      refresh: 'Refresh',
      code: 'Invitation Code',
      uses: 'Uses',
      status: 'Status',
      created: 'Created',
      expires: 'Expires',
      actions: 'Actions',
      copy: 'Copy',
      download: 'Download QR',
      delete: 'Delete',
      active: 'Active',
      inactive: 'Inactive',
      unlimited: 'Unlimited',
      noData: 'No invitations created yet',
      creating: 'Creating...',
    },
    am: {
      title: 'ግብዓት ሊንክ እና QR ኮድ',
      subtitle: 'ደንበኛ ግብዓቶችን ይፍጠሩ እና ያስተዳድሩ',
      create: '새로운 ግብዓት ይፍጠሩ',
      refresh: 'ያድስ',
      code: 'ግብዓት ኮድ',
      uses: 'ጠቅሎ',
      status: 'ሁኔታ',
      created: 'ተፈጠረ',
      expires: 'ሚያልቅ',
      actions: 'ተግባራት',
      copy: 'ይቅዱ',
      download: 'QR ያወርዱ',
      delete: 'ሰርዙ',
      active: 'ንቁ',
      inactive: 'ያልሰራ',
      unlimited: 'ያልተወሰነ',
      noData: 'ምንም ግብዓት አልተፈጠረም',
      creating: 'በመፍጠር...',
    },
  }

  const labels = t[language]

  useEffect(() => {
    loadInvitations()
  }, [])

  async function loadInvitations() {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/invitations')
      if (res.ok) {
        const data = await res.json()
        setInvitations(data.invitations || [])
      }
    } catch (error) {
      console.error('[v0] Error loading invitations:', error)
    } finally {
      setLoading(false)
    }
  }

  async function createInvitation() {
    try {
      setCreating(true)
      const res = await fetch('/api/admin/invitations/create', { method: 'POST' })
      if (res.ok) {
        await loadInvitations()
      }
    } catch (error) {
      console.error('[v0] Error creating invitation:', error)
    } finally {
      setCreating(false)
    }
  }

  async function deleteInvitation(invitation: Invitation) {
    const confirmed = window.confirm(
      `Delete invitation ${invitation.invitation_code}? This will deactivate it.`
    )
    if (!confirmed) return

    try {
      setDeletingId(invitation.id)
      const res = await fetch(`/api/admin/invitations?id=${invitation.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await loadInvitations()
      }
    } catch (error) {
      console.error('[v0] Error deleting invitation:', error)
    } finally {
      setDeletingId(null)
    }
  }

  function copyToClipboard(code: string) {
    navigator.clipboard.writeText(code)
  }

  function downloadQRCode(qrData: string, code: string) {
    const link = document.createElement('a')
    link.href = qrData
    link.download = `invitation-${code}.png`
    link.click()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{labels.title}</h1>
          <p className="text-muted-foreground mt-1">{labels.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLanguage(language === 'en' ? 'am' : 'en')}
          >
            {language === 'en' ? 'አማርኛ' : 'English'}
          </Button>
          <Button onClick={loadInvitations} variant="outline" disabled={loading}>
            <RotateCw className="w-4 h-4 mr-2" />
            {labels.refresh}
          </Button>
          <Button onClick={createInvitation} disabled={creating}>
            <Plus className="w-4 h-4 mr-2" />
            {creating ? labels.creating : labels.create}
          </Button>
        </div>
      </div>

      {/* Invitations List */}
      <Card>
        <CardHeader>
          <CardTitle>{labels.title}</CardTitle>
          <CardDescription>{invitations.length} active invitations</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : invitations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{labels.noData}</div>
          ) : (
            <div className="space-y-4">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                        {inv.invitation_code}
                      </code>
                      <span
                        className={`text-xs px-2 py-1 rounded ${inv.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
                          }`}
                      >
                        {inv.is_active ? labels.active : labels.inactive}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      {labels.uses}: {inv.current_uses} / {inv.max_uses || labels.unlimited}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(inv.invitation_code)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    {inv.qr_code_data && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadQRCode(inv.qr_code_data, inv.invitation_code)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      onClick={() => deleteInvitation(inv)}
                      disabled={deletingId === inv.id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
