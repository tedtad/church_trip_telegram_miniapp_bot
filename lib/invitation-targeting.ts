export function isMissingRelation(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('relation') &&
    message.includes(relationName.toLowerCase()) &&
    message.includes('does not exist')
  );
}

export type EnsureExistingTelegramUsersResult =
  | { ok: true; ids: number[] }
  | { ok: false; ids: number[]; missing: number[]; error: string };

export type ReplaceInvitationTargetsResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string; missingSchema?: boolean };

export type InvitationTargetEligibilityResult =
  | { ok: true; hasTargets: boolean; schemaMissing?: boolean }
  | { ok: false; hasTargets: boolean; error: string };

function toSafeTelegramUserId(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.floor(numeric);
}

export function parseTargetTelegramUserIds(input: unknown) {
  const out = new Set<number>();
  const push = (value: unknown) => {
    const text = String(value || '').trim();
    if (!text) return;
    const numeric = toSafeTelegramUserId(text.replace(/[^\d-]/g, ''));
    if (numeric > 0) out.add(numeric);
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      push(item);
    }
  } else if (typeof input === 'string') {
    for (const token of input.split(/[\s,;\n\r\t]+/)) {
      push(token);
    }
  } else if (input !== null && input !== undefined) {
    push(input);
  }

  return [...out];
}

export async function ensureExistingTelegramUsers(
  supabase: any,
  ids: number[]
): Promise<EnsureExistingTelegramUsersResult> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!unique.length) {
    return { ok: true as const, ids: [] as number[] };
  }

  const { data, error } = await supabase.from('telegram_users').select('id').in('id', unique);
  if (error) throw error;
  const found = new Set<number>(((data || []) as Array<{ id: number }>).map((row) => Number(row.id)));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length) {
    return {
      ok: false as const,
      ids: unique,
      missing,
      error: `Target users not found: ${missing.join(', ')}`,
    };
  }

  return { ok: true as const, ids: unique };
}

export async function replaceInvitationTargets(params: {
  supabase: any;
  invitationId: string;
  telegramUserIds: number[];
}): Promise<ReplaceInvitationTargetsResult> {
  const invitationId = String(params.invitationId || '').trim();
  if (!invitationId) {
    return { ok: false as const, error: 'Invitation id is required' };
  }

  const userIds = [...new Set((params.telegramUserIds || []).filter((id) => Number.isFinite(id) && id > 0))];

  const clearResult = await params.supabase
    .from('invitation_target_users')
    .delete()
    .eq('invitation_id', invitationId);
  if (clearResult.error) {
    if (isMissingRelation(clearResult.error, 'invitation_target_users')) {
      return { ok: false as const, missingSchema: true as const, error: 'invitation_target_users table is missing' };
    }
    throw clearResult.error;
  }

  if (!userIds.length) {
    return { ok: true as const, inserted: 0 };
  }

  const insertResult = await params.supabase.from('invitation_target_users').insert(
    userIds.map((telegramUserId) => ({
      invitation_id: invitationId,
      telegram_user_id: telegramUserId,
    }))
  );
  if (insertResult.error) {
    if (isMissingRelation(insertResult.error, 'invitation_target_users')) {
      return { ok: false as const, missingSchema: true as const, error: 'invitation_target_users table is missing' };
    }
    throw insertResult.error;
  }

  return { ok: true as const, inserted: userIds.length };
}

export async function checkInvitationTargetEligibility(params: {
  supabase: any;
  invitationId: string;
  telegramUserId?: number | null;
}): Promise<InvitationTargetEligibilityResult> {
  const invitationId = String(params.invitationId || '').trim();
  if (!invitationId) return { ok: false as const, error: 'Invitation id is required', hasTargets: false };

  const anyTargetsResult = await params.supabase
    .from('invitation_target_users')
    .select('telegram_user_id')
    .eq('invitation_id', invitationId)
    .limit(1);
  if (anyTargetsResult.error) {
    if (isMissingRelation(anyTargetsResult.error, 'invitation_target_users')) {
      return { ok: true as const, hasTargets: false, schemaMissing: true as const };
    }
    throw anyTargetsResult.error;
  }

  const hasTargets = ((anyTargetsResult.data || []) as Array<{ telegram_user_id: number }>).length > 0;
  if (!hasTargets) {
    return { ok: true as const, hasTargets: false };
  }

  const telegramUserId = toSafeTelegramUserId(params.telegramUserId);
  if (telegramUserId <= 0) {
    return {
      ok: false as const,
      hasTargets: true,
      error: 'This invitation is restricted to specific users',
    };
  }

  const matchResult = await params.supabase
    .from('invitation_target_users')
    .select('invitation_id')
    .eq('invitation_id', invitationId)
    .eq('telegram_user_id', telegramUserId)
    .limit(1);
  if (matchResult.error) {
    if (isMissingRelation(matchResult.error, 'invitation_target_users')) {
      return { ok: true as const, hasTargets: false, schemaMissing: true as const };
    }
    throw matchResult.error;
  }

  const allowed = ((matchResult.data || []) as Array<{ invitation_id: string }>).length > 0;
  if (!allowed) {
    return {
      ok: false as const,
      hasTargets: true,
      error: 'Invitation is not assigned to this Telegram account',
    };
  }

  return { ok: true as const, hasTargets: true };
}
