import { NextRequest, NextResponse } from 'next/server'
import { getBackupStatistics } from '@/lib/backup'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPermission } from '@/lib/admin-rbac'

/**
 * GET /api/admin/backups/stats - Get backup statistics
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

    const stats = await getBackupStatistics()

    return NextResponse.json({
      success: true,
      stats,
    })
  } catch (error) {
    console.error('[Backups Stats API] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
