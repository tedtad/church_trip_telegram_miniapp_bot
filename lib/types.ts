export type Language = 'en' | 'am';

export interface TelegramUser {
  id: bigint;
  first_name: string;
  last_name?: string;
  username?: string;
  phone_number?: string;
  language_code: Language;
  created_at: string;
  last_interaction: string;
  status: 'active' | 'blocked' | 'suspended';
}

export interface Trip {
  id: string;
  name: string;
  description?: string;
  destination: string;
  image_url?: string;
  trip_image_url?: string;
  cover_image_url?: string;
  bank_accounts?: Array<{
    bank_name: string;
    account_name: string;
    account_number: string;
  }>;
  telebirr_manual_account_name?: string;
  telebirr_manual_account_number?: string;
  manual_payment_note?: string;
  allow_gnpl?: boolean;
  departure_date: string;
  arrival_date?: string;
  price_per_ticket: number;
  total_seats: number;
  available_seats: number;
  created_at: string;
  updated_at: string;
  status: 'active' | 'cancelled' | 'completed';
}

export interface Receipt {
  id: string;
  reference_number: string;
  telegram_user_id: bigint;
  payment_method: 'telebirr' | 'telebirr_auto' | 'bank' | 'gnpl' | 'cash' | 'mobile_money';
  amount_paid: number;
  currency: string;
  quantity: number;
  receipt_file_url?: string;
  receipt_file_name?: string;
  uploaded_at: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  approval_notes?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  serial_number: string;
  receipt_id: string;
  trip_id: string;
  telegram_user_id: bigint;
  seat_number?: string;
  purchase_price: number;
  ticket_status: 'pending' | 'confirmed' | 'cancelled' | 'used' | 'transferred';
  issued_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'system_admin' | 'admin' | 'moderator' | 'analyst' | 'sales_agent' | 'user';
  is_active: boolean;
  created_at: string;
  last_login?: string;
}

export interface ActivityLog {
  id: string;
  admin_id: string;
  action_type: 'ticket_approved' | 'ticket_rejected' | 'user_notified' | 'data_exported' | 'invitation_created';
  entity_type?: string;
  entity_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  telegram_user_id: bigint;
  notification_type: 'ticket_approved' | 'ticket_rejected' | 'new_trip' | 'announcement';
  title: string;
  message: string;
  is_read: boolean;
  read_at?: string;
  created_at: string;
}

export interface Invitation {
  id: string;
  invitation_code: string;
  qr_code_url?: string;
  created_by: string;
  trip_id?: string;
  max_uses?: number;
  current_uses: number;
  discount_percent: number;
  expires_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TelegramChannel {
  id: string;
  telegram_user_id: bigint;
  channel_id?: bigint;
  channel_name?: string;
  channel_username?: string;
  is_active: boolean;
  created_at: string;
}
