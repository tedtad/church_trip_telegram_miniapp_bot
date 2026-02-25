import { NextRequest, NextResponse } from 'next/server'
import { exportTableAsCSV, exportMultipleTablesAsCSV } from '@/lib/backup'

/**
 * GET /api/admin/backups/export - Export data as CSV
 * Query params:
 *   - table: specific table name (or 'all' for all tables)
 *   - format: 'csv' (default)
 *   - all: 'true' to export all tables
 */
export async function GET(request: NextRequest) {
  try {
    const table = request.nextUrl.searchParams.get('table') || 'all'
    const format = request.nextUrl.searchParams.get('format') || 'csv'
    const all = request.nextUrl.searchParams.get('all') === 'true'

    if (format !== 'csv') {
      return NextResponse.json(
        { error: 'Only CSV format is currently supported' },
        { status: 400 }
      )
    }

    let csvContent: string
    let fileName: string

    if (all || table === 'all') {
      // Export all tables
      const tables = [
        'telegram_users',
        'tickets',
        'receipts',
        'admin_users',
        'activity_logs',
        'trips',
        'approvals',
        'notifications',
        'invitations',
        'telegram_channels',
      ]

      const allData = await exportMultipleTablesAsCSV(tables)

      // Combine all tables into one CSV with headers for each section
      const combined = tables
        .map((table) => {
          return `\n\n--- ${table.toUpperCase()} ---\n${allData[table]}`
        })
        .join('')

      csvContent = combined
      fileName = `all-tables-export-${new Date().toISOString().split('T')[0]}.csv`
    } else {
      // Export single table
      csvContent = await exportTableAsCSV(table)
      fileName = `${table}-export-${new Date().toISOString().split('T')[0]}.csv`
    }

    // Return as downloadable CSV
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('[Export API] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
