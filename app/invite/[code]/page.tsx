import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeDiscountCode } from '@/lib/discount-vouchers';

export const dynamic = 'force-dynamic';

type InvitationRow = {
  id: string;
  invitation_code?: string | null;
  trip_id?: string | null;
  max_uses?: number | null;
  current_uses?: number | null;
  used_count?: number | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active?: boolean | null;
};

type MaybePromise<T> = T | Promise<T>;

type PageProps = {
  params: MaybePromise<{ code: string }>;
  searchParams?: MaybePromise<Record<string, string | string[] | undefined>>;
};

function getFirst(value: string | string[] | undefined) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

async function loadInvitationByCode(supabase: any, code: string): Promise<InvitationRow | null> {
  const selectCandidates = [
    'id, invitation_code, trip_id, max_uses, current_uses, used_count, valid_from, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, current_uses, used_count, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, current_uses, used_count, expires_at',
    'id, invitation_code, trip_id, max_uses, current_uses, used_count',
    'id, invitation_code, trip_id, max_uses, current_uses',
    'id, invitation_code, trip_id',
    'id, invitation_code',
  ];

  for (const selectClause of selectCandidates) {
    const { data, error } = await supabase
      .from('invitations')
      .select(selectClause)
      .ilike('invitation_code', code)
      .limit(1)
      .maybeSingle();

    if (!error) return (data || null) as InvitationRow | null;
    if (
      isMissingColumn(error, 'valid_from') ||
      isMissingColumn(error, 'expires_at') ||
      isMissingColumn(error, 'is_active') ||
      isMissingColumn(error, 'current_uses') ||
      isMissingColumn(error, 'used_count') ||
      isMissingColumn(error, 'max_uses') ||
      isMissingColumn(error, 'trip_id')
    ) {
      continue;
    }
  }

  return null;
}

function isInvitationUsable(invitation: InvitationRow | null) {
  if (!invitation?.id) return { ok: false, reason: 'Invitation code was not found.' };
  if (invitation.is_active === false) return { ok: false, reason: 'This invitation is inactive.' };

  const validFrom = invitation.valid_from ? new Date(invitation.valid_from) : null;
  if (validFrom && !Number.isNaN(validFrom.getTime()) && Date.now() < validFrom.getTime()) {
    return { ok: false, reason: 'This invitation is not active yet.' };
  }

  const expiresAt = invitation.expires_at ? new Date(invitation.expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
    return { ok: false, reason: 'This invitation has expired.' };
  }

  const maxUsesRaw = Number(invitation.max_uses);
  const maxUses = Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : null;
  const currentUsesRaw = Number(invitation.current_uses ?? invitation.used_count ?? 0);
  const currentUses = Number.isFinite(currentUsesRaw) ? Math.max(0, Math.floor(currentUsesRaw)) : 0;
  if (maxUses !== null && currentUses >= maxUses) {
    return { ok: false, reason: 'This invitation has reached its usage limit.' };
  }

  return { ok: true, reason: '' };
}

function buildRedirectUrl(args: {
  code: string;
  target: string;
  tripId: string;
  campaignId: string;
  initData: string;
  tgWebAppData: string;
}) {
  const params = new URLSearchParams();
  if (args.initData) params.set('initData', args.initData);
  if (args.tgWebAppData) params.set('tgWebAppData', args.tgWebAppData);

  if (args.target === 'charity') {
    params.set('invitationCode', args.code);
    if (args.campaignId) params.set('campaignId', args.campaignId);
    const query = params.toString();
    return `/miniapp/charity${query ? `?${query}` : ''}`;
  }

  params.set('discountCode', args.code);
  if (args.tripId) params.set('tripId', args.tripId);
  const query = params.toString();
  return `/miniapp${query ? `?${query}` : ''}`;
}

export default async function InviteCodePage({ params, searchParams = {} }: PageProps) {
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const code = normalizeDiscountCode(resolvedParams?.code || '');
  const target = getFirst(resolvedSearchParams.target).toLowerCase() === 'charity' ? 'charity' : 'booking';
  const campaignId = getFirst(resolvedSearchParams.campaignId || resolvedSearchParams.campaign);
  const initData = getFirst(resolvedSearchParams.initData);
  const tgWebAppData = getFirst(resolvedSearchParams.tgWebAppData);

  if (!code) {
    return (
      <main className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center">
        <div className="max-w-md w-full rounded-xl border border-slate-700 bg-slate-900/70 p-6 space-y-4">
          <h1 className="text-xl font-semibold">Invalid Invitation</h1>
          <p className="text-sm text-slate-300">The invitation code format is invalid.</p>
          <Link href="/miniapp" className="inline-block text-sm text-cyan-300 underline">
            Open Mini App
          </Link>
        </div>
      </main>
    );
  }

  const supabase = await createAdminClient();
  const invitation = await loadInvitationByCode(supabase, code);
  const status = isInvitationUsable(invitation);
  if (status.ok) {
    const redirectUrl = buildRedirectUrl({
      code,
      target,
      tripId: String(invitation?.trip_id || '').trim(),
      campaignId,
      initData,
      tgWebAppData,
    });
    redirect(redirectUrl);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center">
      <div className="max-w-md w-full rounded-xl border border-slate-700 bg-slate-900/70 p-6 space-y-4">
        <h1 className="text-xl font-semibold">Invitation Not Available</h1>
        <p className="text-sm text-slate-300">{status.reason}</p>
        <p className="text-sm text-slate-400">
          Code: <span className="font-mono">{code}</span>
        </p>
        <Link href="/miniapp" className="inline-block text-sm text-cyan-300 underline">
          Open Mini App
        </Link>
      </div>
    </main>
  );
}
