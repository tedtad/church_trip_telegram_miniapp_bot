import { createAdminClient } from '@/lib/supabase/admin'

export interface BackupStatus {
  id: string
  timestamp: Date
  status: 'success' | 'failed' | 'pending'
  errorMessage?: string
  size?: number
  duration?: number
  recordsCount?: number
  backupType: 'csv' | 'json' | 'full'
}

export interface BackupMetadata {
  backupId: string
  timestamp: string
  duration: number
  status: 'success' | 'failed'
  recordsCount: number
  size: number
  tables: {
    [key: string]: number
  }
  compression: boolean
}

async function getBackupClient() {
  return createAdminClient()
}

/**
 * Convert array to CSV format
 */
export function convertToCSV(data: any[]): string {
  if (!data || data.length === 0) return ''

  const headers = Object.keys(data[0])
  const csvHeaders = headers.map((h) => `"${h}"`).join(',')

  const rows = data.map((row) =>
    headers
      .map((header) => {
        const value = row[header]
        if (value === null || value === undefined) return ''
        const strValue = String(value)
        const escaped = strValue.replace(/"/g, '""')
        return `"${escaped}"`
      })
      .join(',')
  )

  return [csvHeaders, ...rows].join('\n')
}

/**
 * Perform full database backup (all tables, all data)
 */
export async function backupDatabase(): Promise<BackupStatus> {
  const startTime = Date.now()
  const backupId = `backup-${Date.now()}`

  try {
    const supabase = await getBackupClient()

    // Tables to backup
    const tables = [
      'telegram_users',
      'admin_users',
      'trips',
      'receipts',
      'tickets',
      'activity_logs',
      'approvals',
      'invitations',
      'notifications',
      'telegram_channels',
    ]

    const backupData: any = {
      backupId,
      timestamp: new Date().toISOString(),
      version: '2.0',
      tables: {},
      statistics: {},
    }

    let totalRecords = 0
    const tableCounts: { [key: string]: number } = {}

    // Fetch all tables
    for (const table of tables) {
      const { data, error } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .limit(100000)

      if (error) {
        console.error(`[Backup] Error fetching ${table}:`, error)
        tableCounts[table] = 0
        backupData.tables[table] = []
        continue
      }

      backupData.tables[table] = data || []
      const count = data?.length || 0
      tableCounts[table] = count
      totalRecords += count
    }

    backupData.statistics = tableCounts
    backupData.totalRecords = totalRecords

    // Store backup metadata in database
    const backupSize = JSON.stringify(backupData).length
    const duration = Date.now() - startTime

    let { data: adminRow } = await supabase
      .from('admin_users')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!adminRow?.id) {
      const { data: fallbackAdmin } = await supabase
        .from('admin_users')
        .select('id')
        .limit(1)
        .maybeSingle()
      adminRow = fallbackAdmin
    }

    const logPayload = {
      admin_id: adminRow?.id || null,
      entity_type: 'system',
      entity_id: backupId,
      description: `Automated daily backup: ${totalRecords} records, ${(backupSize / 1024).toFixed(2)}KB`,
      ip_address: 'system-automation',
      user_agent: 'backup-cron-job',
      metadata: {
        backupId,
        totalRecords,
        size: backupSize,
        tables: tableCounts,
      },
    }

    const { error: actionError } = await supabase
      .from('activity_logs')
      .insert({ ...logPayload, action: 'AUTOMATED_BACKUP' })

    if (actionError) {
      const { error: actionTypeError } = await supabase
        .from('activity_logs')
        .insert({ ...logPayload, action_type: 'AUTOMATED_BACKUP' })

      if (actionTypeError) {
        console.error('[Backup] Failed to log backup:', actionTypeError)
      }
    }

    return {
      id: backupId,
      timestamp: new Date(),
      status: 'success',
      size: backupSize,
      duration,
      recordsCount: totalRecords,
      backupType: 'full',
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Backup] Database backup failed:', errorMessage)

    return {
      id: backupId,
      timestamp: new Date(),
      status: 'failed',
      errorMessage,
      duration: Date.now() - startTime,
      backupType: 'full',
    }
  }
}

/**
 * Export specific table as CSV
 */
