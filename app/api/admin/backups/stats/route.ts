import { NextRequest, NextResponse } from 'next/server'
import { getBackupStatistics } from '@/lib/backup'

/**
 * GET /api/admin/backups/stats - Get backup statistics
 */
export async function GET(request: NextRequest) {
  try {
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
