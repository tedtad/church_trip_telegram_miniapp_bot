function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

async function findTripConflictByField(
  supabase: any,
  field: 'telegram_group_url' | 'telegram_group_chat_id',
  value: string,
  excludeTripId?: string
) {
  let query = supabase.from('trips').select('id, name').eq(field, value).limit(1);
  if (excludeTripId) query = query.neq('id', excludeTripId);
  const result = await query;
  if (!result.error && (result.data || []).length) {
    const hit = result.data[0] as any;
    return `Trip group is already used by trip "${String(hit?.name || hit?.id || 'unknown')}".`;
  }

  if (result.error && !detectMissingColumn(result.error)) {
    console.error('[group-policy] trip conflict check error:', result.error);
  }
  return null;
}

async function findCampaignConflictByField(
  supabase: any,
  field: 'telegram_group_url' | 'telegram_group_chat_id',
  value: string,
  excludeCampaignId?: string
) {
  let query = supabase.from('charity_campaigns').select('id, name').eq(field, value).limit(1);
  if (excludeCampaignId) query = query.neq('id', excludeCampaignId);
  const result = await query;
  if (!result.error && (result.data || []).length) {
    const hit = result.data[0] as any;
    return `Group is already used by charity campaign "${String(hit?.name || hit?.id || 'unknown')}".`;
  }

  if (result.error && !detectMissingColumn(result.error)) {
    console.error('[group-policy] campaign conflict check error:', result.error);
  }
  return null;
}

export async function validateTelegramGroupNotReused(
  supabase: any,
  input: {
    groupUrl?: string | null;
    groupChatId?: string | null;
    excludeTripId?: string;
    excludeCampaignId?: string;
  }
) {
  const groupUrl = String(input.groupUrl || '').trim();
  const groupChatId = String(input.groupChatId || '').trim();

  if (groupUrl) {
    const tripHit = await findTripConflictByField(supabase, 'telegram_group_url', groupUrl, input.excludeTripId);
    if (tripHit) return tripHit;

    const campaignHit = await findCampaignConflictByField(
      supabase,
      'telegram_group_url',
      groupUrl,
      input.excludeCampaignId
    );
    if (campaignHit) return campaignHit;
  }

  if (groupChatId) {
    const tripHit = await findTripConflictByField(
      supabase,
      'telegram_group_chat_id',
      groupChatId,
      input.excludeTripId
    );
    if (tripHit) return tripHit;

    const campaignHit = await findCampaignConflictByField(
      supabase,
      'telegram_group_chat_id',
      groupChatId,
      input.excludeCampaignId
    );
    if (campaignHit) return campaignHit;
  }

  return null;
}
