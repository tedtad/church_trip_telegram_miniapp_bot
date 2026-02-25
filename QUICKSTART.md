# TicketHub - Quick Start Guide

Get your Telegram ticket reservation system running in 30 minutes!

## Prerequisites Checklist

Before you start, make sure you have:
- [ ] Node.js 18+ installed
- [ ] Supabase account (free tier available at supabase.com)
- [ ] Telegram account
- [ ] Text editor (VS Code recommended)

## 5-Minute Setup

### 1. Get Telegram Bot Token

1. Open Telegram and find **@BotFather**
2. Send `/newbot`
3. Follow prompts and save your **Bot Token**
4. Remember: it looks like `123456789:ABCdefGHI...`

### 2. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Wait for database to initialize
4. Go to Settings → API and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Setup Database

1. In Supabase, go to SQL Editor
2. Click "New Query"
3. Copy entire content from `/scripts/01-setup-database.sql`
4. Paste into SQL Editor
5. Click "Run" (or Cmd/Ctrl + Enter)
6. Wait for success ✅

### 4. Create Admin Account

In Supabase SQL Editor, run:

```sql
INSERT INTO admin_users (email, name, role, is_active)
VALUES ('admin@example.com', 'Your Name', 'admin', true);
```

Then sign up in Supabase Auth with the same email.

### 5. Clone & Configure

```bash
# Clone this project
git clone <your-repo-url>
cd tickethub

# Install dependencies
npm install

# Create .env.local
cat > .env.local << EOF
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
TELEGRAM_BOT_TOKEN=your_bot_token_here
EOF

# Start development server
npm run dev
```

Visit: http://localhost:3000

## Test Locally

### Admin Dashboard
1. Go to http://localhost:3000/admin/login
2. Use admin email from step 4
3. Password: whatever you set in Supabase auth
4. You should see the dashboard ✅

### Telegram Bot (Local Testing)

For local development, you can't use webhooks. Instead, use this polling approach:

**Option A: Manual Testing**
- Message your bot `/start`
- Since webhook isn't configured yet, it won't respond
- This is normal for development

**Option B: Use ngrok for Testing**
```bash
# Download from https://ngrok.com/download
ngrok http 3000

# Copy the HTTPS URL from ngrok output
# Example: https://xxxx-xx-xxxx.ngrok.io

# Set webhook (replace YOUR_BOT_TOKEN and URL)
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://xxxx-xx-xxxx.ngrok.io/api/telegram"}'

# Now test on Telegram - bot should respond!
```

## Deploy to Vercel

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Deploy

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repo
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `TELEGRAM_BOT_TOKEN`
5. Click Deploy

### 3. Set Telegram Webhook

After deployment completes:

```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-vercel-domain.vercel.app/api/telegram",
    "allowed_updates": ["message", "callback_query"],
    "max_connections": 40
  }'
```

Replace `your-vercel-domain` with your actual Vercel domain.

### 4. Test on Telegram

Message your bot `/start` - should work now! ✅

## File Structure Summary

```
├── app/
│   ├── page.tsx                 # Landing page
│   ├── admin/                   # Admin dashboard
│   └── api/telegram/            # Bot webhook
├── lib/
│   ├── telegram.ts              # Bot utilities
│   ├── admin-auth.ts            # Admin auth
│   └── supabase/                # Supabase clients
├── locales/
│   ├── en.json                  # English
│   └── am.json                  # Amharic
└── scripts/
    └── 01-setup-database.sql    # Database schema
```

## Key Features

✅ **Telegram Bot** - Customers book via Telegram  
✅ **Admin Dashboard** - Approve/reject receipts  
✅ **Reference Numbers** - Prevent duplicate payments  
✅ **Unique Serial Numbers** - Digital ticket IDs  
✅ **Admin Activity Logging** - Audit trail  
✅ **Multi-Admin** - Multiple admins with role-based access  
✅ **Multilingual** - English + Amharic  
✅ **CSV Export** - Export customer data  
✅ **Payment Methods** - Bank, Telebirr, Cash, Mobile Money  
✅ **Notifications** - Auto-send updates to customers  

## Troubleshooting

### "Invalid database connection"
- Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Verify Supabase project is active
- Run database migration again

### "Admin login doesn't work"
- Ensure you created admin user in database (step 4)
- Check email matches in both Supabase Auth and admin_users table
- Verify password in Supabase Auth

### "Bot doesn't respond to Telegram"
- Check `TELEGRAM_BOT_TOKEN` is correct
- Verify webhook URL is set (use `getWebhookInfo`)
- Ensure webhook URL is HTTPS and public
- Check `/api/telegram` endpoint exists
- Review server logs

### "Database tables don't exist"
- Run SQL script in Supabase SQL Editor (step 3)
- Check for error messages after running
- Verify all CREATE TABLE statements succeeded

## Next Steps

1. **Customize**: Update app name, colors, messages
2. **Add Trips**: Create trips in admin dashboard
3. **Test Flow**: Upload receipt → admin approves → customer gets ticket
4. **Invite Users**: Share Telegram bot link with customers
5. **Monitor**: Check admin dashboard for statistics
6. **Export Data**: Use CSV export for reporting

## Environment Variables Reference

| Variable | Required | Example |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | `eyJhbGc...` |
| `TELEGRAM_BOT_TOKEN` | ✅ | `123456789:ABC...` |

## Support Resources

- **Supabase Docs**: https://supabase.com/docs
- **Telegram Bot API**: https://core.telegram.org/bots/api
- **Next.js Docs**: https://nextjs.org/docs
- **Project README**: See README.md for full documentation

## FAQ

**Q: Can I use this in production?**  
A: Yes! Just ensure SSL certificates, secure tokens, and proper backups.

**Q: How do I add more languages?**  
A: Create new JSON file in `locales/` directory and add to `i18n.config.ts`

**Q: Can I integrate Telebirr?**  
A: Yes! Use the placeholder in `/lib/telegram.ts` and add your Telebirr API logic.

**Q: How many concurrent users can it handle?**  
A: Depends on Supabase plan. Vercel serverless auto-scales.

**Q: Do I need to pay?**  
A: Supabase and Vercel have free tiers. Telegram Bot API is free.

---

**You're all set!** Your Telegram ticket system is ready to go.  
Visit your admin dashboard, create some trips, and start selling tickets!

For detailed info, see:
- DATABASE_SETUP.md - Database instructions
- TELEGRAM_SETUP.md - Advanced Telegram config
- README.md - Complete documentation
