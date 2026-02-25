# Database Backup Strategy & Automation Guide

## Overview

The TicketHub system includes **automated daily backups** with manual backup capability and a comprehensive admin dashboard for monitoring backup status.

---

## Backup Architecture

### Automatic Daily Backups
- **Schedule**: 2:00 AM UTC every day
- **Method**: Serverless cron job (Vercel)
- **Retention**: 30 days
- **Data Backed Up**:
  - All customer/telegram user data
  - All ticket records
  - All receipt/payment references
  - All approval history
  - Complete admin activity logs

### Backup Storage
- **Location**: Supabase `database_backups` table
- **Format**: JSON-based backup records
- **Metadata**: Timestamp, status, size, duration, error messages
- **Automatic Cleanup**: Backups older than 30 days are automatically deleted

---

## Setup Instructions

### 1. Enable Scheduled Backups in Vercel

Create or update `vercel.json` in your project root:

```json
{
  "crons": [
    {
      "path": "/api/backup/scheduled",
      "schedule": "0 2 * * *"
    }
  ]
}
```

**Schedule Explanation:**
- `0` - Minute: 0 (top of the hour)
- `2` - Hour: 2 AM UTC
- `*` - Day: Every day
- `*` - Month: Every month
- `*` - Weekday: Every weekday

**Alternative Times:**
- `0 0 * * *` - Midnight UTC
- `0 6 * * *` - 6 AM UTC
- `0 12 * * *` - Noon UTC
- `0 23 * * *` - 11 PM UTC

### 2. Set Environment Variable

Add to your Vercel project environment variables:

