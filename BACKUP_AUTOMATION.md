# Database Backup Automation Guide

## Overview

Your TicketHub system includes **fully automated daily database backups** with manual backup options, CSV export, and comprehensive tracking.

## Key Features

### Automatic Daily Backups
- **Schedule**: 2:00 AM UTC (configurable)
- **Frequency**: Every day automatically
- **Method**: Vercel Cron Jobs
- **Retention**: 30 days automatically

### Manual Backups
- Available anytime from Admin Dashboard
- Backup Backups page (`/admin/backups`)
- Instant backup creation
- Complete audit trail logging

### Data Export
- Export any table as CSV
- Export all tables at once
- Download for analysis or archives
- Date-stamped filenames

### Monitoring & Logs
- View backup history
- Track success/failure status
- Monitor backup size and duration
- Access full activity logs

---

## How It Works

### Automatic Daily Backup Process

**1. Vercel Cron Trigger (2:00 AM UTC)**
```
GET /api/cron/daily-backup?cron_secret=CRON_SECRET
```

**2. Backup System Executes**
- Connects to Supabase
- Reads all 10 tables:
  - `telegram_users`
  - `admin_users`
  - `trips`
  - `receipts`
  - `tickets`
  - `activity_logs`
  - `approvals`
  - `invitations`
  - `notifications`
  - `telegram_channels`

**3. Data Captured**
- All records from each table
- Total count tracking
- File size calculation
- Duration measurement

**4. Logging**
- Entry added to `activity_logs` table
- Backup metadata stored:
  - Backup ID
  - Total records
  - Size in bytes
  - Per-table record counts
  - Timestamp

**5. Cleanup**
- Automatically removes backups older than 30 days
- Keeps recent backups for recovery

---

## Setup Instructions

### 1. Vercel Environment Variable

Add to your Vercel project settings:

```
CRON_SECRET=your-secure-random-string
```

Generate a secure random string:
```bash
# macOS/Linux
openssl rand -hex 32

# Or use any random string generator
```

### 2. Verify Configuration

Check `vercel.json` is configured:
```json
{
  "crons": [
    {
      "path": "/api/cron/daily-backup",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Schedule Format** (Cron syntax):
- `0 2 * * *` = Every day at 2:00 AM UTC
- `0 */6 * * *` = Every 6 hours
- `30 1 * * *` = Every day at 1:30 AM UTC

### 3. Test the Backup

**Option A: Manual via Dashboard**
1. Go to Admin Dashboard
2. Navigate to "Backups" tab
3. Click "Manual Backup Now"
4. Wait for completion

**Option B: API Call**
```bash
curl -X POST http://localhost:3000/api/admin/backups/create
```

**Option C: Trigger Cron Manually** (production only)
```bash
curl -X GET \
  "https://your-app.vercel.app/api/cron/daily-backup" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Admin Dashboard Features

### Backup Statistics
- **Total Backups**: Count of all backups
- **Successful**: Completed backups
- **Failed**: Any failed attempts
- **Last Backup**: Timestamp of most recent
- **Average Size**: Mean backup size

### Backup History Table
Shows all recent backups with:
- **Timestamp**: When backup was created
- **Description**: Details and record count
- **Records**: Total records backed up
- **Size**: Backup file size in KB
- **Actions**: Download or delete

### CSV Export
- Select table to export
- Download as CSV file
- All tables option available
- Automatic filename with date

### Language Support
- English (Default)
- Amharic (አማርኛ)

---

## API Endpoints

### Get Backup History
```bash
GET /api/admin/backups?limit=30
```

Response:
```json
{
  "success": true,
  "backups": [
    {
      "id": "activity_log_id",
      "created_at": "2024-01-15T02:00:15Z",
      "action": "AUTOMATED_BACKUP",
      "description": "Automated daily backup: 15234 records...",
      "metadata": {
        "backupId": "backup-1705308015000",
        "totalRecords": 15234,
        "size": 5242880,
        "tables": {
          "telegram_users": 245,
          "tickets": 1203,
          ...
        }
      }
    }
  ],
  "count": 5
}
```

### Get Backup Statistics
```bash
GET /api/admin/backups/stats
```

Response:
```json
{
  "success": true,
  "stats": {
    "totalBackups": 30,
    "successfulBackups": 29,
    "failedBackups": 1,
    "lastBackupTime": "2024-01-15T02:00:15Z",
    "averageBackupSize": 4831923
  }
}
```

### Create Manual Backup
```bash
POST /api/admin/backups/create
```

Response:
```json
{
  "success": true,
  "message": "Backup created successfully",
  "backup": {
    "id": "backup-1705308150000",
    "status": "success",
    "records": 15234,
    "size": 5242880,
    "duration": 3420
  }
}
```

### Export Data as CSV
```bash
# Export single table
GET /api/admin/backups/export?table=tickets&format=csv

# Export all tables
GET /api/admin/backups/export?all=true&format=csv
```

---

## Database Backup Data

### What's Backed Up

All tables are completely backed up:

| Table | Purpose | Records |
|-------|---------|---------|
| `telegram_users` | Customers | Varies |
| `admin_users` | Staff accounts | Small |
| `trips` | Available trips | Varies |
| `receipts` | Payment records | Varies |
| `tickets` | Issued tickets | Varies |
| `activity_logs` | Audit trail | Large |
| `approvals` | Approval history | Varies |
| `invitations` | Invite links | Varies |
| `notifications` | User messages | Varies |
| `telegram_channels` | Chat channels | Small |

