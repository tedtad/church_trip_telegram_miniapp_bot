import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminPermission } from '@/lib/admin-rbac'

const LOGO_BUCKET = 'app-files'

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '')
  if (!message.toLowerCase().includes('column')) return null

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/)
  if (quoted?.[1]) return quoted[1].split('.').pop() || null

  const doubleQuoted = message.match(/\"([a-zA-Z0-9_.]+)\"/)
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null
  return null
}

function isMissingAppSettingsRelation(error: unknown) {
  const code = String((error as any)?.code || '').toUpperCase()
  const message = String((error as any)?.message || '').toLowerCase()
  return code === '42P01' || (message.includes('relation') && message.includes('app_settings') && message.includes('does not exist'))
}

function isBucketNotFoundError(error: unknown) {
  const message = String((error as any)?.message || '').toLowerCase()
  return message.includes('bucket not found') || message.includes('does not exist')
}

async function ensureLogoBucket(supabase: any) {
  const bucketResult = await supabase.storage.getBucket(LOGO_BUCKET)
  if (!bucketResult.error && bucketResult.data) return

  const createResult = await supabase.storage.createBucket(LOGO_BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  })
  if (createResult.error) {
    const message = String(createResult.error.message || '').toLowerCase()
    if (!message.includes('already exists') && !message.includes('duplicate')) {
      throw createResult.error
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient()
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'settings_manage',
    })
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    const fileExt = file.name.split('.').pop()
    const fileName = `logo-${Date.now()}.${fileExt}`
    const filePath = `app-logos/${fileName}`

    const buffer = await file.arrayBuffer()
    await ensureLogoBucket(supabase)

    let uploadError: any = null
    {
      const uploadResult = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(filePath, buffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type,
        })
      uploadError = uploadResult.error
    }

    if (uploadError && isBucketNotFoundError(uploadError)) {
      await ensureLogoBucket(supabase)
      const retryResult = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(filePath, buffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type,
        })
      uploadError = retryResult.error
    }

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message || 'Logo upload failed' }, { status: 500 })
    }

    const { data: urlData } = supabase.storage
      .from(LOGO_BUCKET)
      .getPublicUrl(filePath)

    // Update settings with new logo URL
    const { error: updateError } = await supabase
      .from('app_settings')
      .upsert(
        {
          id: 'default',
          logo_url: urlData.publicUrl,
          logo_filename: filePath,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )

    if (updateError) {
      if (isMissingAppSettingsRelation(updateError)) {
        return NextResponse.json(
          {
            error: 'app_settings table is missing. Run DB migrations: scripts/06-automation-discount-and-booking-enhancements.sql, scripts/08-gnpl-credit-module.sql, scripts/10-receipt-intelligence-settings.sql, scripts/13-miniapp-feature-flags.sql',
          },
          { status: 500 }
        )
      }
      const missingColumn = detectMissingColumn(updateError)
      if (missingColumn) {
        return NextResponse.json(
          {
            error: `Missing app_settings column \"${missingColumn}\". Run DB migrations: scripts/06-automation-discount-and-booking-enhancements.sql, scripts/08-gnpl-credit-module.sql, scripts/10-receipt-intelligence-settings.sql, scripts/13-miniapp-feature-flags.sql`,
          },
          { status: 500 }
        )
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, logo_url: urlData.publicUrl }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}

