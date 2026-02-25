# Backup System - Quick Start (5 Minutes)

## 🚀 Get Backups Running in 5 Steps

### Step 1: Generate Secret (1 min)
```bash
# Generate a secure random string
openssl rand -hex 32

# Example output:
# a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

### Step 2: Add to Vercel (1 min)
1. Go to Vercel Dashboard
2. Select your project
3. Settings → Environment Variables
4. Add new variable:
   - Name: `CRON_SECRET`
   - Value: (paste the generated string)
5. Click "Save"
6. Redeploy project

### Step 3: Test Manually (1 min)
1. Open Admin Dashboard
2. Click "Backups" in sidebar
3. Click "Manual Backup Now"
4. Wait for success message
5. See backup appear in history

### Step 4: Verify Configuration (1 min)
Check these files exist:
- ✅ `vercel.json` with cron config
- ✅ `app/api/cron/daily-backup/route.ts`
- ✅ `app/admin/backups/page.tsx`
- ✅ `lib/backup.ts`

### Step 5: Wait for Auto-Backup (varies)
- Backups run at **2:00 AM UTC** every day
- Check dashboard after 2 AM UTC
- Should see new backup in history
- Done! ✅

---

## 📊 Dashboard at a Glance

**Go to**: Admin Dashboard → Backups

**You'll see**:
- 📈 Statistics (Total, Successful, Failed, Last Backup)
- 📋 Backup history table
- 📥 Export CSV section
- ℹ️ Info about backup system

---

## 💾 What Gets Backed Up

| Table | What | Count |
|-------|------|-------|
| telegram_users | Customers | Varies |
| tickets | Digital tickets | Varies |
| receipts | Payments | Varies |
| admin_users | Staff accounts | Small |
| activity_logs | Audit trail | Large |
| trips | Trips info | Varies |
| approvals | Approvals | Varies |
| invitations | Invite links | Varies |
| notifications | Messages | Varies |
| telegram_channels | Groups | Small |

---

## ⚡ Quick Actions

### Manual Backup
```
Dashboard → Backups → "Manual Backup Now"
```

### Download CSV
```
Dashboard → Backups → Select table → Export
```

### View Backup History
```
Dashboard → Backups → Scroll to history table
```

### Check Statistics
```
Dashboard → Backups → Top statistics cards
```

---

## 🔧 Troubleshooting

### No auto-backup at 2 AM?
1. Check `CRON_SECRET` is set in Vercel
2. Wait exactly until 2:00 AM UTC
3. Check activity logs for errors
4. Try manual backup first

### Empty backup history?
1. Click "Manual Backup Now" to create one
2. Wait a few seconds
3. Refresh page

### Export shows no data?
1. Check dashboard has data
2. Verify Supabase connection
3. Try manual backup first

### Backup files too large?
1. Check activity_logs table size
2. 30-day retention is normal
3. Contact support if huge

---

## 📅 Schedule

| Time | Action |
|------|--------|
| 2:00 AM UTC | Auto-backup runs |
| Daily | Backup created (no action needed) |
| 30 days | Old backups deleted automatically |

---

## ✅ Checklist

- [ ] Generated `CRON_SECRET`
- [ ] Added to Vercel environment
- [ ] Redeployed project
- [ ] Tested manual backup
- [ ] Saw backup in history
- [ ] Waited for 2 AM UTC auto-backup
- [ ] Verified auto-backup appeared
- [ ] Downloaded a CSV export
- [ ] Checked statistics

---

## 🔐 Security Notes

- ✅ Only admins can access backups
- ✅ All data encrypted
- ✅ No passwords or keys backed up
- ✅ `CRON_SECRET` protects endpoint
- ✅ Activity logged for audit

---

## 📞 Need Help?

1. **Basics**: See `BACKUP_AUTOMATION.md`
2. **Setup Issues**: Check `BACKUP_IMPLEMENTATION_SUMMARY.md`
3. **Vercel Cron**: Visit https://vercel.com/docs/crons
4. **Supabase**: Visit https://supabase.com/docs

---

## 📈 What to Monitor

**Weekly**:
- Check "Last Backup" time is recent
- Verify "Successful" count increasing
- Review "Failed" count (should be 0)

**Monthly**:
- Test CSV export
- Download and review data
- Check total size
- Verify retention working

---

## 🎯 You're Done!

Your database now has:
✅ Daily automatic backups
✅ Manual backup anytime
✅ CSV export for analysis
✅ Full audit logging
✅ 30-day retention

That's it! Backups are working. 🎉

---

**For detailed guide**: See `BACKUP_AUTOMATION.md`
**Last Updated**: February 2024
