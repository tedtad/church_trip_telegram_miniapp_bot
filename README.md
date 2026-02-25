# TicketHub - Telegram Ticket Reservation System

A comprehensive ticket reservation system with Telegram bot integration, admin dashboard, multi-admin support, and multilingual interface (English + Amharic).

## 🚀 Features

### Customer Features
- **Telegram Bot Interface**: Customers interact via Telegram to:
  - `/start` - Register/welcome
  - `/help` - View available commands
  - `/trips` - Browse available trips
  - `/bookings` - View their tickets
  - `/contact_admin` - Reach support

- **Receipt Upload**: Upload payment receipts with support for:
  - Bank transfers
  - Telebirr payments
  - Cash payments
  - Mobile money transfers

- **Reference Number Protection**: Prevents duplicate registrations with same payment reference

- **Multiple Tickets**: One receipt can contain multiple tickets based on quantity purchased

### Admin Features
- **Authentication**: Secure admin login with Supabase Auth
- **Dashboard**: Overview of statistics and key metrics
- **Ticket Approval**: Review and approve/reject payment receipts
  - Verify reference numbers
  - Add approval notes
  - Send rejection reasons
  
- **Customer Management**:
  - View customer profiles
  - Track purchase history
  - Send notifications
  - Export customer data to CSV

- **Activity Logging**: Complete audit trail of all admin actions with:
  - Admin ID tracking
  - IP address logging
  - User agent tracking
  - Action timestamps

- **Multi-Admin Support**: Multiple admins with role-based access
- **CSV Export**: Export customer, ticket, and activity data
- **Automated Database Backups**: 
  - Daily automatic backups at 2 AM UTC
  - Manual backup capability from admin dashboard
  - 30-day rolling retention
  - Backup history and monitoring

- **Multilingual Interface**: English and Amharic (አማርኛ)

## 📋 Prerequisites

- Node.js 18+
- Supabase account
- Telegram Bot Token (from @BotFather)

## 🔧 Setup Instructions

### 1. Database Setup

Follow the instructions in `DATABASE_SETUP.md` to set up the Supabase schema.

### 2. Environment Variables

Create `.env.local` in the root directory:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Optional: Telebirr API (future implementation)
# TELEBIRR_API_KEY=your_api_key
# TELEBIRR_API_SECRET=your_api_secret
```

### 3. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 4. Create Admin User

1. Sign up in Supabase Authentication
2. Insert admin record in `admin_users` table:
   ```sql
   INSERT INTO admin_users (email, name, role, is_active)
   VALUES ('admin@example.com', 'Admin Name', 'admin', true);
   ```

### 5. Set Up Telegram Webhook

After deploying, register your webhook URL with Telegram:

```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourdomain.com/api/telegram",
    "allowed_updates": ["message", "callback_query"]
  }'
```

### 6. Run Development Server

```bash
npm run dev
```

Visit:
- **Public Site**: http://localhost:3000
- **Admin Dashboard**: http://localhost:3000/admin/login

## 📁 Project Structure

```
app/
├── page.tsx                    # Home/landing page
├── api/
│   └── telegram/
│       ├── route.ts           # Telegram webhook endpoint
│       └── notify/route.ts    # Notification sender
├── admin/
│   ├── layout.tsx             # Admin sidebar layout
│   ├── login/page.tsx         # Admin login
│   ├── dashboard/page.tsx     # Overview dashboard
│   ├── tickets/page.tsx       # Approve/reject tickets
│   ├── customers/page.tsx     # Manage customers
│   ├── trips/page.tsx         # Manage trips
│   └── analytics/page.tsx     # Analytics (WIP)
├── layout.tsx                 # Root layout
└── globals.css               # Global styles

lib/
├── types.ts                   # TypeScript types
├── telegram.ts                # Telegram utilities
├── admin-auth.ts              # Admin authentication
├── translations.ts            # i18n helper
├── supabase/
│   ├── client.ts              # Client-side Supabase
│   ├── server.ts              # Server-side Supabase
│   └── proxy.ts               # Session proxy

