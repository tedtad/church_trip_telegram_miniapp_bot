# TicketHub Deployment Checklist

Use this checklist to ensure proper deployment to production.

## Pre-Deployment (Before pushing code)

### Code Quality
- [ ] No console.log() debug statements left
- [ ] No hardcoded secrets in code
- [ ] TypeScript compiles without errors
- [ ] All dependencies are in package.json
- [ ] No unused imports

### Testing
- [ ] Local development server runs without errors
- [ ] Admin login works correctly
- [ ] Database queries execute without errors
- [ ] Telegram webhook endpoint accessible locally (with ngrok)
- [ ] All API endpoints respond correctly
- [ ] CSV export functionality tested

### Documentation
- [ ] README.md is up to date
- [ ] Environment variables documented
- [ ] Database schema documented
- [ ] API endpoints documented
- [ ] Deployment steps clear

## Repository Setup

- [ ] Project pushed to GitHub
- [ ] `.gitignore` includes `.env.local`
- [ ] No sensitive files in git history
- [ ] Branch protection rules configured (if team)
- [ ] README visible on GitHub

## Supabase Setup

### Database
- [ ] Supabase project created
- [ ] Database migration script executed successfully
- [ ] All 10 tables created and visible
- [ ] Indexes created correctly
- [ ] Sample queries tested

### Admin User
- [ ] Admin user created in database
```sql
INSERT INTO admin_users (email, name, role, is_active)
VALUES ('admin@yourdomain.com', 'Your Name', 'admin', true);
```

### Database Backups
- [ ] `database_backups` table created (part of migration)
- [ ] Backup indexes created
- [ ] Manual backup tested in development

### Admin User Email & Password
- [ ] Email exists in Supabase Auth
- [ ] Password set securely
- [ ] Admin can login to dashboard

### Environment Variables
- [ ] `NEXT_PUBLIC_SUPABASE_URL` obtained
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` obtained
- [ ] Keys tested with local app

## Telegram Bot Setup

### BotFather Configuration
- [ ] Bot created via @BotFather
- [ ] Bot token saved securely
- [ ] Bot username set (e.g., @tickethub_bot)
- [ ] Bot description set
- [ ] Bot profile picture uploaded
- [ ] Commands configured via BotFather

### Testing
- [ ] Bot found by searching on Telegram
- [ ] Local webhook receives messages (with ngrok)
- [ ] All commands work (/start, /help, etc.)
- [ ] Message handling verified

## Vercel Setup

### Project Creation
- [ ] Vercel account created
- [ ] GitHub repository connected
- [ ] Vercel project created
- [ ] Deployment preview works

### Environment Variables
Add these to Vercel project settings:
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `CRON_SECRET` (for automatic backups - generate: `openssl rand -base64 32`)

### Build Configuration
- [ ] Build command: `npm run build`
- [ ] Start command: default (npm start)
- [ ] Install command: default (npm ci)
- [ ] Node.js version set to 18+
- [ ] No manual build steps needed

## Deployment

### Initial Deployment
- [ ] Project builds successfully on Vercel
- [ ] No build errors in deployment logs
- [ ] No runtime errors in function logs
- [ ] Site accessible via Vercel domain
- [ ] Admin dashboard loads
- [ ] Admin login works

### Domain Configuration
- [ ] Custom domain added (if applicable)
- [ ] SSL certificate valid
- [ ] HTTPS enforced
- [ ] www redirect configured (if needed)

### Telegram Webhook Setup
After deployment is complete:
```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourdomain.com/api/telegram",
    "allowed_updates": ["message", "callback_query"],
    "max_connections": 40
  }'
