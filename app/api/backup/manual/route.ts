import { NextRequest, NextResponse } from 'next/server';
import { backupDatabase } from '@/lib/backup';

/**
 * Manual backup trigger endpoint
 * Admin users can trigger a backup anytime
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Backup] Manual backup triggered');

    const result = await backupDatabase();

    if (result.status === 'failed') {
      return NextResponse.json(
        {
          success: false,
          message: 'Backup failed',
          error: result.errorMessage,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Backup created successfully',
      backup: {
        id: result.id,
        timestamp: result.timestamp,
        size: result.size,
        duration: result.duration,
      },
    });
  } catch (error) {
    console.error('[Backup] Manual backup error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to create backup',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
