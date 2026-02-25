import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()

    const { data, error } = await supabase
      .from('invitations')
      .select('id, invitation_code, discount_percent, max_uses, current_uses, trip_id, valid_from, expires_at, is_active, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error

    const codes = (data || []).map((row: any) => ({
      id: row.id,
      code: row.invitation_code || '',
      discountPercent: row.discount_percent || 0,
      maxUses: row.max_uses,
      currentUses: row.current_uses || 0,
      tripId: row.trip_id,
      tripName: null,
      validFrom: row.valid_from,
      expiresAt: row.expires_at,
      isActive: row.is_active !== false,
      createdAt: row.created_at,
    }))

    return NextResponse.json({ codes })
  } catch (error) {
    console.error('[v0] Error fetching discount codes:', error)
    return NextResponse.json({ error: 'Failed to fetch discount codes' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const body = await request.json()

    const { error } = await supabase
      .from('invitations')
      .update({
        discount_percent: body.discountPercent,
        max_uses: body.maxUses,
        trip_id: body.tripId || null,
        valid_from: body.validFrom || null,
        expires_at: body.expiresAt || null,
        is_active: body.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Error updating discount code:', error)
    return NextResponse.json({ error: 'Failed to update discount code' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const { error } = await supabase.from('invitations').delete().eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Error deleting discount code:', error)
    return NextResponse.json({ error: 'Failed to delete discount code' }, { status: 500 })
  }
}
