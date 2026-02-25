import { createClient } from '@/lib/supabase/server'

export interface NotificationPayload {
  userId: number
  type: 'approval' | 'rejection' | 'reminder' | 'update' | 'info'
  title: string
  message: string
  ticketId?: string
  actionURL?: string
}

/**
 * Send notification to customer via Telegram and store in database
 */
export async function sendNotification(
  payload: NotificationPayload
): Promise<{ success: boolean; notificationId?: string; error?: string }> {
  const supabase = await createClient()

  try {
    // Store notification in database
    const { data: notification, error: dbError } = await supabase
      .from('notifications')
      .insert({
        telegram_user_id: payload.userId,
        notification_type: payload.type,
        title: payload.title,
        message: payload.message,
        related_ticket_id: payload.ticketId,
        is_read: false,
      })
      .select('id')
      .single()

    if (dbError) {
      console.error('[v0] Failed to store notification:', dbError)
      throw dbError
    }

    // Send via Telegram bot
    try {
      await sendTelegramNotification(payload.userId, {
        type: payload.type,
        title: payload.title,
        message: payload.message,
        actionURL: payload.actionURL,
      })
    } catch (telegramError) {
      console.error('[v0] Failed to send Telegram notification:', telegramError)
      // Continue - notification is stored even if Telegram fails
    }

    return {
      success: true,
      notificationId: notification?.id,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[v0] Notification error:', errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Send Telegram message notification
 */
export async function sendTelegramNotification(
  userId: number,
  options: {
    type: string
    title: string
    message: string
    actionURL?: string
  }
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured')
  }

  // Format message with emoji based on type
  const emojis: { [key: string]: string } = {
    approval: '✅',
    rejection: '❌',
    reminder: '🔔',
    update: '📢',
    info: 'ℹ️',
  }

  const emoji = emojis[options.type] || '📨'

  let messageText = `${emoji} *${options.title}*\n\n${options.message}`

  if (options.actionURL) {
    messageText += `\n\n[View Ticket](${options.actionURL})`
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: messageText,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Telegram API error: ${error.description}`)
    }
  } catch (error) {
    console.error('[v0] Telegram notification error:', error)
    throw error
  }
}

/**
 * Notify admin about new receipt for approval
 */
export async function notifyAdminNewReceipt(receiptId: string, customerName: string): Promise<void> {
  try {
    const supabase = await createClient()

    // Get all active admin users
    const { data: admins, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('is_active', true)

    if (error) throw error

    // Notify each admin
    for (const admin of admins || []) {
      await sendNotification({
        userId: -1, // Will be admin's Telegram ID in production
        type: 'info',
        title: 'New Receipt Awaiting Approval',
        message: `Customer "${customerName}" has submitted a receipt for approval. Reference: ${receiptId}`,
        actionURL: `/admin/tickets?ref=${receiptId}`,
      })
    }
  } catch (error) {
    console.error('[v0] Admin notification error:', error)
  }
}

/**
 * Notify customer of ticket approval
 */
export async function notifyTicketApproved(
  userId: number,
  ticketId: string,
  serialNumber: string
): Promise<void> {
  await sendNotification({
    userId,
    type: 'approval',
    title: 'Your Ticket is Approved!',
    message: `Your ticket has been approved. Serial number: ${serialNumber}\n\nYour digital ticket is ready. Use it for boarding.`,
    ticketId,
    actionURL: `/my-tickets/${ticketId}`,
  })
}

/**
 * Notify customer of ticket rejection
 */
export async function notifyTicketRejected(
  userId: number,
  ticketId: string,
  reason: string
): Promise<void> {
  await sendNotification({
    userId,
    type: 'rejection',
    title: 'Ticket Rejected',
    message: `Your ticket was rejected.\n\nReason: ${reason}\n\nPlease contact admin for assistance.`,
    ticketId,
  })
}

/**
 * Send bulk notifications to multiple customers
 */
export async function sendBulkNotifications(
  userIds: number[],
  notification: Omit<NotificationPayload, 'userId'>
): Promise<{
  successful: number
  failed: number
  errors: Array<{ userId: number; error: string }>
}> {
  const results = {
    successful: 0,
    failed: 0,
    errors: [] as Array<{ userId: number; error: string }>,
  }

  for (const userId of userIds) {
    try {
      const result = await sendNotification({
        ...notification,
        userId,
      })

      if (result.success) {
        results.successful++
      } else {
        results.failed++
        results.errors.push({
          userId,
          error: result.error || 'Unknown error',
        })
      }
    } catch (error) {
      results.failed++
      results.errors.push({
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}

/**
 * Get unread notifications for user
 */
export async function getUnreadNotifications(userId: number, limit = 10): Promise<any[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('telegram_user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[v0] Failed to fetch notifications:', error)
    return []
  }

  return data || []
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)

  if (error) {
    console.error('[v0] Failed to mark notification as read:', error)
    return false
  }

  return true
}
