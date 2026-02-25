# Database Setup Guide

This guide helps you set up the Telegram Ticket Reservation System database in Supabase.

## Step 1: Copy the SQL Script

Copy the entire content of `/scripts/01-setup-database.sql`

## Step 2: Run in Supabase SQL Editor

1. Go to your Supabase project at https://supabase.com
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. Paste the entire SQL script
5. Click **Run** (or press Ctrl/Cmd + Enter)

## Database Schema Overview

The system creates these 10 tables:

### 1. **telegram_users** - Customer information
- Stores Telegram user data (ID, name, username, phone, language preference)
- Prevents duplicate customer registration

### 2. **trips** - Available trips/tours
- Destination, dates, pricing, seat availability
- Track trip status (active, cancelled, completed)

### 3. **receipts** - Payment records
- **UNIQUE reference_number** - Prevents double registration with same payment
- Links to customer and payment method
- Tracks quantity of tickets purchased
- Supports payment methods: bank, cash, telebirr, mobile_money
- Stores receipt file URL and approval status

### 4. **tickets** - Individual tickets
- One or more tickets per receipt (based on quantity purchased)
- **UNIQUE serial_number** - Unique code for each ticket
- Links to receipt, trip, and customer
- Tracks ticket status (pending, confirmed, cancelled, used)

### 5. **admin_users** - Admin account management
- Email, name, role (admin, moderator, analyst)
- Active status and last login timestamp

### 6. **activity_logs** - Audit trail
- Records every admin action
- Stores admin ID, action type, entity details
- Includes IP address and user agent for security

### 7. **approvals** - Approval history
- Links admin to approval decisions
- Stores approval/rejection status and notes

### 8. **invitations** - QR codes & affiliate links
- Invitation codes with usage tracking
- QR code URL generation support
- Discount percent and expiration date
- Used for customer acquisition

### 9. **notifications** - Customer notifications
- Stores notification messages
- Tracks read status for customer portal

### 10. **telegram_channels** - Direct messaging channels
- Auto-created when customer registers
- Stores Telegram channel ID for admin-customer communication

## Indexes Created

Performance indexes are created for:
- Receipt reference number (fast duplicate detection)
- Telegram user lookups
- Ticket serial number (unique check)
- Admin activity tracking
- Customer notifications

## Triggers & Functions

Auto-updated `updated_at` timestamps on:
- receipts
- tickets
- trips
- invitations

## Key Features

✅ **Reference Number Unique Constraint** - Prevents duplicate payment registration
✅ **Quantity Support** - One receipt can have multiple tickets
✅ **Serial Numbers** - Each ticket gets a unique serial for digital generation
✅ **Admin Logging** - All approvals tracked with admin ID
✅ **Audit Trail** - IP and user agent stored for security
✅ **Payment Methods** - Supports bank, cash, telebirr, mobile_money
✅ **Multi-admin Support** - Multiple admins with role-based access
✅ **Auto Timestamps** - Updated_at automatically maintained

## Troubleshooting

### "Already exists" errors
If you see "relation already exists", that's OK. The schema has `IF NOT EXISTS` clauses.

### Foreign key errors
Ensure you run the entire script in one execution. The order of table creation matters.

### RLS (Row Level Security) Notes
Currently, RLS is disabled for easier initial setup. Add RLS policies after initial testing if needed.

## Next Steps

1. Run the database migration script
2. Set your Telegram Bot Token in `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=your_token_here
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   ```
3. Start building!
