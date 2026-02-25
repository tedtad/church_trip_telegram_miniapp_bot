import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAdminId, writeAdminAuditLog } from '@/lib/admin-audit'
import { generateQRCodeDataURL } from '@/lib/qr-code'
import { normalizeDiscountCode } from '@/lib/discount-vouchers'

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase()
  return message.includes('column') && message.includes(columnName.toLowerCase())
}

type CreateDiscountInput = {
  adminId?: string
  invitationCode?: string
  tripId?: string | null
  maxUses?: number | null
  discountPercent?: number | null
  validFrom?: string | null
  expiresAt?: string | null
}

function parseDateOrNull(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateDiscountInput
    const supabase = await createAdminClient()
    const adminId = await resolveAdminId(supabase, request, body.adminId || null)

    // Generate unique invitation code
    const providedCode = normalizeDiscountCode(body.invitationCode)
    const invitationCode = providedCode || `DISC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    const maxUsesRaw = body.maxUses
    const maxUses =
      maxUsesRaw === null || maxUsesRaw === undefined || Number(maxUsesRaw) <= 0
        ? null
        : Math.floor(Number(maxUsesRaw))
    const discountPercent = Number(Number(body.discountPercent || 0).toFixed(2))
    const validFrom = parseDateOrNull(body.validFrom)
    const expiresAt = parseDateOrNull(body.expiresAt)

    if (!invitationCode) {
      return NextResponse.json({ success: false, error: 'Discount code is required' }, { status: 400 })
    }
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100) {
      return NextResponse.json(
        { success: false, error: 'Discount percent must be between 0 and 100' },
        { status: 400 }
      )
    }
    if (validFrom && expiresAt && new Date(validFrom).getTime() >= new Date(expiresAt).getTime()) {
      return NextResponse.json(
        { success: false, error: 'Valid from date must be earlier than expiry date' },
        { status: 400 }
      )
    }

    const inviteURL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tickethub.app'}/invite/${invitationCode}`

    // Generate QR code
    const qrCode = await generateQRCodeDataURL(inviteURL)

    let createPayload: Record<string, unknown> = {
      invitation_code: invitationCode,
      qr_code_data: qrCode,
      qr_code_url: qrCode,
      created_by: adminId,
      trip_id: body.tripId ? String(body.tripId) : null,
      max_uses: maxUses,
      current_uses: 0,
      discount_percent: discountPercent,
      valid_from: validFrom,
      expires_at: expiresAt,
      is_active: true,
    }
    let createResult: any = null

    for (let attempt = 0; attempt < 18; attempt += 1) {
      const result = await supabase
        .from('invitations')
        .insert(createPayload)
        .select()
        .single()
      if (!result.error) {
        createResult = result
        break
      }

      if (isMissingColumn(result.error, 'qr_code_data') && 'qr_code_data' in createPayload) {
        delete createPayload.qr_code_data
        continue
      }
      if (isMissingColumn(result.error, 'qr_code_url') && 'qr_code_url' in createPayload) {
        delete createPayload.qr_code_url
        continue
      }
      if (isMissingColumn(result.error, 'discount_percent') && 'discount_percent' in createPayload) {
        delete createPayload.discount_percent
        continue
      }
      if (isMissingColumn(result.error, 'valid_from') && 'valid_from' in createPayload) {
        delete createPayload.valid_from
        continue
      }
      if (isMissingColumn(result.error, 'current_uses') && 'current_uses' in createPayload) {
        delete createPayload.current_uses
        continue
      }
      if (isMissingColumn(result.error, 'trip_id') && 'trip_id' in createPayload) {
        delete createPayload.trip_id
        continue
      }
      if (isMissingColumn(result.error, 'max_uses') && 'max_uses' in createPayload) {
        delete createPayload.max_uses
        continue
      }
      if (isMissingColumn(result.error, 'expires_at') && 'expires_at' in createPayload) {
        delete createPayload.expires_at
        continue
      }
      if (isMissingColumn(result.error, 'is_active') && 'is_active' in createPayload) {
        delete createPayload.is_active
        continue
      }
      throw result.error
    }

    if (!createResult?.data) {
      throw new Error('Failed to create discount code')
    }

    await writeAdminAuditLog(supabase, {
      adminId,
      action: 'INVITATION_CREATE',
      entityType: 'invitation',
      entityId: createResult.data?.id || null,
      description: `Created discount code ${invitationCode}`,
      metadata: {
        invitationId: createResult.data?.id || null,
        invitationCode,
        discountPercent,
        maxUses: createResult.data?.max_uses ?? maxUses,
        tripId: body.tripId || null,
        validFrom,
        expiresAt,
        isActive: createResult.data?.is_active ?? true,
      },
    })

    return NextResponse.json({
      success: true,
      invitation: createResult.data,
    })
  } catch (error) {
    console.error('[v0] Error creating invitation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create invitation' },
      { status: 500 }
    )
  }
}
