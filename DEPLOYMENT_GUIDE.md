# TicketHub Deployment Guide

Complete step-by-step guide to deploy TicketHub to production.

## Prerequisites

- Vercel account (free or paid)
- Supabase project created
- Telegram Bot Token (from @BotFather)
- GitHub repository (optional but recommended)
- Telebirr API credentials (optional, for payment integration)

---

## Phase 1: Pre-Deployment (1-2 hours)

### 1. Database Setup

```bash
# 1. Go to Supabase Dashboard
# 2. Select your project → SQL Editor
# 3. Create a new query and paste from scripts/02-setup-complete.sql
# 4. Run the entire script

# Verify tables created:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';
```

Expected tables:
- telegram_users
- admin_users
- trips
- receipts
- tickets
- activity_logs
- approvals
- invitations
- notifications
- telegram_channels
- telebirr_payments
- database_backups

### 2. Create Admin User

```sql
-- Run in Supabase SQL Editor
INSERT INTO admin_users (email, name, role, is_active)
VALUES ('your-email@example.com', 'Your Name', 'admin', true);
```

### 3. Telegram Bot Setup

1. Open Telegram and find @BotFather
2. Send `/newbot`
3. Follow prompts, give bot a name (e.g., "TicketHub Bot")
4. Copy the bot token (e.g., `123456789:ABCdefGHIjklmnOPQrstuvWXYZ`)
5. Send `/setprivacy` and set ENABLED
6. Send `/setcommands` and add:
   - start - Register and welcome
   - help - Show help menu
   - trips - Browse available trips
   - bookings - View your tickets
   - contact_admin - Contact support

---

## Phase 2: Environment Setup (15 minutes)

### 1. GitHub Repository

```bash
# Initialize if not already done
git init
git add .
git commit -m "Initial TicketHub setup"
git branch -M main
git remote add origin https://github.com/yourusername/tickethub.git
git push -u origin main
```

### 2. Vercel Deployment

1. Go to https://vercel.com/dashboard
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Select "Next.js" as framework
5. Click "Deploy"

### 3. Environment Variables in Vercel

In Vercel Dashboard → Your Project → Settings → Environment Variables, add:

**Supabase:**
- `NEXT_PUBLIC_SUPABASE_URL` - From Supabase Settings
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - From Supabase Settings
- `SUPABASE_SERVICE_KEY` - From Supabase Settings

**Telegram:**
- `TELEGRAM_BOT_TOKEN` - Your bot token from @BotFather
- `TELEGRAM_WEBHOOK_SECRET` - Generate: `openssl rand -hex 32`

**Backup:**
- `CRON_SECRET` - Generate: `openssl rand -hex 32`

**Telebirr (Optional):**
- `TELEBIRR_API_KEY` - Your Telebirr API key
- `TELEBIRR_MERCHANT_ID` - Your merchant ID
- `TELEBIRR_API_URL` - https://api.telebirr.com/v1