locales/
├── en.json                    # English translations
└── am.json                    # Amharic translations

scripts/
└── 01-setup-database.sql      # Database schema

components/ui/                # shadcn/ui components
```

## 🗄️ Database Schema

### Core Tables

1. **telegram_users** - Customer information
2. **trips** - Available trips/tours
3. **receipts** - Payment records with unique reference numbers
4. **tickets** - Individual tickets (one or more per receipt)
5. **admin_users** - Admin accounts
6. **activity_logs** - Audit trail of all admin actions
7. **approvals** - Approval history
8. **invitations** - QR codes & affiliate links (future)
9. **notifications** - Customer notifications
10. **telegram_channels** - Auto-created customer channels

### Key Constraints

- **reference_number**: UNIQUE on receipts (prevents duplicate payments)
- **serial_number**: UNIQUE on tickets (for digital ticket identification)
- **Quantity Support**: One receipt can have multiple tickets

## 🔐 Security Features

- **RLS (Row Level Security)**: Data isolation between customers and admins
- **Activity Logging**: Complete audit trail with admin ID, IP, and user agent
- **Reference Number Validation**: Prevents duplicate payment registration
- **Secure Session Management**: HTTP-only cookies with Supabase Auth
- **Input Validation**: Sanitization and validation on all inputs

## 🌍 Internationalization

Currently supports:
- **English** (en)
- **Amharic** (am) - አማርኛ

Add new languages by:
1. Creating new locale JSON file: `locales/{lang_code}.json`
2. Adding to `i18n.config.ts`
3. Using `t()` helper in components

## 📱 Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Register and welcome |
| `/help` | Show available commands |
| `/trips` | List available trips |
| `/bookings` | View your tickets |
| `/contact_admin` | Contact support |

## 🛠️ API Endpoints

### Telegram Webhook
- **POST** `/api/telegram` - Receive Telegram updates

### Notifications
- **POST** `/api/telegram/notify` - Send customer notification

## 📊 Admin Dashboard Features

### Dashboard Tab
- Total tickets sold
- Pending approvals
- Approved tickets
- Total customers
- Revenue metrics
- Active trips

### Tickets Tab
- Filter by status (pending, approved, rejected)
- View receipt details
- Approve with notes
- Reject with reason
- Download receipt files

### Customers Tab
- Search customers
- View purchase history
- Send notifications
- Export to CSV

### Trips Tab
- Create/edit trips
- Manage seat availability
- Track pricing
- View bookings

## 🚀 Deployment

### Vercel (Recommended)

```bash
npm run build
```

Deploy via Git push or Vercel CLI.

### Environment Variables

Set these in your Vercel project settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `TELEGRAM_BOT_TOKEN`

## 🔄 Future Enhancements

- [ ] Telebirr API integration
- [ ] QR code generation for invitations
- [ ] Admin invitation links
- [ ] Advanced analytics charts
- [ ] Email notifications
- [ ] SMS alerts
- [ ] Mobile app
- [ ] Payment processing API integration

## 📝 License

MIT License - Feel free to use for commercial projects

## 💬 Support

For issues or questions, please contact support or file a GitHub issue.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## ⚠️ Important Notes

### Telegram Webhook URL
- Must be HTTPS
- Must be publicly accessible
- Update in Telegram BotFather after deployment

### Database
- Always backup before running migrations
- Test in staging environment first
- See `DATABASE_SETUP.md` for detailed instructions

### Admin Access
- Change default admin password immediately
- Use strong, unique passwords
- Implement 2FA when available

### Payment References
- The `reference_number` field is UNIQUE
- Prevents duplicate payment registration
- Customers can buy multiple tickets with one receipt (quantity field)

---

**Version**: 1.0.0  
**Last Updated**: February 2026