### What's NOT Backed Up

- Admin authentication tokens (Supabase Auth)
- Telegram bot token (in env vars)
- API keys and secrets
- Session data

---

## Monitoring Backups

### Check Last Backup Status
1. Go to Admin Dashboard
2. Click "Backups" tab
3. View statistics at top
4. Check "Last Backup" timestamp

### Verify Backup Success
Look for:
- ✅ Green checkmark in "Successful" stat
- ✅ Recent "Last Backup" time
- ✅ "Backup created successfully" in logs

### Troubleshoot Failed Backups
1. Check `activity_logs` table for errors
2. Verify Supabase connection
3. Check `CRON_SECRET` is set in Vercel
4. Review server logs

---

## Restore from Backup

### Manual Restore Process

**Option 1: From CSV Files**
1. Go to `/admin/backups`
2. Download CSV for table you need
3. Use Supabase SQL Editor or CSV import tool
4. Load data into database

**Option 2: Use Supabase Backup**
Supabase automatically backs up to their system:
1. Log into Supabase Dashboard
2. Go to Project Settings → Backups
3. Restore from available snapshots
4. Follow Supabase restore wizard

**Option 3: Manual SQL Restore**
1. Export backup as CSV
2. In Supabase SQL Editor:
   ```sql
   TRUNCATE table_name;
   
   COPY table_name FROM stdin WITH (FORMAT csv, HEADER);
   -- Paste CSV content
   \.
   ```

---

## Backup Retention Policy

### Default Configuration
- **Keep**: Last 30 days of backups
- **Auto-delete**: Older than 30 days
- **Frequency**: Daily cleanup run

### Change Retention Period

Edit `/lib/backup.ts`:
```typescript
// Change cleanupOldBackups parameter
await cleanupOldBackups(60); // Keep 60 days instead of 30
```

Or update the Cron job in `/app/api/cron/daily-backup/route.ts`:
```typescript
const cleanupResult = await cleanupOldBackups(60); // 60 days
```

Then redeploy.

---

## Performance Considerations

### Backup Duration
- **Typical**: 30 seconds - 2 minutes
- **Factors**: Database size, server load
- **Peak Time**: 2:00 AM UTC to minimize user impact

### Database Performance Impact
- **Minimal**: Uses read-only queries
- **Non-blocking**: Doesn't affect user operations
- **Connection**: Uses single Supabase connection

### Storage Requirements
- **Per Backup**: 2-10 MB typical
- **30 Days**: 60-300 MB total
- **Storage**: Logged in `activity_logs` table (minimal)

---

## Backup File Structure

### Activity Log Entry
```json
{
  "action": "AUTOMATED_BACKUP",
  "entity_type": "system",
  "entity_id": "backup-1705308015000",
  "description": "Automated daily backup: 15234 records...",
  "metadata": {
    "backupId": "backup-1705308015000",
    "totalRecords": 15234,
    "size": 5242880,
    "tables": {
      "telegram_users": 245,
      "admin_users": 3,
      "trips": 12,
      "receipts": 456,
      "tickets": 1203,
      "activity_logs": 12345,
      "approvals": 234,
      "invitations": 15,
      "notifications": 2450,
      "telegram_channels": 8
    }
  }
}
```

---

## Security Considerations

### Backup Security
- ✅ All data encrypted in Supabase
- ✅ CRON_SECRET protects endpoint
- ✅ Activity logged with timestamps
- ✅ Admin authentication required

### Access Control
- Only admins can view backups
- Only admins can download exports
- Activity logged for audit
- IP address tracked (if available)

### Data Privacy
- No passwords backed up
- No API keys backed up
- Personal data encrypted at rest
- 30-day retention policy

---

## Troubleshooting

### Backup Not Running

**Issue**: No backup created at 2:00 AM UTC

**Solutions**:
1. Check `CRON_SECRET` is set in Vercel
2. Verify cron job in `vercel.json`
3. Check Supabase connection
4. Review server logs

### Export Shows No Data

**Issue**: CSV export is empty

**Solutions**:
1. Verify table has data: `/admin/dashboard`
2. Check date filters if any
3. Ensure Supabase connection active
4. Try manual backup first

### Backup Size Too Large

**Issue**: Backup is unexpectedly large

**Solutions**:
1. Check activity_logs table size
2. Archive old logs if needed
3. Consider separate log backup strategy
4. Contact support if persists

---

## Best Practices

✅ **Do**
- ✅ Monitor backup stats weekly
- ✅ Test restore procedures quarterly
- ✅ Keep 30+ days of backups
- ✅ Export critical data manually
- ✅ Review backup activity logs regularly

❌ **Don't**
- ❌ Rely only on backups (use Supabase backups too)
- ❌ Delete backups without reason
- ❌ Share backup files publicly
- ❌ Store backups in unsecured locations
- ❌ Ignore failed backup alerts

---

## Support & Maintenance

### Weekly Maintenance
- Review backup statistics
- Check for failed backups
- Monitor storage size
- Verify recent backups

### Monthly Maintenance
- Review 30-day backup history
- Test manual restore procedure
- Check retention policy
- Archive old exports if needed

### Contact Support
- Vercel: https://vercel.com/help
- Supabase: https://supabase.com/support
- Application Issues: Check logs

---

## Version History

- **v2.0** (Current): Automated Cron backups, CSV export, full audit trail
- **v1.0**: Manual backup only

---

**Last Updated**: February 2024
**Backup System**: Active and monitoring
