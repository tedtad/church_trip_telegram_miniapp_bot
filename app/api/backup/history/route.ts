import { NextRequest, NextResponse } from 'next/server';
import { getBackupHistory } from '@/lib/backup';

/**
 * Get backup history
 */
export async function GET(request: NextRequest) {
  try {
    const limit = request.nextUrl.searchParams.get('limit') || '30';
    const backups = await getBackupHistory(parseInt(limit));

    return NextResponse.json({
      success: true,
      backups,
      count: backups.length,
    });
  } catch (error) {
    console.error('[Backup] History fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch backup history',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
