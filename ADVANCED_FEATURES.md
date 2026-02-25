# TicketHub Advanced Features Guide

Complete guide to advanced features and how to use them.

## Table of Contents

1. QR Code Invitations
2. Telebirr Payment Integration
3. Real-time Notifications
4. Bulk Operations
5. Activity Auditing
6. Advanced Analytics
7. Custom Branding

---

## 1. QR Code Invitations

Generate shareable QR codes for customer acquisition.

### Features

- Unique invitation codes
- QR code generation
- One-click sharing
- Limited use tracking
- Expiration dates
- Trip-specific invites

### Admin Usage

1. **Go to:** Admin Dashboard → Invitations
2. **Click:** "Create New Invitation"
3. **System generates:**
   - Unique invitation code (e.g., INV-1234567890-ABCDEFGH)
   - QR code image
   - Shareable link

### Customize Invitations

```typescript
// lib/qr-code.ts - Advanced options
const invitation = await generateInvitationQRCode(
  code,
  baseURL,
  {
    maxUses: 100,        // Limit redemptions
    expiresIn: 30,       // Days until expiration
    tripId: 'uuid',      // Specific trip
  }
)
```

### Integration Example

```typescript
// Send via Telegram to bulk group
await bot.sendMessage(
  groupChatId,
  `Join our trip! ${inviteURL}`
)

// Or via SMS/Email
await sendSMS(phone, inviteURL)
await sendEmail(email, inviteURL)
```

---

## 2. Telebirr Payment Integration

Direct payment processing through Telebirr (Ethiopian payment gateway).

### Setup

1. Get Telebirr API credentials
2. Add to environment:
   ```
   TELEBIRR_API_KEY=your_api_key
   TELEBIRR_MERCHANT_ID=your_merchant_id
   TELEBIRR_API_URL=https://api.telebirr.com/v1
   ```
3. Redeploy

### Features

- Direct payment initiation
- Phone number payment
- Payment verification
- Webhook handling
- Demo mode support

### Customer Payment Flow

```
1. Customer selects trip → "Pay with Telebirr"
2. System initiates payment request
3. Customer receives Telebirr USSD prompt
4. Customer enters PIN to confirm
5. Payment processed instantly
6. Ticket approved automatically
7. Notification sent to customer
```

### Implementation

```typescript
// lib/telebirr.ts
import { initiateTelebirrPayment, verifyTelebirrPayment } from '@/lib/telebirr'

// Initiate payment
const result = await initiateTelebirrPayment({
  phoneNumber: '+251912345678',  // Customer phone
  amount: 500,                    // Trip cost
  referenceNumber: 'REF-123456',  // Unique reference
  description: 'Ticket for Addis to Dire Dawa'
})

if (result.status === 'pending') {
  // Show customer the redirect URL
  window.location.href = result.redirectURL
}

// Verify payment after redirect
const verification = await verifyTelebirrPayment(
  result.transactionId
)

if (verification.status === 'success') {
  // Create ticket automatically
  await createTicket(receipt)
}
```

### Demo Mode

When API key is "demo", system returns mock responses for testing:
- Always returns pending status
- Generates demo transaction IDs
- No actual charges

---

## 3. Real-time Notifications

Send instant notifications via Telegram to customers.

### Notification Types

- **approval** - Ticket approved (✅)
- **rejection** - Ticket rejected (❌)
- **reminder** - Booking reminders (🔔)
- **update** - General updates (📢)
- **info** - Information (ℹ️)

### Automatic Notifications

System automatically sends when:

1. **Ticket Approved:**
   ```
   ✅ Your Ticket is Approved!
   Your ticket has been approved. Serial number: ABC123XYZ
   ```

2. **Ticket Rejected:**
   ```
   ❌ Ticket Rejected
   Reason: Duplicate payment reference detected
   Please contact admin for assistance
   ```

3. **New Receipt Submitted:**
   - Admin notified immediately
   - Can approve/reject from notification

### Send Custom Notifications

```typescript
// lib/notifications.ts
import { sendNotification } from '@/lib/notifications'

await sendNotification({
  userId: 123456789,              // Telegram user ID
  type: 'update',
  title: 'System Update',
  message: 'New trips added! Check available routes.',
  actionURL: '/app/trips'         // Optional - clickable action
})
```

### Bulk Notifications

```typescript
// Send to multiple customers
const results = await sendBulkNotifications(
  [userId1, userId2, userId3],    // Array of user IDs
  {
    type: 'reminder',
    title: 'Trip Departure Reminder',
    message: 'Your trip departs in 24 hours',
    actionURL: '/my-tickets'
  }
)

console.log(`Sent: ${results.successful}, Failed: ${results.failed}`)
```

---

## 4. Bulk Operations

Perform actions on multiple customers at once.

### Supported Operations

1. **Bulk Notify** - Send message to multiple customers
2. **Bulk Approve** - Approve multiple receipts
3. **Bulk Reject** - Reject multiple receipts
4. **Bulk Export** - Export customer data

### CSV Format

**For bulk operations, upload CSV with user IDs:**

```csv
telegram_user_id,notes
123456789,Approved
987654321,Rejected - duplicate payment
555555555,Pending review
```

### Usage

1. **Go to:** Admin Dashboard → Bulk Operations
2. **Select:** Operation type
3. **Upload:** CSV file with data
4. **Click:** Process
5. **Monitor:** Progress bar

### Results

```
Status: Completed
✓ Processed: 150
✗ Failed: 2
Errors: [User 123 not found, User 456 permission denied]
```

### Programmatic Usage

