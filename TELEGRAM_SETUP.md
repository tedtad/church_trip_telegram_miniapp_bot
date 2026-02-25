# Telegram Bot Setup Guide

Complete guide to set up the Telegram bot and webhook for TicketHub.

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/start` or `/newbot`
3. Follow the prompts:
   - Give your bot a name (e.g., "TicketHub Bot")
   - Give your bot a username (must end with "bot", e.g., "tickethub_bot")
4. **Save your bot token** - you'll need this for `.env.local`

Example token format: `123456789:ABCdefGHIjklmnOPQRstUVWXyz`

## Step 2: Set Bot Commands

In BotFather, send:

```
/setcommands

Use this format:
start - Register and start booking
help - Show available commands
trips - Browse available trips
bookings - View your tickets
contact_admin - Contact support
```

## Step 3: Configure Webhook (After Deployment)

After deploying your app to production, register the webhook URL with Telegram.

### Option A: Using cURL

```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourdomain.com/api/telegram",
    "allowed_updates": ["message", "callback_query"],
    "max_connections": 40
  }'
```

Replace:
- `{YOUR_BOT_TOKEN}` - Your bot token from BotFather
- `yourdomain.com` - Your deployed domain

### Option B: Using Python

```python
import requests

BOT_TOKEN = "your_bot_token_here"
WEBHOOK_URL = "https://yourdomain.com/api/telegram"

url = f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook"
data = {
    "url": WEBHOOK_URL,
    "allowed_updates": ["message", "callback_query"],
    "max_connections": 40
}

response = requests.post(url, json=data)
print(response.json())
```

### Option C: Postman

1. Create POST request to: `https://api.telegram.org/bot{BOT_TOKEN}/setWebhook`
2. Set body (JSON):
```json
{
  "url": "https://yourdomain.com/api/telegram",
  "allowed_updates": ["message", "callback_query"],
  "max_connections": 40
}
```
3. Send request

## Step 4: Verify Webhook

Check if webhook is set correctly:

```bash
curl https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getWebhookInfo
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "url": "https://yourdomain.com/api/telegram",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "max_connections": 40,
    "allowed_updates": ["message", "callback_query"]
  }
}
```

## Step 5: Add to Environment

In your Vercel project settings or `.env.local`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklmnOPQRstUVWXyz
```

## Step 6: Test the Bot

1. Search for your bot on Telegram (e.g., @tickethub_bot)
2. Send `/start`
3. Should receive welcome message

If you don't receive a response:
1. Check webhook URL is correct
2. Verify bot token is set in environment
3. Check server logs for errors
4. Ensure HTTPS is being used

## Development (Local Testing)

For local development, you can use polling instead of webhooks:

1. Set webhook to empty:
```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{"url": ""}'
```

2. Run a polling script (not included in this project)

Or use ngrok for local HTTPS tunneling:

```bash
# Install ngrok: https://ngrok.com

ngrok http 3000

# This gives you a URL like: https://xxxx-xx-xxx-xx-x.ngrok.io
# Use this as your webhook URL
```

## Bot Commands Reference

### User Commands
- `/start` - Registration and welcome
- `/help` - Show help menu
- `/trips` - List available trips
- `/bookings` - Show user's tickets
- `/contact_admin` - Support request

### Bot States (Handled by Webhook)
1. **New User**: Registers in database, shows welcome
2. **Booking Request**: User can select trip and upload receipt
3. **Approval Pending**: Admin reviews receipt
4. **Approved**: Digital ticket sent to user
5. **Rejected**: Reason sent, user can resubmit

## Troubleshooting

### Bot not responding

**Problem**: Bot doesn't reply to messages
- Check bot token in `.env.local`
- Verify webhook URL points to your domain
- Ensure `/api/telegram` endpoint exists
- Check server logs

**Solution**:
```bash
# Verify webhook is set
curl https://api.telegram.org/bot{TOKEN}/getWebhookInfo

# Reset webhook
curl -X POST https://api.telegram.org/bot{TOKEN}/setWebhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://yourdomain.com/api/telegram"}'
```

### Webhook receiving 403 error

**Problem**: Telegram can't reach your webhook
- Ensure domain has valid HTTPS certificate
- Check firewall/security groups allow incoming traffic
- Verify webhook URL is public and accessible

**Solution**:
```bash
# Test if endpoint is accessible
curl https://yourdomain.com/api/telegram

# Should return 400 (since no valid Telegram data sent)
# If returns 403, check authentication
```

### Messages not being sent to users

**Problem**: Bot receives messages but doesn't send replies
- Check Telegram token is correct
- Verify message handler is implemented
- Check database is connected
- Review application logs

**Solution**:
1. Add logging to webhook handler
2. Check Supabase connection
3. Verify chat ID is valid

### Rate Limiting

If you get rate limit errors:
- Telegram limits ~30 messages per second
- Implement message queuing
- Add delays between bulk operations
- Use `max_connections` parameter (currently set to 40)

## Security Considerations

1. **Token Protection**: Never commit bot token to git
2. **HTTPS Required**: Telegram only accepts HTTPS webhooks
3. **Webhook Validation**: Implement signature verification for production
4. **User Input**: Sanitize all user inputs
5. **Rate Limiting**: Implement rate limiting for API endpoints

## Production Checklist

- [ ] Bot token stored in environment variables (not hardcoded)
- [ ] HTTPS certificate is valid and not self-signed
- [ ] Webhook URL is publicly accessible
- [ ] getWebhookInfo shows correct URL and status
- [ ] Bot responds to `/start` command
- [ ] Admin dashboard works and receives notifications
- [ ] Backup of database before production deployment
- [ ] Error logging is enabled
- [ ] Rate limiting is configured

## Advanced Features (Coming Soon)

- [ ] Inline buttons for trip selection
- [ ] Receipt file upload handling
- [ ] Automated approval notifications
- [ ] Payment gateway integration
- [ ] QR code generation
- [ ] Admin group messaging

## Support

For issues with Telegram bot:
1. Check [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
2. Review [BotFather commands](https://core.telegram.org/bots#botfather)
3. Test webhook with provided tools
4. Check application logs

---

**Last Updated**: February 2026