```
- [ ] Replace {YOUR_BOT_TOKEN} with actual token
- [ ] Replace yourdomain.com with your Vercel domain
- [ ] Webhook status verified: `getWebhookInfo`
- [ ] Webhook shows correct URL
- [ ] Webhook shows 0 pending updates

## Post-Deployment Testing

### Admin Dashboard
- [ ] Homepage loads
- [ ] Admin login page accessible
- [ ] Can login with admin credentials
- [ ] Dashboard displays statistics
- [ ] All navigation links work
- [ ] Tickets page loads (shows pending approvals)
- [ ] Customers page shows users
- [ ] Can search customers
- [ ] CSV export works
- [ ] Trips page displays trips
- [ ] Analytics page loads

### Telegram Bot
- [ ] Bot search returns your bot
- [ ] `/start` command works
- [ ] `/help` command works
- [ ] `/trips` command returns trip list
- [ ] `/bookings` command works (no bookings yet)
- [ ] Invalid command handled gracefully
- [ ] Message responses are in correct language

### Database
- [ ] Sample telegram user created
- [ ] No database errors in logs
- [ ] Queries execute within timeout
- [ ] Data persists across deployments

### API Endpoints
- [ ] `/api/telegram` responds to POST (accepts Telegram updates)
- [ ] `/api/telegram/notify` works for notifications
- [ ] Error handling works correctly

### Database Backups
- [ ] Backups page loads in admin dashboard
- [ ] Manual backup can be triggered
- [ ] Backup completes successfully
- [ ] Backup appears in history
- [ ] Backup shows correct data (size, duration)
- [ ] Multiple backups display in table
- [ ] Scheduled cron job configured in vercel.json
- [ ] CRON_SECRET environment variable set

## Security Verification

- [ ] No secrets visible in code
- [ ] Environment variables not exposed
- [ ] HTTPS being used for all connections
- [ ] Bot token secure (only in environment)
- [ ] Admin credentials not shared
- [ ] Database backups configured (Supabase)
- [ ] Activity logs tracking admin actions
- [ ] No debug output to clients

## Performance Check

- [ ] Admin dashboard loads within 2 seconds
- [ ] API responses within 500ms
- [ ] Database queries efficient (check Supabase stats)
- [ ] No N+1 query problems
- [ ] Telegram webhook responds quickly

## Monitoring Setup

- [ ] Error tracking enabled (optional: Sentry)
- [ ] Analytics enabled (Vercel Analytics)
- [ ] Logs accessible and readable
- [ ] Alert notifications configured (if critical)

## Backup & Disaster Recovery

- [ ] Supabase automatic backups enabled
- [ ] Manual backup tested
- [ ] Backup retention policy set
- [ ] Recovery procedure documented
- [ ] GitHub repository is your code backup

## Documentation Updates

- [ ] README reflects production setup
- [ ] Environment variables documented
- [ ] Deployment steps documented
- [ ] Admin user credentials stored securely
- [ ] Bot token stored securely
- [ ] API endpoints documented
- [ ] Troubleshooting guide updated

## Team Communication

- [ ] Team notified of deployment
- [ ] Admin credentials shared securely
- [ ] Access credentials documented
- [ ] On-call schedule established (if needed)
- [ ] Support contact information shared

## Launch Preparation

- [ ] Marketing ready (if applicable)
- [ ] Customer communication ready
- [ ] Support team trained
- [ ] FAQ prepared
- [ ] Contact information accurate

## First 24 Hours Monitoring

- [ ] Monitor error logs for issues
- [ ] Test customer signup flow
- [ ] Test payment receipt upload
- [ ] Test ticket approval workflow
- [ ] Verify notifications sent
- [ ] Check database disk usage
- [ ] Monitor API response times
- [ ] Review admin activity logs

## Issues Found?

### Common Issues & Fixes

**Telegram bot not responding:**
- [ ] Check bot token in Vercel env vars
- [ ] Verify webhook URL with `getWebhookInfo`
- [ ] Check function logs for errors
- [ ] Ensure webhook is properly registered

**Admin login not working:**
- [ ] Verify admin user in database
- [ ] Check Supabase Auth configuration
- [ ] Review authentication logs
- [ ] Test with another user account

**Database connection errors:**
- [ ] Verify Supabase URL and keys
- [ ] Check database is online
- [ ] Verify tables exist with correct names
- [ ] Check connection pool limits

**Performance issues:**
- [ ] Check Supabase query performance
- [ ] Review Vercel function duration
- [ ] Check database indexes
- [ ] Look for slow queries

### Rollback Procedure

If critical issues found:
1. [ ] Document the issue
2. [ ] Check error logs and stack traces
3. [ ] Test fix locally first
4. [ ] Commit fix to GitHub
5. [ ] Revert Vercel deployment if needed
6. [ ] Push new deployment
7. [ ] Verify fix in production
8. [ ] Update team on status

## Sign-Off

- [ ] Project Lead: _________________ Date: _______
- [ ] Technical Lead: _________________ Date: _______
- [ ] QA Lead: _________________ Date: _______

## Final Notes

- [ ] No issues found - System is live!
- [ ] Minor issues found - Monitoring closely
- [ ] Major issues found - Investigating (see notes below)

**Additional Notes:**
```

```

---

## Maintenance Checklist (Monthly)

- [ ] Review admin activity logs
- [ ] Check database backup status
- [ ] Review error logs
- [ ] Update dependencies (if secure)
- [ ] Test disaster recovery
- [ ] Verify HTTPS certificate status
- [ ] Check disk space usage
- [ ] Monitor performance metrics
- [ ] Review security logs
- [ ] Update documentation if needed

## Success Criteria

Your deployment is successful when:

✅ Admin dashboard is accessible  
✅ Telegram bot responds to commands  
✅ Database has all tables  
✅ Admin can approve tickets  
✅ Customers receive notifications  
✅ CSV export works  
✅ Activity logs record actions  
✅ No errors in logs  

---

**Congratulations on your deployment!**

Keep this checklist for future reference and updates.
For ongoing support, refer to:
- QUICKSTART.md
- README.md
- DOCS_INDEX.md
