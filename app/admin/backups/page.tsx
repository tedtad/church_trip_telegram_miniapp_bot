'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, CheckCircle, Download, Loader, RotateCw, Trash2 } from 'lucide-react'

interface BackupRecord {
  id: string
  created_at: string
  action: string
  description: string
  metadata?: {
    backupId: string
    totalRecords: number
    size: number
    tables: { [key: string]: number }
  }
}

interface BackupStats {
  totalBackups: number
  successfulBackups: number
  failedBackups: number
  lastBackupTime: string | null
  averageBackupSize: number
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [stats, setStats] = useState<BackupStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [backing, setBacking] = useState(false)
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState('all')
  const [language, setLanguage] = useState<'en' | 'am'>('en')

  const t = {
    en: {
      title: 'Database Backups',
      subtitle: 'Manage and monitor automatic database backups',
      manualBackup: 'Manual Backup Now',
      exportCSV: 'Export as CSV',
      backupHistory: 'Backup History',
      statistics: 'Backup Statistics',
      totalBackups: 'Total Backups',
      successful: 'Successful',
      failed: 'Failed',
      lastBackup: 'Last Backup',
      avgSize: 'Average Size',
      selectTable: 'Select Table to Export',
      allTables: 'All Tables',
      allRecords: 'All Records',
      backupId: 'Backup ID',
      timestamp: 'Timestamp',
      records: 'Records',
      size: 'Size',
      status: 'Status',
      actions: 'Actions',
      download: 'Download',
      delete: 'Delete',
      createdAt: 'Created At',
      description: 'Description',
      noBackups: 'No backups found',
      backupInProgress: 'Creating backup...',
      success: 'Backup created successfully',
      error: 'Error creating backup',
      emptyState: 'Start by creating your first backup',
    },
    am: {
      title: 'ዳታቤዝ ምትክ',
      subtitle: 'ራስ-ሰር ዳታቤዝ ምትሎችን ያስተዳድሩ እና ክትትል ያድርጉ',
      manualBackup: 'አሁን ራስ-ሰር ምትክ ስራ',
      exportCSV: 'እንደ CSV ወደ ውጪ ላክ',
      backupHistory: 'ምትክ ታሪክ',
      statistics: 'ምትክ ስታቲስቲክስ',
      totalBackups: 'ጠቅላላ ምትክ',
      successful: 'ስኬታማ',
      failed: 'ውድቅ ደረሰ',
      lastBackup: 'የመጨረሻ ምትክ',
      avgSize: 'አማካይ መጠን',
      selectTable: 'ለማስመላለስ ሠንጠረዥ ይምረጡ',
      allTables: 'ሁሉም ሠንጠረዦች',
      allRecords: 'ሁሉም ሪከርዶች',
      backupId: 'ምትክ ID',
      timestamp: 'ጊዜ',
      records: 'ሪከርዶች',
      size: 'መጠን',
      status: 'ሁኔታ',
      actions: 'ተግባራት',
      download: 'ያወርዱ',
      delete: 'ሰርዝ',
      createdAt: 'የተፈጠረበት ጊዜ',
      description: 'መግለጫ',
      noBackups: 'ምትክ አልተገኘም',
      backupInProgress: 'ምትክ በመፍጠር ላይ...',
      success: 'ምትክ በተሳካ ሁኔታ ተፈጠረ',
      error: 'ምትክ በእንዲህ ዓይነቱ ስህተት',
      emptyState: 'በመጀመርያው ምትክ ይጀምሩ',
    },
  }

  const labels = t[language]