```typescript
// app/api/admin/bulk-operations
const results = await processBulkOperation(
  fileData,
  'notify',
  {
    title: 'Trip Update',
    message: 'New trip routes available'
  }
)
```

---

## 5. Activity Auditing

Complete audit trail of all admin actions.

### What's Logged

Every admin action records:
- **Admin ID** - Who performed action
- **Action Type** - What was done
- **Timestamp** - When it happened
- **IP Address** - From where
- **User Agent** - Browser/device info
- **Entity ID** - What it affected
- **Metadata** - Additional details

### Available Actions

```
TICKET_APPROVED
TICKET_REJECTED
RECEIPT_UPLOADED
CUSTOMER_NOTIFIED
BULK_APPROVE
BULK_REJECT
BULK_NOTIFY
INVITATION_CREATED
INVITATION_DELETED
TRIP_CREATED
TRIP_UPDATED
ADMIN_LOGIN
ADMIN_LOGOUT
DATA_EXPORTED
BACKUP_CREATED
BACKUP_RESTORED
```

### Viewing Audit Logs

```sql
-- Get all admin actions
SELECT * FROM activity_logs 
ORDER BY created_at DESC 
LIMIT 100;

-- Get actions by specific admin
SELECT * FROM activity_logs 
WHERE admin_id = 'admin-uuid'
ORDER BY created_at DESC;

-- Get failed operations
SELECT * FROM activity_logs 
WHERE action LIKE 'BULK_%'
ORDER BY created_at DESC;

-- Get actions in last 24 hours
SELECT * FROM activity_logs 
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Export Audit Trail

```bash
# Export to CSV for compliance
Admin Dashboard → Backups → Export → activity_logs

# Contains all actions for accountability
```

---

## 6. Advanced Analytics

Dashboard analytics and reporting.

### Available Metrics

- **Total Customers** - Registered users
- **Total Receipts** - Payments received
- **Pending Approvals** - Awaiting review
- **Approved Tickets** - Active tickets
- **Revenue** - Total payment collected
- **Approval Rate** - % of approved vs rejected

### Analytics Dashboard

```
Admin Dashboard → Analytics
```

Shows:
- Revenue trends (daily/weekly/monthly)
- Customer acquisition rate
- Approval/rejection trends
- Payment method distribution
- Peak booking times
- Geographic distribution (if available)

### Export Reports

```typescript
// Get analytics data
const stats = await getAnalyticsData({
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  groupBy: 'month'  // day, week, month
})

// Export to CSV
const csv = convertToCSV(stats)
await downloadFile(csv, 'analytics.csv')
```

---

## 7. Custom Branding

Customize system appearance and messaging.

### Telegram Bot Commands

Edit `/setcommands` to customize help text:

1. Find @BotFather in Telegram
2. Send `/setcommands`
3. Select your bot
4. Add custom descriptions:
   ```
   start - Welcome and register for tickets
   help - Get assistance
   trips - Browse our available trips
   bookings - View your ticket bookings
   contact_admin - Message our support team
   ```

### Admin Dashboard Customization

Edit translations and theme:

```typescript
// locales/en.json - Customize English text
{
  "app_title": "TicketHub",
  "company_name": "Your Company",
  // ... more translations
}

// locales/am.json - Customize Amharic text
{
  "app_title": "ቲኬት ሀብ",
  "company_name": "የእርስዎ ሥርወ ተቋም",
  // ... more translations
}
```

### Theme Colors

Edit `app/globals.css`:

```css
@theme inline {
  --color-primary: #3b82f6;      /* Blue */
  --color-secondary: #10b981;    /* Green */
  --color-accent: #f59e0b;       /* Amber */
  --color-danger: #ef4444;       /* Red */
}
```

### Custom Email/SMS Templates

```typescript
// lib/notifications.ts - Customize message templates
const templates = {
  approval: 'Your ticket #{serial} has been approved!',
  rejection: 'Your ticket was rejected: {reason}',
  reminder: 'Your trip departs in {hours} hours!',
}
```

---

## Configuration Reference

### Environment Variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklmnOPQrstuvWXYZ
TELEGRAM_WEBHOOK_SECRET=your_secret_token

# Telebirr
TELEBIRR_API_KEY=your_api_key
TELEBIRR_MERCHANT_ID=your_merchant_id
TELEBIRR_API_URL=https://api.telebirr.com/v1

# Application
NEXT_PUBLIC_APP_URL=https://tickethub.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx

# Backup
CRON_SECRET=your_cron_secret
```

### Database Indexes

Pre-created for performance:
- `telegram_users(username, phone_number)`
- `receipts(reference_number, approval_status)`
- `tickets(serial_number, status, user_id)`
- `activity_logs(admin_id, action, created_at)`

---

## Troubleshooting

### QR Codes Not Generating
- Check `qrcode` npm package installed
- Verify `generateQRCodeDataURL` function
- Check browser console for errors

### Telebirr Payments Failing
- Verify API credentials correct
- Check phone number format (should be +251...)
- Check Telebirr API status
- Review error in `metadata` field

### Notifications Not Sending
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check webhook registered with Telegram
- Review Telegram API logs
- Ensure user hasn't blocked bot

### Bulk Operations Slow
- Reduce CSV size (process in batches of 1000)
- Check database performance
- Monitor Vercel function time limits
- Consider scheduling during off-peak hours

---

## Best Practices

1. **Always backup** before major operations
2. **Test bulk operations** on small dataset first
3. **Monitor notifications** delivery rates
4. **Review audit logs** regularly
5. **Rotate API keys** quarterly
6. **Update dependencies** monthly
7. **Document customizations** for team

---

**For more help, see QUICKSTART.md or contact support.**
