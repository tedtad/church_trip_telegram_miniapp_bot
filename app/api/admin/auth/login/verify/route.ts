import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyOtpCodeHash } from '@/lib/admin-2fa';
import { createAdminSessionToken, setAdminSessionCookie } from '@/lib/admin-session';
import { loadAdminByEmailOrUserId } from '@/lib/admin-auth-server';

type ChallengeRow = {
  id: string;
  admin_id: string;
  otp_hash: string;
  expires_at: string;
  attempts?: number | null;
  max_attempts?: number | null;
  status?: string | null;
};

const OTP_MAX_ATTEMPTS = 3;

function isMissingOtpTable(error: unknown) {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    (message.includes('relation') && message.includes('admin_otp_challenges') && message.includes('does not exist')) ||
    message.includes('admin_otp_challenges')
  );
}

function nowIso() {
  return new Date().toISOString();
}

async function updateChallengeWithFallback(supabase: any, challengeId: string, payload: Record<string, unknown>) {
  const first = await supabase.from('admin_otp_challenges').update(payload).eq('id', challengeId);
  if (!first.error) return;
  if (!String(first.error?.message || '').toLowerCase().includes('verified_at')) throw first.error;
  const fallback = { ...payload };
  delete fallback.verified_at;
  const second = await supabase.from('admin_otp_challenges').update(fallback).eq('id', challengeId);
  if (second.error) throw second.error;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const challengeId = String(body?.challengeId || '').trim();
    const otp = String(body?.otp || '').trim();

    if (!challengeId || !otp) {
      return NextResponse.json(
        { ok: false, success: false, error: 'challengeId and otp are required.' },
        { status: 400 }
      );
    }

    const supabase = await createAdminClient();

    const challengeQuery = await supabase
      .from('admin_otp_challenges')
      .select('id, admin_id, otp_hash, expires_at, attempts, max_attempts, status')
      .eq('id', challengeId)
      .maybeSingle();

    if (challengeQuery.error) {
      if (isMissingOtpTable(challengeQuery.error)) {
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
      throw challengeQuery.error;
    }

    const challenge = challengeQuery.data as ChallengeRow | null;
    if (!challenge) {
      return NextResponse.json({ ok: false, success: false, error: 'Invalid OTP challenge.' }, { status: 400 });
    }

    const status = String(challenge.status || 'pending').toLowerCase();
    const attempts = Number(challenge.attempts || 0);
    const maxAttempts = Math.max(1, Number(challenge.max_attempts || OTP_MAX_ATTEMPTS));

    if (status !== 'pending') {
      return NextResponse.json({ ok: false, success: false, error: 'OTP challenge is not pending.' }, { status: 400 });
    }

    if (attempts >= maxAttempts) {
      await supabase.from('admin_otp_challenges').update({ status: 'failed' }).eq('id', challengeId);
      return NextResponse.json({ ok: false, success: false, error: 'Too many OTP attempts.' }, { status: 429 });
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await supabase.from('admin_otp_challenges').update({ status: 'expired' }).eq('id', challengeId);
      return NextResponse.json({ ok: false, success: false, error: 'OTP challenge expired.' }, { status: 400 });
    }

    const valid = verifyOtpCodeHash(challengeId, otp, String(challenge.otp_hash || ''));
    if (!valid) {
      const nextAttempts = attempts + 1;
      const nextStatus = nextAttempts >= maxAttempts ? 'failed' : 'pending';
      await supabase
        .from('admin_otp_challenges')
        .update({ attempts: nextAttempts, status: nextStatus })
        .eq('id', challengeId);

      return NextResponse.json({ ok: false, success: false, error: 'Invalid OTP code.' }, { status: 401 });
    }

    const admin = await loadAdminByEmailOrUserId(supabase, '', String(challenge.admin_id));
    if (!admin || admin.is_active === false) {
      await updateChallengeWithFallback(supabase, challengeId, { status: 'failed', verified_at: null });

      return NextResponse.json(
        { ok: false, success: false, error: 'Admin account is inactive or missing.' },
        { status: 403 }
      );
    }

    await updateChallengeWithFallback(supabase, challengeId, {
      status: 'verified',
      verified_at: nowIso(),
      attempts: attempts + 1,
    });

    await supabase
      .from('admin_otp_challenges')
      .update({ status: 'expired' })
      .eq('admin_id', String(admin.id))
      .eq('status', 'pending');

    const session = createAdminSessionToken({
      adminId: String(admin.id),
      email: String(admin.email),
      role: String(admin.role || 'admin'),
      name: String(admin.name || ''),
    });

    await supabase
      .from('admin_users')
      .update({ last_login: nowIso() })
      .eq('id', String(admin.id));

    const response = NextResponse.json({
      ok: true,
      success: true,
      admin: {
        id: String(admin.id),
        email: String(admin.email),
        name: String(admin.name || admin.email),
        role: String(admin.role || 'admin'),
      },
      expiresAt: session.expiresAt,
    });

    setAdminSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    console.error('[admin-auth-login-verify] POST error:', error);
    return NextResponse.json(
      { ok: false, success: false, error: 'Failed to verify OTP.' },
      { status: 500 }
    );
  }
}