  useEffect(() => {
    loadBackupData()
    const interval = setInterval(loadBackupData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  async function loadBackupData() {
    try {
      setLoading(true)
      const [backupsRes, statsRes] = await Promise.all([
        fetch('/api/admin/backups'),
        fetch('/api/admin/backups/stats'),
      ])

      if (backupsRes.ok) {
        const data = await backupsRes.json()
        setBackups(data.backups || [])
      }

      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats(data.stats || null)
      }
    } catch (error) {
      console.error('[v0] Error loading backups:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleManualBackup() {
    try {
      setBacking(true)
      const res = await fetch('/api/admin/backups/create', { method: 'POST' })

      if (res.ok) {
        await loadBackupData()
      }
    } catch (error) {
      console.error('[v0] Error creating backup:', error)
    } finally {
      setBacking(false)
    }
  }

  async function handleExportCSV(table: string) {
    try {
      const endpoint =
        table === 'all'
          ? '/api/admin/backups/export?format=csv&all=true'
          : `/api/admin/backups/export?format=csv&table=${table}`

      const res = await fetch(endpoint)
      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${table}-export-${new Date().toISOString().split('T')[0]}.csv`
        a.click()
      }
    } catch (error) {
      console.error('[v0] Error exporting CSV:', error)
    }
  }

  function handleDownloadBackup(backup: BackupRecord) {
    const payload = {
      id: backup.id,
      created_at: backup.created_at,
      action: backup.action,
      description: backup.description,
      metadata: backup.metadata || {},
    }

    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backup-${backup.id}.json`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  async function handleDeleteBackup(backup: BackupRecord) {
    const confirmed = window.confirm('Delete this backup history record?')
    if (!confirmed) return

    try {
      setDeletingBackupId(backup.id)
      const res = await fetch(`/api/admin/backups?id=${backup.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setBackups((prev) => prev.filter((item) => item.id !== backup.id))
      }
    } catch (error) {
      console.error('[v0] Error deleting backup record:', error)
    } finally {
      setDeletingBackupId(null)
    }
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
          <Button onClick={handleManualBackup} disabled={backing}>
            {backing ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                {labels.backupInProgress}
              </>
            ) : (
              <>
                <RotateCw className="w-4 h-4 mr-2" />
                {labels.manualBackup}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{labels.totalBackups}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalBackups}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-green-600">{labels.successful}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                {stats.successfulBackups}
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-red-600">{labels.failed}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                {stats.failedBackups}
                {stats.failedBackups > 0 && <AlertCircle className="w-5 h-5 text-red-600" />}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{labels.lastBackup}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-mono">
                {stats.lastBackupTime
                  ? format(new Date(stats.lastBackupTime), 'MMM dd, HH:mm')
                  : 'Never'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">{labels.avgSize}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-mono">
                {(stats.averageBackupSize / 1024).toFixed(2)} KB
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle>{labels.exportCSV}</CardTitle>
          <CardDescription>{labels.selectTable}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-md bg-background"
            >
              <option value="all">{labels.allTables}</option>
              <option value="telegram_users">Telegram Users</option>
              <option value="tickets">Tickets</option>
              <option value="receipts">Receipts</option>
              <option value="admin_users">Admin Users</option>
              <option value="activity_logs">Activity Logs</option>
              <option value="trips">Trips</option>
              <option value="approvals">Approvals</option>
              <option value="notifications">Notifications</option>
            </select>
            <Button onClick={() => handleExportCSV(selectedTable)}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Backup History */}
      <Card>
        <CardHeader>
          <CardTitle>{labels.backupHistory}</CardTitle>
          <CardDescription>Recent backup operations</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <Loader className="w-6 h-6 animate-spin mx-auto" />
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{labels.emptyState}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold">{labels.timestamp}</th>
                    <th className="text-left py-3 px-4 font-semibold">{labels.description}</th>
                    <th className="text-left py-3 px-4 font-semibold">{labels.records}</th>
                    <th className="text-left py-3 px-4 font-semibold">{labels.size}</th>
                    <th className="text-right py-3 px-4 font-semibold">{labels.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr key={backup.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4 font-mono text-xs">
                        {format(new Date(backup.created_at), 'MMM dd, HH:mm:ss')}
                      </td>
                      <td className="py-3 px-4 text-sm max-w-md truncate">
                        {backup.description}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {backup.metadata?.totalRecords?.toLocaleString() || '—'}
                      </td>
                      <td className="py-3 px-4 text-sm font-mono">
                        {backup.metadata?.size
                          ? `${(backup.metadata.size / 1024).toFixed(2)} KB`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadBackup(backup)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleDeleteBackup(backup)}
                            disabled={deletingBackupId === backup.id}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Information Card */}
      <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="text-base">About Automatic Backups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>Automatic daily backups at 2:00 AM UTC (Vercel Cron)</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>Manual backups available anytime from this dashboard</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>All data backed up: customers, tickets, receipts, activity logs, approvals</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>Backup history retained for 30 days automatically</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>CSV export available for any table or all data</span>
          </div>
          <div className="flex gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>Each backup logged in activity trail with audit information</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
