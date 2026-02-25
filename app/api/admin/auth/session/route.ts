import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  clearAdminSessionCookie,
  getAdminSessionTokenFromRequest,
  verifyAdminSessionToken,
} from '@/lib/admin-session';
import { loadAdminByEmailOrUserId } from '@/lib/admin-auth-server';

export async function GET(request: NextRequest) {
  try {
    const token = getAdminSessionTokenFromRequest(request);
    const claims = verifyAdminSessionToken(token);
    if (!claims) {
      const response = NextResponse.json(
        { ok: false, success: false, error: 'Admin session is missing or expired.' },
        { status: 401 }
      );
      clearAdminSessionCookie(response);
      return response;
    }

    const supabase = await createAdminClient();
    const admin = await loadAdminByEmailOrUserId(supabase, claims.email, claims.adminId);

    if (!admin || admin.is_active === false) {
      const response = NextResponse.json(
        { ok: false, success: false, error: 'Admin account is inactive or not found.' },
        { status: 403 }
      );
      clearAdminSessionCookie(response);
      return response;
    }

    return NextResponse.json({
      ok: true,
      success: true,
      admin: {
        id: String(admin.id),
        email: String(admin.email),
        name: String(admin.name || admin.email),
        role: String(admin.role || 'admin'),
      },
      expiresAt: claims.exp * 1000,
    });
  } catch (error) {
    console.error('[admin-auth-session] GET error:', error);
    return NextResponse.json(
      { ok: false, success: false, error: 'Failed to load admin session.' },
      { status: 500 }
    );
  }
}
