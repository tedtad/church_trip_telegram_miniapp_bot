import { createClient } from '@/lib/supabase/client';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

export interface TelegramMessage {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: {
      id: number;
      type: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    text?: string;
    caption?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id?: string;
      file_size?: number;
      width?: number;
      height?: number;
    }>;
    document?: {
      file_id: string;
      file_unique_id?: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
      language_code?: string;
    };
    chat_instance: string;
    data?: string;
    message?: any;
  };
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: any
) {
  try {
    const response = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...options,
      }),
    });

    if (!response.ok) {
      console.error('[telegram] Error sending message:', await response.text());
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('[telegram] Fetch error:', error);
    return null;
  }
}

export async function sendTelegramPhoto(
  chatId: number | string,
  photo: string,
  caption?: string,
  options?: any
) {
  try {
    const response = await fetch(`${API_BASE}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        caption,
        ...options,
      }),
    });

    if (!response.ok) {
      console.error('[telegram] Error sending photo:', await response.text());
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('[telegram] Photo send error:', error);
    return null;
  }
}

export async function sendTelegramDocument(
  chatId: number | string,
  document: string,
  caption?: string,
  options?: any
) {
  try {
    const response = await fetch(`${API_BASE}/sendDocument`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        document,
        caption,
        ...options,
      }),
    });

    if (!response.ok) {
      console.error('[telegram] Error sending document:', await response.text());
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('[telegram] Document send error:', error);
    return null;
  }
}

export async function sendTelegramMediaGroup(
  chatId: number | string,
  media: Array<Record<string, unknown>>
) {
  try {
    const response = await fetch(`${API_BASE}/sendMediaGroup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        media,
      }),
    });

    if (!response.ok) {
      console.error('[telegram] Error sending media group:', await response.text());
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('[telegram] Media group send error:', error);
    return null;
  }
}

export async function answerCallbackQuery(queryId: string, text: string, showAlert = false) {
  try {
    await fetch(`${API_BASE}/answerCallbackQuery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callback_query_id: queryId,
        text,
        show_alert: showAlert,
      }),
    });
  } catch (error) {
    console.error('[telegram] Callback query error:', error);
  }
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  options?: any
) {
  try {
    await fetch(`${API_BASE}/editMessageText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        ...options,
      }),
    });
  } catch (error) {
    console.error('[telegram] Edit message error:', error);
  }
}

export async function downloadFile(filePath: string) {
  try {
    const response = await fetch(`${API_BASE}/download_file?path=${filePath}`);
    if (!response.ok) return null;
    return response.blob();
  } catch (error) {
    console.error('[telegram] Download error:', error);
    return null;
  }
}

export async function getFile(fileId: string) {
  try {
    const response = await fetch(`${API_BASE}/getFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.result;
  } catch (error) {
    console.error('[telegram] Get file error:', error);
    return null;
  }
}

export async function getTelegramUserProfilePhotoUrl(userId: number | string): Promise<string | null> {
  try {
    const profileRes = await fetch(`${API_BASE}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        limit: 1,
      }),
    });
    if (!profileRes.ok) return null;
    const profileData = await profileRes.json().catch(() => ({}));
    const photos = profileData?.result?.photos;
    const firstSet = Array.isArray(photos) ? photos[0] : null;
    const firstPhoto = Array.isArray(firstSet) ? firstSet[firstSet.length - 1] : null;
    const fileId = String(firstPhoto?.file_id || '').trim();
    if (!fileId) return null;

    const fileMeta = await getFile(fileId);
    const filePath = String(fileMeta?.file_path || '').trim();
    if (!filePath || !BOT_TOKEN) return null;
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  } catch (error) {
    console.error('[telegram] get profile photo error:', error);
    return null;
  }
}

export async function createTelegramChatInviteLink(
  chatId: number | string,
  name?: string
): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        name: String(name || '').trim() || undefined,
      }),
    });

    if (!response.ok) {
      console.error('[telegram] create invite link failed:', await response.text());
      return null;
    }
    const data = await response.json().catch(() => ({}));
    const link = String(data?.result?.invite_link || '').trim();
    return link || null;
  } catch (error) {
    console.error('[telegram] create invite link error:', error);
    return null;
  }
}

// Generate a unique serial number for tickets
export function generateSerialNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

export function generateTripSerialNumber(
  tripName: string | null | undefined,
  tripId: string,
  index = 0
): string {
  const words = String(tripName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const initials =
    words.length > 0 ? words.map((w) => w[0]).join('').slice(0, 3).padEnd(3, 'X') : 'TRP';
  const tripToken = String(tripId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
    .padEnd(4, '0');
  const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
  const seq = String(index + 1).padStart(2, '0');
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();

  return `${initials}-${tripToken}-${timestamp}${seq}${random}`;
}

// Generate ticket number
export function generateTicketNumber(receiptId: string): string {
  const shortId = receiptId.substring(0, 8).toUpperCase();
  const num = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${shortId}-${num}`;
}

export async function registeredTelegramUser(userId: bigint): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('telegram_users')
      .select('id')
      .eq('id', userId)
      .single();

    return !!data;
  } catch (error) {
    console.error('[telegram] Check user error:', error);
    return false;
  }
}

export async function createOrUpdateTelegramUser(
  userId: bigint,
  firstName: string,
  lastName?: string,
  username?: string,
  languageCode?: string
) {
  try {
    const supabase = createClient();

    const { error } = await supabase.from('telegram_users').upsert(
      {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        username,
        language_code: languageCode === 'am' ? 'am' : 'en',
        last_interaction: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) {
      console.error('[telegram] Create/update user error:', error);
      return null;
    }

    return true;
  } catch (error) {
    console.error('[telegram] Unexpected error:', error);
    return null;
  }
}
