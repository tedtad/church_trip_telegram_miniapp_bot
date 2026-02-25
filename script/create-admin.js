#!/usr/bin/env node

/*
  Bootstrap admin creator with Telegram linkage.

  Usage:
    node script/create-admin.js \
      --email admin@example.com \
      --password 'StrongPass123!' \
      --name 'System Admin' \
      --role system_admin \
      --telegram-id 123456789 \
      --phone +2519XXXXXXXX
*/

const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function required(name, value) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`Missing required argument: --${name}`);
  }
  return text;
}

function splitName(fullName) {
  const normalized = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(' ');
  return {
    firstName: parts.shift() || normalized,
    lastName: parts.join(' ') || null,
  };
}

async function findAuthUserByEmail(supabase, email) {
  const pageSize = 200;
  let page = 1;
  while (page <= 25) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: pageSize,
    });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((user) => String(user.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (users.length < pageSize) break;
    page += 1;
  }
  return null;
}

async function ensureTelegramUser(supabase, telegramId, name, phone) {
  const { firstName, lastName } = splitName(name);
  const payload = {
    id: Number(telegramId),
    first_name: firstName || 'Admin',
    last_name: lastName,
    phone_number: phone || null,
    language_code: 'en',
    status: 'active',
    last_interaction: new Date().toISOString(),
  };

  const { error } = await supabase.from('telegram_users').upsert(payload, { onConflict: 'id' });
  if (error) {
    throw new Error(`Failed to upsert telegram_users: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log('Use --email --password --name --role --telegram-id [--phone]');
    return;
  }

  const email = required('email', args.email).toLowerCase();
  const password = required('password', args.password);
  const name = required('name', args.name);
  const role = String(args.role || 'system_admin').trim();
  const telegramIdRaw = required('telegram-id', args['telegram-id']);
  const phone = String(args.phone || '').trim();

  const telegramId = Number(telegramIdRaw);
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    throw new Error('--telegram-id must be a valid positive number');
  }

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  await ensureTelegramUser(supabase, telegramId, name, phone);

  let authUserId = '';
  const createResult = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: name,
      role,
      telegram_user_id: telegramId,
    },
  });

  if (createResult.error) {
    const message = String(createResult.error.message || '').toLowerCase();
    if (message.includes('already') || message.includes('exists') || message.includes('registered')) {
      const existing = await findAuthUserByEmail(supabase, email);
      if (!existing?.id) {
        throw new Error(`Auth user already exists but could not resolve user id for ${email}`);
      }
      authUserId = String(existing.id);
    } else {
      throw new Error(`Failed to create auth user: ${createResult.error.message}`);
    }
  } else {
    authUserId = String(createResult.data.user?.id || '');
  }

  if (!authUserId) {
    throw new Error('Unable to determine auth user id');
  }

  const adminPayload = {
    id: authUserId,
    email,
    name,
    phone_number: phone || null,
    role,
    is_active: true,
    telegram_user_id: telegramId,
    two_factor_enabled: true,
  };

  let upsertResult = await supabase
    .from('admin_users')
    .upsert(adminPayload, { onConflict: 'id' })
    .select('id, email, role, telegram_user_id, two_factor_enabled')
    .single();

  if (upsertResult.error) {
    const message = String(upsertResult.error.message || '').toLowerCase();
    const isEmailConflict =
      message.includes('duplicate key') ||
      message.includes('admin_users_email_key') ||
      message.includes('email');
    if (isEmailConflict) {
      upsertResult = await supabase
        .from('admin_users')
        .update({
          id: authUserId,
          name,
          phone_number: phone || null,
          role,
          is_active: true,
          telegram_user_id: telegramId,
          two_factor_enabled: true,
        })
        .eq('email', email)
        .select('id, email, role, telegram_user_id, two_factor_enabled')
        .single();
    }
  }

  if (upsertResult.error) {
    throw new Error(`Failed to upsert admin_users: ${upsertResult.error.message}`);
  }

  await supabase
    .from('app_settings')
    .upsert({ id: 'default', two_factor_enabled: true, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  console.log('Admin bootstrap complete:');
  console.log(JSON.stringify(upsertResult.data, null, 2));
}

main().catch((error) => {
  console.error('[create-admin] Error:', error.message || error);
  process.exit(1);
});
