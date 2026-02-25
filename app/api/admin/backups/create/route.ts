import { NextRequest, NextResponse } from 'next/server'
import { backupDatabase } from '@/lib/backup'

/**
 * POST /api/admin/backups/create - Trigger manual backup
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Backups Create API] Starting manual backup...')
    const backupResult = await backupDatabase()

    if (backupResult.status === 'success') {
      return NextResponse.json(
        {
          success: true,
          message: 'Backup created successfully',
          backup: {
            id: backupResult.id,
            status: backupResult.status,
            records: backupResult.recordsCount,
            size: backupResult.size,
            duration: backupResult.duration,
          },
        },
        { status: 201 }
      )
    } else {
      return NextResponse.json(
        {
          success: false,
          error: backupResult.errorMessage || 'Backup failed',
          backup: {
            id: backupResult.id,
            status: backupResult.status,
          },
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('[Backups Create API] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
