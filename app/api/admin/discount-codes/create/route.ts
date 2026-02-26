import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPermission } from '@/lib/admin-rbac'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'discounts_manage',
    })
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }
    const body = await request.json()

    const { code, discountPercent, maxUses, tripId, validFrom, expiresAt, isActive } = body

    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    if (discountPercent === undefined || discountPercent < 0 || discountPercent > 100) {
      return NextResponse.json({ error: 'Discount percent must be between 0 and 100' }, { status: 400 })
    }

    // Check if code already exists
    const { data: existing } = await supabase
      .from('invitations')
      .select('id')
      .eq('invitation_code', code.toUpperCase())
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'This discount code already exists' }, { status: 400 })
    }

    // Create the discount code
    const { data, error } = await supabase
      .from('invitations')
      .insert({
        invitation_code: code.toUpperCase(),
        discount_percent: discountPercent,
        max_uses: maxUses,
        current_uses: 0,
        trip_id: tripId || null,
        valid_from: validFrom || null,
        expires_at: expiresAt || null,
        is_active: isActive !== false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, code: data })
  } catch (error) {
    console.error('[v0] Error creating discount code:', error)
    return NextResponse.json({ error: 'Failed to create discount code' }, { status: 500 })
  }
}
