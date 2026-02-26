import { NextRequest, NextResponse } from 'next/server'
import { getBackupHistory } from '@/lib/backup'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPermission } from '@/lib/admin-rbac'

type BackupLogMetadata = {
  backupId?: string
}

/**
 * GET /api/admin/backups - Fetch backup history
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'backups_manage',
    })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const limit = request.nextUrl.searchParams.get('limit') || '30'
    const backups = await getBackupHistory(parseInt(limit))

    return NextResponse.json({
      success: true,
      backups,
      count: backups.length,
    })
  } catch (error) {
    console.error('[Backups API] Error fetching history:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/backups?id=<activity_log_id> - Delete a backup history record
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'backups_manage',
    })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing backup id' },
        { status: 400 }
      )
    }

    const { data: log, error: fetchError } = await supabase
      .from('activity_logs')
      .select('id, metadata')
      .eq('id', id)
      .single()

    if (fetchError) throw fetchError

    const { error: deleteError } = await supabase
      .from('activity_logs')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    const backupId = (log?.metadata as BackupLogMetadata | null)?.backupId
    if (backupId) {
      // Best effort cleanup for optional backup snapshot table.
      await supabase.from('database_backups').delete().eq('backup_id', backupId)
      await supabase.from('database_backups').delete().eq('id', backupId)
    }

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error('[Backups API] Error deleting backup history:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
