import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAdminAuditLog } from '@/lib/admin-audit'
import { generateQRCodeDataURL } from '@/lib/qr-code'
import { normalizeDiscountCode } from '@/lib/discount-vouchers'
import { requireAdminPermission } from '@/lib/admin-rbac'

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase()
  return message.includes('column') && message.includes(columnName.toLowerCase())
}

type CreateDiscountInput = {
  invitationCode?: string
  tripId?: string | null
  maxUses?: number | null
  discountPercent?: number | null
  validFrom?: string | null
  expiresAt?: string | null
  target?: 'booking' | 'charity'
  campaignId?: string | null
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
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'invitations_manage',
    })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const adminId = auth.actor.id

    // Generate unique invitation code
    const providedCode = normalizeDiscountCode(body.invitationCode)
    const invitationCode = providedCode || `DISC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    const maxUsesRaw = body.maxUses
    const maxUses =
      maxUsesRaw === null || maxUsesRaw === undefined || Number(maxUsesRaw) <= 0
        ? null
        : Math.floor(Number(maxUsesRaw))
    const target = String(body.target || '').trim().toLowerCase() === 'charity' ? 'charity' : 'booking'
    const campaignId = String(body.campaignId || '').trim()
    const discountInput = body.discountPercent
    const defaultDiscountPercent = target === 'charity' ? 0 : 10
    const discountPercentRaw =
      discountInput === null || discountInput === undefined || String(discountInput).trim() === ''
        ? defaultDiscountPercent
        : Number(discountInput)
    const discountPercent = Number(discountPercentRaw.toFixed(2))
    const validFrom = parseDateOrNull(body.validFrom)
    const expiresAt = parseDateOrNull(body.expiresAt)

    if (!invitationCode) {
      return NextResponse.json({ success: false, error: 'Discount code is required' }, { status: 400 })
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent >= 100) {
      return NextResponse.json(
        { success: false, error: 'Discount percent must be from 0 to less than 100' },
        { status: 400 }
      )
    }
    if (target === 'booking' && discountPercent <= 0) {
      return NextResponse.json(
        { success: false, error: 'Discount percent must be greater than 0 for booking invitations' },
        { status: 400 }
      )
    }
    if (target === 'charity' && !campaignId) {
      return NextResponse.json(
        { success: false, error: 'Campaign is required for charity invitations' },
        { status: 400 }
      )
    }
    if (validFrom && expiresAt && new Date(validFrom).getTime() >= new Date(expiresAt).getTime()) {
      return NextResponse.json(
        { success: false, error: 'Valid from date must be earlier than expiry date' },
        { status: 400 }
      )
    }
    if (target === 'charity' && campaignId) {
      const { data: campaign, error: campaignError } = await supabase
        .from('charity_campaigns')
        .select('id')
        .eq('id', campaignId)
        .maybeSingle()
      if (campaignError || !campaign) {
        return NextResponse.json(
          { success: false, error: 'Selected charity campaign was not found' },
          { status: 400 }
        )
      }
    }

    const inviteParams = new URLSearchParams()
    if (target === 'charity') {
      inviteParams.set('target', 'charity')
      if (campaignId) inviteParams.set('campaignId', campaignId)
    }
    const inviteQuery = inviteParams.toString()
    const inviteURL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tickethub.app'}/invite/${invitationCode}${inviteQuery ? `?${inviteQuery}` : ''}`

    // Generate QR code
    const qrCode = await generateQRCodeDataURL(inviteURL)

    let createPayload: Record<string, unknown> = {
      invitation_code: invitationCode,
      qr_code_data: qrCode,
      qr_code_url: inviteURL,
      created_by: adminId,
      trip_id: body.tripId ? String(body.tripId) : null,
      max_uses: maxUses,
      current_uses: 0,
      discount_percent: discountPercent,
      target,
      campaign_id: target === 'charity' ? campaignId : null,
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
      if (isMissingColumn(result.error, 'target') && 'target' in createPayload) {
        delete createPayload.target
        continue
      }
      if (isMissingColumn(result.error, 'campaign_id') && 'campaign_id' in createPayload) {
        delete createPayload.campaign_id
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
        target,
        campaignId: campaignId || null,
        validFrom,
        expiresAt,
        isActive: createResult.data?.is_active ?? true,
      },
    })

    return NextResponse.json({
      success: true,
      invite_url: inviteURL,
      invitation: createResult.data,
    })
  } catch (error) {
    console.error('[v0] Error creating invitation:', error)
    const rawMessage = String((error as any)?.message || '').trim()
    const lower = rawMessage.toLowerCase()
    const errorMessage = lower.includes('row-level security')
      ? 'Database denied invitation creation. Ensure SUPABASE_SERVICE_ROLE_KEY is configured for admin APIs.'
      : rawMessage || 'Failed to create invitation'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}