**App:**
- `NEXT_PUBLIC_APP_URL` - Your deployment URL (e.g., https://tickethub.vercel.app)

### 4. Redeploy After Adding Variables

```bash
git commit --allow-empty -m "Trigger redeploy with env vars"
git push origin main
```

Or click "Redeploy" in Vercel Dashboard.

---

## Phase 3: Telegram Webhook Configuration (10 minutes)

Once deployed, configure Telegram webhook:

### Option A: Via curl (from your terminal)

```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-deployment-url.vercel.app/api/telegram",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET"
  }'
```

### Option B: Via Telegram API (https://api.telegram.org)

Replace `{BOT_TOKEN}` and values:

```
https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url=https://your-url/api/telegram&secret_token=YOUR_SECRET
```

### Verify Webhook

```bash
curl https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getWebhookInfo
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "url": "https://your-url/api/telegram",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": null
  }
}
```

---

## Phase 4: Testing (15 minutes)

### 1. Test Telegram Bot

1. Open Telegram
2. Search for your bot (@TicketHubBot or similar)
3. Send `/start`
4. Verify bot responds with welcome message

### 2. Test Admin Dashboard

1. Go to `https://your-deployment.vercel.app/admin/login`
2. Login with your admin credentials
3. Verify dashboard loads
4. Check each page:
   - Dashboard (overview stats)
   - Tickets (approval interface)
   - Customers (customer list)
   - Trips (trip management)
   - Invitations (QR codes)
   - Bulk Operations (CSV upload)
   - Backups (backup history)

### 3. Test Database

1. Admin Dashboard → Backups
2. Click "Manual Backup Now"
3. Verify backup appears in history

### 4. Create Test Trip

```sql
-- In Supabase SQL Editor
INSERT INTO trips (
  name, destination, departure_date, price_per_ticket, 
  total_seats, available_seats
) VALUES (
  'Test Trip to Addis Ababa',
  'Addis Ababa',
  NOW() + INTERVAL '7 days',
  500.00,
  50,
  50
);
```

---

## Phase 5: Production Hardening (30 minutes)

### 1. Security Headers

Add to `next.config.js`:

```javascript
async headers() {
  return [
    {
      source: '/:path*',
      headers: [
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block',
        },
      ],
    },
  ]
}
```

### 2. HTTPS Only

Vercel handles this automatically. Verify:
- All URLs should be https://
- No mixed content warnings

### 3. Database Backups

Verify automatic backups:

```sql
-- In Supabase SQL Editor
SELECT * FROM activity_logs 
WHERE action = 'AUTOMATED_BACKUP' 
ORDER BY created_at DESC 
LIMIT 5;
```

### 4. Enable Row Level Security (RLS)

```sql
-- Already configured in migration, but verify:
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND rowsecurity = true;
```

### 5. Rate Limiting

Add to environment:
- `RATE_LIMIT_WINDOW` - Default: 60 seconds
- `RATE_LIMIT_MAX_REQUESTS` - Default: 100

---

## Phase 6: Monitoring & Maintenance

### Weekly Tasks

1. Check backup logs
2. Review activity logs for anomalies
3. Monitor Vercel deployment logs
4. Test Telegram bot occasionally

### Monthly Tasks

1. Review security logs
2. Update dependencies: `npm update`
3. Export and archive customer data
4. Test disaster recovery (restore from backup)

### Quarterly Tasks

1. Security audit
2. Performance optimization
3. Update documentation
4. User feedback review

---

## Troubleshooting

### Bot Not Responding

1. Check `TELEGRAM_BOT_TOKEN` is correct
2. Verify webhook is set:
   ```bash
   curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo
   ```
3. Check Vercel logs: Dashboard → Deployments → Logs

### Backup Not Running

1. Verify `CRON_SECRET` is set in Vercel
2. Check cron job configuration in `vercel.json`
3. Wait until 2:00 AM UTC for automatic run
4. Or trigger manual backup from admin dashboard

### Database Connection Issues

1. Verify Supabase is online
2. Check environment variables are correct
3. Test direct connection from Supabase dashboard
4. Check network firewall rules

### Admin Login Not Working

1. Verify admin user exists in database
2. Check session cookies enabled
3. Clear browser cookies and retry
4. Check auth logs in Supabase

---

## Disaster Recovery

### Restore from Backup

```sql
-- To restore, you can:
-- 1. Export data from old backup
-- 2. Import to new Supabase project
-- 3. Update environment variables
-- 4. Redeploy application
```

### Database Restoration

1. Go to Supabase Dashboard
2. Settings → Backups
3. Select backup to restore
4. Click "Restore"

---

## Post-Deployment

### 1. Add Custom Domain (Optional)

1. Vercel Dashboard → Settings → Domains
2. Add your custom domain
3. Follow DNS configuration steps

### 2. Enable Analytics (Optional)

1. Vercel Dashboard → Analytics
2. View traffic, deployments, builds

### 3. Setup Monitoring (Optional)

Use Sentry, LogRocket, or similar:
- Error tracking
- Performance monitoring
- User session tracking

---

## Success Checklist

- [ ] Supabase database fully set up with all tables
- [ ] Admin user created
- [ ] Telegram bot token obtained and configured
- [ ] All environment variables set in Vercel
- [ ] Telegram webhook configured and verified
- [ ] Bot responds to commands
- [ ] Admin dashboard loads
- [ ] Can create and manage tickets
- [ ] Backups running automatically
- [ ] HTTPS enabled
- [ ] Security headers configured
- [ ] Team members can access admin dashboard
- [ ] First customer successfully created a booking

---

## Support

For issues or questions:
1. Check QUICKSTART.md
2. Review code comments
3. Check Vercel logs
4. Check Supabase logs
5. Test locally: `npm run dev`

---

**You're now live! 🚀 Monitor the system and make adjustments as needed.**
