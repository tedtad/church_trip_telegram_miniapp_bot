import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    const supabase = await createClient()
    const fileExt = file.name.split('.').pop()
    const fileName = `logo-${Date.now()}.${fileExt}`
    const filePath = `app-logos/${fileName}`

    const buffer = await file.arrayBuffer()
    const { error: uploadError } = await supabase.storage
      .from('app-files')
      .upload(filePath, buffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: urlData } = supabase.storage
      .from('app-files')
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
