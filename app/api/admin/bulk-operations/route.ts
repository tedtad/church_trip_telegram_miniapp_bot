import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendBulkNotifications } from '@/lib/notifications'

async function getFallbackAdminId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase
    .from('admin_users')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  return data?.id || null
}

async function createBulkOperationLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  adminId: string | null,
  operationType: string,
  targetCount: number
) {
  const basePayload = {
    admin_id: adminId,
    entity_type: 'bulk_operation',
    description: `Bulk ${operationType} for ${targetCount} customers`,
    metadata: {
      type: operationType,
      targetCount,
      processedCount: 0,
      failedCount: 0,
      status: 'pending',
    },
  }

  const actionRes = await supabase
    .from('activity_logs')
    .insert({
      ...basePayload,
      action: `BULK_${operationType.toUpperCase()}`,
    })
    .select()
    .single()

  if (!actionRes.error) return actionRes

  const actionTypeRes = await supabase
    .from('activity_logs')
    .insert({
      ...basePayload,
      action_type: `BULK_${operationType.toUpperCase()}`,
    })
    .select()
    .single()

  return actionTypeRes
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('entity_type', 'bulk_operation')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    const operations =
      data?.map((op) => {
        const metadata = (op.metadata || {}) as Record<string, unknown>
        const type = typeof metadata.type === 'string' ? metadata.type : 'notify'
        const status = typeof metadata.status === 'string' ? metadata.status : 'completed'
        const targetCount =
          typeof metadata.targetCount === 'number' ? metadata.targetCount : 0
        const processedCount =
          typeof metadata.processedCount === 'number' ? metadata.processedCount : 0
        const failedCount =
          typeof metadata.failedCount === 'number' ? metadata.failedCount : 0
        return {
          id: op.id,
          type,
          status,
          targetCount,
          processedCount,
          failedCount,
          createdAt: op.created_at,
        }
      }) || []

    return NextResponse.json({ success: true, operations })
  } catch (error) {
    console.error('[v0] Bulk operations fetch error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch operations' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const operationType = formData.get('type') as string

    if (!file || !operationType) {
      return NextResponse.json(
        { success: false, error: 'Missing file or operation type' },
        { status: 400 }
      )
    }

    // Parse CSV
    const text = await file.text()
    const lines = text.split('\n')
    const userIds = lines
      .slice(1)
      .map((line) => parseInt(line.split(',')[0]))
      .filter((id) => !isNaN(id))

    const supabase = await createClient()
    const adminId = await getFallbackAdminId(supabase)

    // Create operation record
    const { data: operation, error: opError } = await createBulkOperationLog(
      supabase,
      adminId,
      operationType,
      userIds.length
    )

    if (opError) throw opError

    // Process based on type
    let result
    switch (operationType) {
      case 'notify':
        result = await sendBulkNotifications(userIds, {
          type: 'info',
          title: 'Important Update',
          message: 'Please check your tickets for updates',
        })
        break
      case 'approve':
        // TODO: Implement bulk approve
        result = { successful: 0, failed: 0, errors: [] }
        break
      case 'reject':
        // TODO: Implement bulk reject
        result = { successful: 0, failed: 0, errors: [] }
        break
      default:
        result = { successful: 0, failed: 0, errors: [] }
    }

    const finalStatus =
      result.failed > 0 && result.successful === 0 ? 'failed' : 'completed'

    await supabase
      .from('activity_logs')
      .update({
        metadata: {
          type: operationType,
          targetCount: userIds.length,
          processedCount: result.successful,
          failedCount: result.failed,
          status: finalStatus,
        },
      })
      .eq('id', operation.id)

    return NextResponse.json({
      success: true,
      operation: {
        id: operation.id,
        type: operationType,
        status: finalStatus,
        targetCount: userIds.length,
        processedCount: result.successful,
        failedCount: result.failed,
        createdAt: operation.created_at,
      },
    })
  } catch (error) {
    console.error('[v0] Bulk operation error:', error)
    return NextResponse.json(
      { success: false, error: 'Bulk operation failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const operationId = request.nextUrl.searchParams.get('id')
    if (!operationId) {
      return NextResponse.json(
        { success: false, error: 'Missing operation id' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('activity_logs')
      .delete()
      .eq('id', operationId)
      .eq('entity_type', 'bulk_operation')

    if (error) throw error

    return NextResponse.json({ success: true, id: operationId })
  } catch (error) {
    console.error('[v0] Bulk operation delete error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete operation' },
      { status: 500 }
    )
  }
}
