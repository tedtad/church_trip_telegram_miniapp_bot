# Charity Collection System - Complete Integration Guide

## Overview

The charity collection system is fully integrated into TicketHub, reusing the receipt upload workflow and extending the reservation system for charitable giving purposes.

## Database Schema

### Tables Created

1. **charity_campaigns**
   - Stores active and inactive charity campaigns
   - Tracks goal amounts and collected amounts
   - Links to admin users who created campaigns

2. **charity_donations**
   - Records individual donations
   - Reuses receipt upload system for payment verification
   - Tracks approval status and admin approvals
   - Stores unique reference numbers to prevent duplicates

3. **thank_you_cards**
   - Generated PDF cards sent to donors
   - Tracks delivery and viewing
   - Stores templates for future customization

## Frontend Implementation

### Miniapp Charity Page (`app/miniapp/charity/page.tsx`)

**Features:**
- Campaign selection with progress bars
- Multi-step donation flow (Select Campaign → Enter Info → Upload Receipt)
- Bilingual interface (English + Amharic)
- Receipt upload with validation

**How it works:**
1. User selects active campaign
2. Enters donor information (name, phone)
3. Specifies donation amount
4. Uploads receipt (JPG, PNG, PDF)
5. Provides unique payment reference number
6. Submission sent for admin approval

### Miniapp Home Button

Added to `/app/miniapp/page.tsx`:
```
❤️ Make a Donation
```
Red gradient button on homepage linking to charity page

## Admin Dashboard

### Charity Management Page (`app/admin/charity/page.tsx`)

**Two main sections:**

1. **Campaigns Tab**
   - View all campaigns with progress visualization
   - Create new campaigns
   - Track goal vs collected amounts
   - Click campaign to filter donations

2. **Donations Tab**
   - List all donations with filtering
   - Approve/Reject pending donations with notes
   - Generate thank you cards for approved donations
   - Export to CSV for reporting
   - Status indicators (pending/approved/rejected)

## API Endpoints

### Public APIs (Miniapp)

- `GET /api/charity/campaigns` - Get active campaigns
- `POST /api/charity/donate` - Submit donation with receipt

### Admin APIs

- `GET /api/admin/charity/campaigns` - List all campaigns
- `POST /api/admin/charity/campaigns` - Create campaign
- `GET /api/admin/charity/donations` - Get donations (supports ?campaign filter)
- `POST /api/admin/charity/donations/[id]/approve` - Approve donation
- `POST /api/admin/charity/donations/[id]/reject` - Reject donation
- `POST /api/admin/charity/donations/[id]/thank-you-card` - Generate thank you card
- `GET /api/admin/charity/export` - Export to CSV (supports ?campaign filter)

## Workflow

### Customer Donation Flow

```
Customer opens miniapp
    ↓
Clicks "❤️ Make a Donation" button
    ↓
Navigates to /miniapp/charity
    ↓
Selects active campaign
    ↓
Enters: Name, Phone, Amount, Reference Number
    ↓
Uploads receipt (JPG, PNG, PDF)
    ↓
Submits donation
    ↓
Donation created with "pending" status
    ↓
Receipt stored in Supabase storage
```

### Admin Approval Flow

```
Admin views /admin/charity
    ↓
Reviews pending donations
    ↓
Option 1: Click ✓ to approve with optional notes
    ↓
Option 2: Click ✗ to reject with reason
    ↓
If approved:
    - Donation status → "approved"
    - Admin can generate thank you card
    - Admin records activity logs
    ↓
If rejected:
    - Donation status → "rejected"
    - Rejection reason stored
    - Donor notified via Telegram
```

### Thank You Card Generation

```
Admin clicks envelope icon for approved donation
    ↓
Card record created in thank_you_cards table
    ↓
Card marked as sent via Telegram
    ↓
Donation marked with thank_you_card_generated = true
    ↓
PDF available at /api/charity/thank-you-card/[donation_id].pdf
```

## Key Features

### 1. Reference Number System
- Unique reference number required to prevent duplicate payments
- Database constraint ensures uniqueness
- Matches receipt verification process

### 2. Multi-Step Approval
- Initial donation submission with "pending" status
- Admin review of receipts
- Approval with optional admin notes
- Rejection with detailed reasons

### 3. Activity Logging
- All admin actions logged in activity_logs table
- Includes admin ID, action, timestamp
- Complete audit trail for compliance

### 4. Reporting
- CSV export of all donations (filtered by campaign optional)
- Includes: donor name, phone, amount, method, reference, status, campaign, date
- Spreadsheet ready for accounting

### 5. Campaign Tracking
- Real-time collection vs goal tracking
- Progress visualization for admin
- Individual campaign donation filtering

## Data Security

### Receipt Upload
- Files stored in Supabase storage under `/receipts/campaign/[id]/`
- File size validation (max 2MB)
- Type validation (JPG, PNG, PDF only)

### Reference Numbers
- Unique constraint on reference_number column
- Prevents duplicate payment registration
- Database-level enforcement

### Admin Actions
- Require authentication
- Logged with admin ID
- IP address and user agent captured

## Integration with Ticket System

The charity system reuses:
- Receipt upload infrastructure
- Payment method types (bank, mobile_money, cash, telebirr)
- Admin approval workflow pattern
- Activity logging system
- Supabase storage integration
- User notification system

## Setup Instructions

1. **Database Migration**
   ```bash
   # Run the migration script
   psql -U postgres -d your_db -f scripts/03-charity-schema.sql
   ```

2. **Add Environment Variables** (if needed)
   - Already using existing SUPABASE keys
   - No new env variables required

3. **Deploy**
   - Push code to GitHub
   - Vercel auto-deploys
   - Database migration runs once

4. **First Campaign**
   - Navigate to Admin → Charity
   - Click "New Campaign"
   - Fill in details
   - Save campaign

5. **Test Flow**
   - Open miniapp charity page
   - Select campaign
   - Submit test donation
   - Approve in admin dashboard

## Future Enhancements

1. **SMS Notifications** - Notify donors of approval status
2. **Receipt OCR** - Automatically read receipt data
3. **Recurring Donations** - Monthly giving support
4. **Donor Portal** - Track donation history
5. **Certificate Generation** - Tax receipt generation
6. **Telebirr Integration** - Direct payment link
7. **Analytics Dashboard** - Charts and insights
8. **Multi-language Cards** - Localized thank you cards

## Troubleshooting

### Donation not submitting
- Check reference number uniqueness
- Verify receipt file type/size
- Check browser console for errors

### Campaign not appearing
- Ensure campaign status = 'active'
- Refresh page
- Check database directly

### Thank you card not generating
- Verify donation is approved
- Check Supabase storage permissions
- Review server logs

## Database Queries

### Get campaign stats
```sql
SELECT 
  campaign_id,
  COUNT(*) as donation_count,
  SUM(donation_amount) as total_raised
FROM charity_donations
WHERE approval_status = 'approved'
GROUP BY campaign_id;
```

### Get pending donations
```sql
SELECT * FROM charity_donations 
WHERE approval_status = 'pending'
ORDER BY created_at DESC;
```

### Get donor history
```sql
SELECT * FROM charity_donations 
WHERE telegram_user_id = $1
ORDER BY created_at DESC;
```

## Support

For issues or questions:
1. Check CHARITY_SYSTEM_GUIDE.md (this file)
2. Review API endpoints in code comments
3. Check admin dashboard help section
4. Review error logs in /vercel/share/v0-project
