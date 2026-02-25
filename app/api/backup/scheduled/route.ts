import { NextRequest, NextResponse } from 'next/server';
import { backupDatabase, cleanupOldBackups } from '@/lib/backup';

/**
 * Scheduled backup endpoint
 * Configure in vercel.json with cron trigger
 * Runs daily at 2 AM UTC
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the request is from Vercel's cron service
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[Backup] Starting scheduled database backup...');

    // Run backup
    const backupResult = await backupDatabase();

    if (backupResult.status === 'failed') {
      console.error('[Backup] Backup failed:', backupResult.errorMessage);
      return NextResponse.json(
        {
          success: false,
          message: 'Backup failed',
          error: backupResult.errorMessage,
        },
        { status: 500 }
      );
    }

    // Cleanup old backups
    const deletedCount = await cleanupOldBackups(30); // Keep 30 days

    console.log(`[Backup] Backup successful. ID: ${backupResult.id}, Duration: ${backupResult.duration}ms`);
    console.log(`[Backup] Cleaned up ${deletedCount} old backups`);

    return NextResponse.json({
      success: true,
      message: 'Backup completed successfully',
      backup: {
        id: backupResult.id,
        timestamp: backupResult.timestamp,
        size: backupResult.size,
        duration: backupResult.duration,
      },
      cleanup: {
        deletedBackups: deletedCount,
      },
    });
  } catch (error) {
    console.error('[Backup] Scheduled backup error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Backup failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Allow GET requests for monitoring/testing
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authorization
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Trigger backup
    const response = await POST(request);
    return response;
  } catch (error) {
    console.error('[Backup] GET error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to trigger backup',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
