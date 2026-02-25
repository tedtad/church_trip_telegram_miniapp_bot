import { createClient } from '@/lib/supabase/client'

export interface AppSettings {
  id: string
  logo_url: string | null
  logo_filename: string | null
  app_name: string
  app_description: string
  app_color: string
  receipt_cache_ttl: number
  max_file_size: number
  supported_file_types: string[]
  smtp_enabled: boolean
  sms_enabled: boolean
  telegram_notifications_enabled: boolean
  two_factor_enabled: boolean
  maintenance_mode: boolean
  maintenance_message: string | null
  telegram_channel_chat_id?: string | null
  telegram_channel_url?: string | null
  telegram_channel_name?: string | null
  telegram_post_new_trip?: boolean
  telegram_post_weekly_summary?: boolean
  telegram_post_daily_countdown?: boolean
  telegram_recommendation_interval_hours?: number
  telegram_last_recommendation_post_at?: string | null
  telegram_last_weekly_post_at?: string | null
  telegram_last_daily_post_date?: string | null
  gnpl_enabled?: boolean
  gnpl_require_admin_approval?: boolean
  gnpl_default_term_days?: number
  gnpl_penalty_enabled?: boolean
  gnpl_penalty_percent?: number
  gnpl_penalty_period_days?: number
  gnpl_reminder_enabled?: boolean
  gnpl_reminder_days_before?: number
  receipt_intelligence_enabled?: boolean
  receipt_sample_collection_enabled?: boolean
  created_at: string
  updated_at: string
}

export async function getAppSettings(): Promise<AppSettings | null> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('[v0] Error fetching app settings:', error)
      return null
    }

    return data || null
  } catch (error) {
    console.error('[v0] App settings fetch failed:', error)
    return null
  }
}

export async function updateAppSettings(updates: Partial<AppSettings>): Promise<boolean> {
  try {
    const supabase = createClient()
    const { error } = await supabase
      .from('app_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 'default')

    if (error) {
      console.error('[v0] Error updating settings:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('[v0] Settings update failed:', error)
    return false
  }
}

export async function uploadLogo(file: File): Promise<string | null> {
  try {
    const supabase = createClient()
    const fileExt = file.name.split('.').pop()
    const fileName = `logo-${Date.now()}.${fileExt}`
    const filePath = `app-logos/${fileName}`

    const { data, error } = await supabase.storage
      .from('app-files')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      })

    if (error) {
      console.error('[v0] Logo upload failed:', error)
      return null
    }

    const { data: urlData } = supabase.storage
      .from('app-files')
      .getPublicUrl(data.path)

    return urlData.publicUrl
  } catch (error) {
    console.error('[v0] Logo upload error:', error)
    return null
  }
}

export async function deleteLogo(filePath: string): Promise<boolean> {
  try {
    const supabase = createClient()
    const { error } = await supabase.storage
      .from('app-files')
      .remove([filePath])

    if (error) {
      console.error('[v0] Logo deletion failed:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('[v0] Logo deletion error:', error)
    return false
  }
}