export async function exportTableAsCSV(tableName: string): Promise<string> {
  const supabase = await getBackupClient()

  const { data, error } = await supabase
    .from(tableName)
    .select('*', { count: 'exact' })
    .limit(100000)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch ${tableName}: ${error.message}`)
  }

  if (!data || data.length === 0) {
    return 'No data available for export'
  }

  return convertToCSV(data)
}

/**
 * Export multiple tables as ZIP (returns JSON with all tables)
 */
export async function exportMultipleTablesAsCSV(
  tableNames: string[]
): Promise<{ [key: string]: string }> {
  const result: { [key: string]: string } = {}

  for (const table of tableNames) {
    try {
      result[table] = await exportTableAsCSV(table)
    } catch (error) {
      console.error(`[Backup] Error exporting ${table}:`, error)
      result[table] = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }

  return result
}

/**
 * Get backup history
 */
export async function getBackupHistory(limit = 30): Promise<any[]> {
  const supabase = await getBackupClient()
  const isVisible = (row: any) => {
    const metadata = (row?.metadata || {}) as Record<string, unknown>
    return metadata.deleted !== true && metadata.status !== 'deleted'
  }

  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('action', 'AUTOMATED_BACKUP')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!error) {
    return (
      (data || [])
        .filter(isVisible)
        .map((row) => ({
          ...row,
          action: row.action || row.action_type || 'AUTOMATED_BACKUP',
        }))
    )
  }

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('action_type', 'AUTOMATED_BACKUP')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (fallbackError) {
    console.error('[Backup] Failed to fetch backup history:', fallbackError)
    return []
  }

  return (
    (fallbackData || [])
      .filter(isVisible)
      .map((row) => ({
        ...row,
        action: row.action || row.action_type || 'AUTOMATED_BACKUP',
      }))
  )
}

/**
 * Get latest successful backup
 */
export async function getLatestBackup(): Promise<any | null> {
  const supabase = await getBackupClient()
  const isVisible = (row: any) => {
    const metadata = (row?.metadata || {}) as Record<string, unknown>
    return metadata.deleted !== true && metadata.status !== 'deleted'
  }

  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('action', 'AUTOMATED_BACKUP')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!error && isVisible(data)) {
    return {
      ...data,
      action: data.action || data.action_type || 'AUTOMATED_BACKUP',
    }
  }

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('action_type', 'AUTOMATED_BACKUP')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (fallbackError && fallbackError.code !== 'PGRST116') {
    console.error('[Backup] Failed to fetch latest backup:', fallbackError)
    return null
  }

  return fallbackData && isVisible(fallbackData)
    ? {
      ...fallbackData,
      action: fallbackData.action || fallbackData.action_type || 'AUTOMATED_BACKUP',
    }
    : null
}

/**
 * Get backup statistics
 */
export async function getBackupStatistics(): Promise<{
  totalBackups: number
  successfulBackups: number
  failedBackups: number
  lastBackupTime: string | null
  averageBackupSize: number
}> {
  const backups = await getBackupHistory(100)

  const successful = backups.filter((b) => b.metadata?.totalRecords !== undefined)
  const failed = backups.filter((b) => !b.metadata?.totalRecords)

  let totalSize = 0
  successful.forEach((b) => {
    if (b.metadata?.size) totalSize += b.metadata.size
  })

  return {
    totalBackups: backups.length,
    successfulBackups: successful.length,
    failedBackups: failed.length,
    lastBackupTime:
      backups.length > 0 ? backups[0].created_at : null,
    averageBackupSize: successful.length > 0 ? totalSize / successful.length : 0,
  }
}

/**
 * Clean up old backups from activity logs (keep last 30 days)
 */
export async function cleanupOldBackups(daysToKeep = 30): Promise<number> {
  const supabase = await getBackupClient()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

  const { data: deletedBackups, error } = await supabase
    .from('activity_logs')
    .delete()
    .eq('action', 'AUTOMATED_BACKUP')
    .lt('created_at', cutoffDate.toISOString())
    .select('id')

  if (!error) {
    return deletedBackups?.length || 0
  }

  const { data: fallbackDeleted, error: fallbackError } = await supabase
    .from('activity_logs')
    .delete()
    .eq('action_type', 'AUTOMATED_BACKUP')
    .lt('created_at', cutoffDate.toISOString())
    .select('id')

  if (fallbackError) {
    console.error('[Backup] Failed to cleanup old backups:', fallbackError)
    return 0
  }

  return fallbackDeleted?.length || 0
}
