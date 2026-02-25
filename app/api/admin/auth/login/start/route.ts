import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createPublicAuthClient,
  isGlobalTwoFactorEnabled,
  loadAdminByEmailOrUserId,
} from '@/lib/admin-auth-server';
import { generateOtpCode, hashOtpCode, maskTelegramId } from '@/lib/admin-2fa';
import { createAdminSessionToken, setAdminSessionCookie } from '@/lib/admin-session';
import { sendTelegramMessage } from '@/lib/telegram';

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 3;

function extractClientIp(request: NextRequest) {
  const xff = String(request.headers.get('x-forwarded-for') || '').trim();
  if (!xff) return '';
  return xff.split(',')[0]?.trim() || '';
}

function isMissingOtpTable(error: unknown) {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    (message.includes('relation') && message.includes('admin_otp_challenges') && message.includes('does not exist')) ||
    message.includes('admin_otp_challenges')
  );
}

async function insertOtpChallenge(supabase: any, payload: Record<string, unknown>) {
  const variants: Array<Record<string, unknown>> = [
    payload,
      {
        id: payload.id,
        admin_id: payload.admin_id,
        otp_hash: payload.otp_hash,
        expires_at: payload.expires_at,
        attempts: 0,
        max_attempts: OTP_MAX_ATTEMPTS,
        status: 'pending',
      },
  ];

  let lastError: any = null;
  for (const variant of variants) {
    const { data, error } = await supabase.from('admin_otp_challenges').insert(variant).select('id').maybeSingle();
    if (!error) return data;
    lastError = error;
  }

  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '').trim();

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, success: false, error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    const authClient = createPublicAuthClient();
    const signIn = await authClient.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.user) {
      return NextResponse.json(
        { ok: false, success: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const supabase = await createAdminClient();
    const admin = await loadAdminByEmailOrUserId(supabase, email, signIn.data.user.id);

    await authClient.auth.signOut().catch(() => undefined);

    if (!admin || admin.is_active === false) {
      return NextResponse.json(
        { ok: false, success: false, error: 'Admin account is not active or not registered.' },
        { status: 403 }
      );
    }

    const globalTwoFactor = await isGlobalTwoFactorEnabled(supabase);
    const adminTwoFactor = admin.two_factor_enabled !== false;
    const requireTwoFactor = globalTwoFactor && adminTwoFactor;

    if (!requireTwoFactor) {
      const session = createAdminSessionToken({
        adminId: String(admin.id),
        email: String(admin.email),
        role: String(admin.role || 'admin'),
        name: String(admin.name || ''),
      });

      const response = NextResponse.json({
        ok: true,
        success: true,
        requiresOtp: false,
        admin: {
          id: String(admin.id),
          email: String(admin.email || email),
          name: String(admin.name || email),
          role: String(admin.role || 'admin'),
        },
        expiresAt: session.expiresAt,
      });

      setAdminSessionCookie(response, session.token, session.expiresAt);
      await supabase
        .from('admin_users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', String(admin.id));
      return response;
    }

    const telegramUserId = String(admin.telegram_user_id || '').trim();
    if (!telegramUserId) {
      return NextResponse.json(
        {
          ok: false,
          success: false,
          error:
            '2FA is enabled but this admin has no linked Telegram user ID. Update admin_users.telegram_user_id first.',
        },
        { status: 400 }
      );
    }

    const challengeId = randomUUID();
    const otpCode = generateOtpCode();
    const otpHash = hashOtpCode(challengeId, otpCode);
    const expiresAtIso = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

    await supabase
      .from('admin_otp_challenges')
      .update({ status: 'expired' })
      .eq('admin_id', String(admin.id))
      .eq('status', 'pending');

    try {
      await insertOtpChallenge(supabase, {
        id: challengeId,
        admin_id: String(admin.id),
        otp_hash: otpHash,
        expires_at: expiresAtIso,
        attempts: 0,
        max_attempts: OTP_MAX_ATTEMPTS,
        status: 'pending',
        requested_ip: extractClientIp(request) || null,
        requested_user_agent: String(request.headers.get('user-agent') || '').slice(0, 512) || null,
      });
    } catch (insertError) {
      if (isMissingOtpTable(insertError)) {
        return NextResponse.json(
          {
            ok: false,
            success: false,
            error:
              'admin_otp_challenges table is missing. Run scripts/14-admin-2fa-and-security.sql before using 2FA.',
          },
          { status: 500 }
        );
      }
      throw insertError;
    }

    const otpMessage = [
      `TicketHub Admin verification code: ${otpCode}`,
      `This code expires in ${Math.floor(OTP_TTL_SECONDS / 60)} minutes.`,
      'If you did not request this, ignore the message.',
    ].join('\n');

    const sendResult = await sendTelegramMessage(telegramUserId, otpMessage);
    if (!sendResult) {
      await supabase
        .from('admin_otp_challenges')
        .update({ status: 'failed' })
        .eq('id', challengeId);

      return NextResponse.json(
        {
          ok: false,
          success: false,
          error:
            'Failed to deliver OTP to Telegram. Verify bot access and the linked Telegram ID.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      requiresOtp: true,
      challengeId,
      expiresInSeconds: OTP_TTL_SECONDS,
      telegram: maskTelegramId(telegramUserId),
      admin: {
        id: String(admin.id),
        email: String(admin.email || email),
        name: String(admin.name || email),
        role: String(admin.role || 'admin'),
      },
    });
  } catch (error) {
    console.error('[admin-auth-login-start] POST error:', error);
    return NextResponse.json(
      { ok: false, success: false, error: 'Failed to start admin login.' },
      { status: 500 }
    );
  }
}
