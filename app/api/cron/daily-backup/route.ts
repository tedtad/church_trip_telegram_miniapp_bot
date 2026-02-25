import { NextRequest, NextResponse } from 'next/server'
import { backupDatabase, cleanupOldBackups } from '@/lib/backup'

/**
 * Vercel Cron Job - Runs daily automatic backup
 * Configure in vercel.json with: "0 2 * * *" (2 AM UTC every day)
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[Cron] Starting daily backup...')
    const startTime = Date.now()

    // Run backup
    const backupResult = await backupDatabase()
    console.log('[Cron] Backup completed:', backupResult)

    // Clean up old backups (keep 30 days)
    const cleanupResult = await cleanupOldBackups(30)
    console.log('[Cron] Cleanup completed. Deleted:', cleanupResult, 'old backups')

    const duration = Date.now() - startTime

    return NextResponse.json(
      {
        success: true,
        message: 'Daily backup completed successfully',
        backup: {
          id: backupResult.id,
          status: backupResult.status,
          records: backupResult.recordsCount,
          size: `${(backupResult.size ? backupResult.size / 1024 : 0).toFixed(2)}KB`,
          duration: `${duration}ms`,
        },
        cleanup: {
          deletedBackups: cleanupResult,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Cron] Backup failed:', errorMessage)

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        message: 'Daily backup failed',
      },
      { status: 500 }
    )
  }
}