```
CRON_SECRET=your-secret-key-here
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

Or use online generator and replace `your-secret-key-here` with the generated value.

### 3. Database Table Setup

The backup table is created by the migration script:

```sql
CREATE TABLE IF NOT EXISTS database_backups (
  id TEXT PRIMARY KEY,
  backup_data JSONB,
  status TEXT NOT NULL,
  error_message TEXT,
  size INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

This is included in `/scripts/01-setup-database.sql` and will be created automatically.

---

## How Backups Work

### Backup Process

1. **Scheduled Trigger**: Vercel's cron service calls `/api/backup/scheduled` at 2 AM UTC
2. **Authentication**: Request verified using `CRON_SECRET`
3. **Data Collection**: System exports:
   - All tickets
   - All receipts
   - All customers
   - All approvals
   - All activity logs
4. **Compression**: Data packaged as JSON with metadata
5. **Storage**: Backup stored in `database_backups` table
6. **Cleanup**: Backups older than 30 days deleted
7. **Logging**: Success/failure logged to console and database

### Backup Data Structure

```json
{
  "backupId": "backup-1707129600000",
  "timestamp": "2024-02-05T02:00:00Z",
  "version": "1.0",
  "tables": {
    "tickets": [...],
    "receipts": [...],
    "customers": [...],
    "approvals": [...],
    "activityLogs": [...]
  },
  "statistics": {
    "totalTickets": 156,
    "totalReceipts": 42,
    "totalCustomers": 38,
    "totalApprovals": 42,
    "totalActivityLogs": 823
  }
}
```

---

## Manual Backups

### Via Admin Dashboard

1. Go to **Admin Dashboard** → **Backups**
2. Click **Manual Backup** button
3. System creates immediate backup
4. View status in real-time

### Via API

```bash
curl -X POST https://yourdomain.com/api/backup/manual \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "message": "Backup created successfully",
  "backup": {
    "id": "backup-1707129600000",
    "timestamp": "2024-02-05T02:00:00Z",
    "size": 2048576,
    "duration": 3500
  }
}
```

---

## Monitoring Backups

### Admin Dashboard

Access: **Admin Panel** → **Backups**

**Features:**
- Total backup count
- Success/failure statistics
- Latest backup details
- Complete backup history table
- Manual backup trigger button
- Auto-refresh every 5 minutes

### Backup Status Page Fields

| Field | Description |
|-------|-------------|
| ID | Unique backup identifier |
| Status | `success`, `failed`, or `pending` |
| Date | Backup creation timestamp |
| Size | Backup size in MB |
| Duration | Time taken to create backup |
| Error Message | If backup failed |

### Check Backup History via SQL

```sql
-- Get last 10 backups
SELECT 
  id, 
  status, 
  size, 
  created_at 
FROM database_backups 
ORDER BY created_at DESC 
LIMIT 10;

-- Get success rate
SELECT 
  status, 
  COUNT(*) as count
FROM database_backups
GROUP BY status;

-- Check backup size trends
SELECT 
  DATE(created_at) as backup_date,
  AVG(size) as avg_size,
  MAX(size) as max_size,
  COUNT(*) as backups_per_day
FROM database_backups
GROUP BY DATE(created_at)
ORDER BY backup_date DESC;
```

---

## Backup Recovery

### Restore from Backup

When you need to restore data from a backup:

1. **Get Backup ID**: Find desired backup in admin dashboard
2. **Access Backup Data**: Query the backup record:
   ```sql
   SELECT backup_data FROM database_backups 
   WHERE id = 'backup-1707129600000';
   ```
3. **Extract Data**: Use the JSON data to restore
4. **Manual Restore**: Insert data back into tables (careful operation!)

### Important Recovery Notes

- Backups are **read-only snapshots**
- Direct database recovery requires careful planning
- **Contact Supabase support** for production restore operations
- Always test restore in staging first
- Keep audit trails during recovery

### Example: Restore Customer Data

```sql
-- Get backup data
WITH backup AS (
  SELECT backup_data FROM database_backups 
  WHERE id = 'backup-1707129600000'
)
-- Would need custom logic to parse JSONB and restore
-- This is a manual, careful process
```

---

## Backup Retention Policy

### Current Policy
- **Keep**: Last 30 days of backups
- **Delete**: Automatically older than 30 days
- **Frequency**: Daily at 2 AM UTC
- **Total**: ~30 backups at any time

### Customizing Retention

Edit `/lib/backup.ts`:
```typescript
// Change days to keep (currently 30)
const deletedCount = await cleanupOldBackups(60); // Keep 60 days instead
```

Then redeploy.

### Extending Backup Window

For longer retention:

1. Modify `cleanupOldBackups()` calls
2. Update `BACKUP_GUIDE.md` documentation
3. Monitor database storage costs
4. Redeploy application

---

## Backup Failure Handling

### Common Issues

| Issue | Solution |
|-------|----------|
| Backup times out | Check database size, increase timeout |
| CRON_SECRET mismatch | Verify env variable in Vercel dashboard |
| Database connection fails | Check Supabase status and network |
| Insufficient storage | Enable database autoscaling in Supabase |

### Automatic Retries

The system does NOT automatically retry failed backups. To add:

1. Edit `/app/api/backup/scheduled/route.ts`
2. Add retry logic with exponential backoff
3. Send alert notification on persistent failures

### Manual Intervention

If automated backup fails:

```bash
# Trigger manual backup
curl -X POST https://yourdomain.com/api/backup/manual

# Check status in admin dashboard
# Navigate to Admin → Backups
```

---

## Backup Storage Costs

### Supabase Database Backup Costs

**Native Backups (Included)**
- Automatic daily backups
- Stored in Supabase storage
- Included with plan (no extra cost)
- 7-day retention by default

**Our Custom Backups**
- Stored as JSON in `database_backups` table
- Uses standard database storage
- ~2-5 MB per backup (depends on data volume)
- 30 backups × 3 MB avg = ~90 MB added monthly

### Cost Estimate

With 30-day retention:
- **Database Storage**: ~0.3 GB additional (~$0.003/month extra)
- **Compute**: Negligible (serverless cron)
- **Network**: Included in Supabase plan

### Optimizing Costs

If storage is concern:

```javascript
// Reduce retention to 14 days
await cleanupOldBackups(14);

// Or compress larger backups
const compressedBackup = zlib.gzipSync(JSON.stringify(data));
```

---

## Best Practices

### Security

- ✅ Keep CRON_SECRET private
- ✅ Store backups in Supabase (encrypted)
- ✅ Review access logs regularly
- ✅ Rotate CRON_SECRET quarterly
- ✅ Never commit secrets to Git

### Operations

- ✅ Monitor backup success rate weekly
- ✅ Test restore process quarterly
- ✅ Keep 30-day rolling backup window
- ✅ Alert on failed backups
- ✅ Document any manual recovery steps

### Database

- ✅ Enable Supabase auto-backups (native)
- ✅ Use our custom backups for long-term retention
- ✅ Monitor database growth
- ✅ Archive very old backups if needed

---

## Advanced Configuration

### Custom Backup Schedule

Edit `vercel.json` for different timing:

```json
{
  "crons": [
    {
      "path": "/api/backup/scheduled",
      "schedule": "0 2 * * *"  // Daily 2 AM
    },
    {
      "path": "/api/backup/scheduled",
      "schedule": "0 14 * * *"  // Daily 2 PM (weekly full backup)
    }
  ]
}
```

### Backup to External Storage

To backup to AWS S3, Azure, or Google Cloud:

1. Create new route: `/app/api/backup/external/route.ts`
2. Use provider SDK to upload
3. Update `/lib/backup.ts` to call both storage locations
4. Add monitoring for external backups

Example (S3):
```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const uploadToS3 = async (backupData: any) => {
  const s3 = new S3Client({ region: 'us-east-1' });
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BACKUP_BUCKET,
    Key: `backups/${backupData.backupId}.json`,
    Body: JSON.stringify(backupData),
  });
  await s3.send(command);
};
```

### Incremental Backups

For very large databases, implement incremental backups:

```typescript
// Only backup changes since last backup
const getIncrementalBackup = async (lastBackupTime: Date) => {
  const { data: newTickets } = await supabase
    .from('tickets')
    .select('*')
    .gt('updated_at', lastBackupTime.toISOString());
  // Only backup new/modified records
};
```

---

## Monitoring & Alerts

### Vercel Monitoring

Check Vercel dashboard for cron job status:
1. Go to project **Settings**
2. **Functions** → **Cron Jobs**
3. View execution history and logs

### Custom Alerts

To add email alerts on backup failure:

```typescript
// In /lib/backup.ts
if (backupResult.status === 'failed') {
  await sendAlertEmail({
    to: process.env.ADMIN_EMAIL,
    subject: 'Database Backup Failed',
    body: `Backup ${backupResult.id} failed: ${backupResult.errorMessage}`
  });
}
```

### Integration with Monitoring Tools

Connect to Sentry, LogRocket, or DataDog:

```typescript
import * as Sentry from '@sentry/nextjs';

try {
  await backupDatabase();
} catch (error) {
  Sentry.captureException(error, {
    tags: { feature: 'backup', type: 'scheduled' }
  });
}
```

---

## Testing Backup System

### Local Testing

1. Start dev server: `npm run dev`
2. Trigger manual backup: Visit `/admin/backups` and click button
3. Check results: View backup status in UI
4. Query database:
   ```sql
   SELECT * FROM database_backups ORDER BY created_at DESC LIMIT 5;
   ```

### Staging Testing

Before deploying to production:

```bash
# Deploy to staging
vercel --env=staging

# Set CRON_SECRET in staging
vercel env add CRON_SECRET --environment=staging

# Manually trigger
curl -X GET https://staging-url.vercel.app/api/backup/scheduled \
  -H "Authorization: Bearer your-secret"

# Verify in dashboard
```

### Production Verification

After first deployment:

1. Check Vercel cron logs
2. Query `database_backups` table
3. View admin dashboard
4. Confirm automatic backups running

---

## Troubleshooting

### Backup Never Runs

**Check:**
1. `vercel.json` has correct cron configuration
2. `CRON_SECRET` set in Vercel env vars
3. Project has Vercel Functions enabled
4. Check Vercel deployment logs

**Fix:**
```bash
vercel env list  # Verify CRON_SECRET exists
vercel deploy    # Redeploy after env changes
```

### Backup Always Fails

**Check:**
1. Supabase connection active
2. `database_backups` table exists (run migration)
3. Admin can manually trigger backup
4. Check server logs for errors

**Query:**
```sql
SELECT * FROM database_backups 
WHERE status = 'failed' 
ORDER BY created_at DESC LIMIT 5;
```

### Backups Too Large

**Monitor:**
```sql
SELECT 
  AVG(size) as avg_size,
  MAX(size) as max_size
FROM database_backups;
```

**Reduce Size:**
1. Archive old tickets (before current month)
2. Compress backup JSON
3. Increase cleanup frequency (15 days instead of 30)
4. Remove older activity logs

---

## Support & Resources

- **Vercel Cron Docs**: https://vercel.com/docs/cron-jobs
- **Supabase Backups**: https://supabase.com/docs/guides/database/backups
- **Database Recovery**: See restoration section above
- **Emergency**: Contact Supabase support for critical recovery

---

**Last Updated**: February 2024
**Version**: 1.0
**Status**: Production Ready
