import {
  createTelegramChatInviteLink,
  getTelegramUserProfilePhotoUrl,
  sendTelegramDocument,
  sendTelegramMediaGroup,
  sendTelegramMessage,
  sendTelegramPhoto,
} from '@/lib/telegram';

type CharitySettings = {
  appName: string;
  channelChatId: string;
  channelUrl: string;
  groupChatId: string;
  groupUrl: string;
  autoPostCampaign: boolean;
  autoPostSummary: boolean;
  lastSummaryAt: string;
};

type CharityCampaignRow = {
  id: string;
  name?: string | null;
  cause?: string | null;
  description?: string | null;
  goal_amount?: number | null;
  collected_amount?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  telegram_channel_chat_id?: string | null;
  telegram_group_chat_id?: string | null;
  telegram_channel_url?: string | null;
  telegram_group_url?: string | null;
  telegram_announced_at?: string | null;
  telegram_final_summary_posted_at?: string | null;
};

function normalizeDate(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

function isActiveStatus(statusValue: string | null | undefined) {
  const status = String(statusValue || 'active')
    .trim()
    .toLowerCase();
  return !['completed', 'closed', 'cancelled', 'canceled', 'inactive', 'archived'].includes(status);
}

function isCampaignWithinSchedule(campaign: CharityCampaignRow) {
  if (!isActiveStatus(campaign.status)) return false;

  const now = Date.now();
  const startAt = normalizeDate(campaign.start_date);
  const endAt = normalizeDate(campaign.end_date);

  if (startAt && startAt.getTime() > now) return false;
  if (endAt && endAt.getTime() < now) return false;
  return true;
}

function isCampaignEnded(campaign: CharityCampaignRow) {
  if (!isActiveStatus(campaign.status)) return true;
  const endAt = normalizeDate(campaign.end_date);
  if (!endAt) return false;
  return endAt.getTime() < Date.now();
}

async function loadAppSettings(supabase: any): Promise<CharitySettings> {
  const { data } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle();
  const row = data || {};
  return {
    appName: String(row.app_name || 'TicketHub').trim(),
    channelChatId: String(row.charity_channel_chat_id || row.telegram_channel_chat_id || '').trim(),
    channelUrl: String(row.charity_channel_url || row.telegram_channel_url || '').trim(),
    groupChatId: String(row.charity_group_chat_id || '').trim(),
    groupUrl: String(row.charity_group_url || '').trim(),
    autoPostCampaign: row.charity_auto_post_new_campaign !== false,
    autoPostSummary: row.charity_auto_post_summary !== false,
    lastSummaryAt: String(row.charity_last_summary_post_at || '').trim(),
  };
}

async function loadCampaignRows(
  supabase: any
): Promise<{ campaigns: CharityCampaignRow[]; supportsFinalSummaryAt: boolean }> {
  const selectCandidates = [
    'id, name, cause, description, goal_amount, collected_amount, start_date, end_date, status, telegram_channel_chat_id, telegram_group_chat_id, telegram_channel_url, telegram_group_url, telegram_announced_at, telegram_final_summary_posted_at',
    'id, name, cause, description, goal_amount, collected_amount, start_date, end_date, status, telegram_channel_chat_id, telegram_group_chat_id, telegram_channel_url, telegram_group_url, telegram_announced_at',
    'id, name, cause, description, goal_amount, collected_amount, start_date, end_date, status, telegram_channel_chat_id, telegram_group_chat_id, telegram_channel_url, telegram_group_url',
    'id, name, cause, description, goal_amount, collected_amount, start_date, end_date, status',
  ];

  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from('charity_campaigns')
      .select(selectClause)
      .order('created_at', { ascending: false })
      .limit(300);
    if (!result.error) {
      return {
        campaigns: (result.data || []) as CharityCampaignRow[],
        supportsFinalSummaryAt: selectClause.includes('telegram_final_summary_posted_at'),
      };
    }
  }

  return { campaigns: [], supportsFinalSummaryAt: false };
}

async function upsertAppSettingsFields(supabase: any, input: Record<string, unknown>) {
  let payload: Record<string, unknown> = {
    id: 'default',
    ...input,
    updated_at: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabase.from('app_settings').upsert(payload, { onConflict: 'id' });
    if (!result.error) return;

    const missing = detectMissingColumn(result.error);
    if (!missing || !(missing in payload)) return;
    delete payload[missing];
  }
}

async function updateCampaignFields(supabase: any, campaignId: string, input: Record<string, unknown>) {
  let payload = { ...input };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabase.from('charity_campaigns').update(payload).eq('id', campaignId);
    if (!result.error) return;

    const missing = detectMissingColumn(result.error);
    if (!missing || !(missing in payload)) return;
    delete (payload as any)[missing];
  }
}

function isImageReceipt(pathOrUrl: string) {
  const clean = String(pathOrUrl || '').split('?')[0].toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].some((ext) => clean.endsWith(ext));
}

async function resolveReceiptAccessUrl(supabase: any, pathOrUrl: string) {
  const value = String(pathOrUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;

  const bucketCandidates = ['receipts', 'app-files'];
  for (const bucket of bucketCandidates) {
    const result = await supabase.storage.from(bucket).createSignedUrl(value, 60 * 60);
    const signed = String(result.data?.signedUrl || '').trim();
    if (!result.error && signed) return signed;
  }
  return '';
}

function formatCurrency(amount: number) {
  return Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function aggregateTopContributors(rows: Array<{ donor_name?: string | null; donation_amount?: number | null }>, limit = 5) {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const donor = String(row.donor_name || 'Anonymous').trim() || 'Anonymous';
    const amount = Number(row.donation_amount || 0);
    grouped.set(donor, (grouped.get(donor) || 0) + amount);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

async function getApprovedDonationsSince(supabase: any, sinceIso: string, campaignIds?: string[]) {
  let query = supabase
    .from('charity_donations')
    .select('donor_name, donation_amount, created_at, campaign_id')
    .eq('approval_status', 'approved')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (campaignIds && campaignIds.length > 0) {
    query = query.in('campaign_id', campaignIds);
  }

  const { data } = await query;
  return (data || []) as Array<{ donor_name?: string | null; donation_amount?: number | null; created_at?: string; campaign_id?: string }>;
}

async function getAidSummary(supabase: any, campaignIds?: string[]) {
  let query = supabase
    .from('charity_donations')
    .select('donation_amount, approval_status')
    .eq('approval_status', 'approved');
  if (campaignIds && campaignIds.length > 0) {
    query = query.in('campaign_id', campaignIds);
  }

  const { data } = await query;
  const totalAid = (data || []).reduce((sum: number, row: any) => sum + Number(row?.donation_amount || 0), 0);
  const approvedCount = (data || []).length;
  return { totalAid, approvedCount };
}

export async function postCharityCampaignAnnouncement(
  supabase: any,
  campaign: {
    id: string;
    name?: string | null;
    cause?: string | null;
    description?: string | null;
    goal_amount?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    telegram_channel_chat_id?: string | null;
    telegram_group_chat_id?: string | null;
    telegram_channel_url?: string | null;
    telegram_group_url?: string | null;
  }
) {
  const settings = await loadAppSettings(supabase);
  if (!settings.autoPostCampaign) return { posted: false };
  if (!isCampaignWithinSchedule(campaign as CharityCampaignRow)) return { posted: false };

  const channelChatId = String(campaign.telegram_channel_chat_id || settings.channelChatId || '').trim();
  const groupChatId = String(campaign.telegram_group_chat_id || '').trim();
  let groupUrl = String(campaign.telegram_group_url || '').trim();
  let channelUrl = String(campaign.telegram_channel_url || settings.channelUrl || '').trim();

  if (channelChatId && !channelUrl) {
    const invite = await createTelegramChatInviteLink(channelChatId, `Charity ${campaign.name || campaign.id}`);
    if (invite) channelUrl = invite;
  }
  if (groupChatId && !groupUrl) {
    const invite = await createTelegramChatInviteLink(groupChatId, `Charity ${campaign.name || campaign.id}`);
    if (invite) groupUrl = invite;
  }

  const message = [
    `New charity campaign on ${settings.appName}`,
    '',
    `Campaign: ${String(campaign.name || 'Campaign')}`,
    `Cause: ${String(campaign.cause || 'N/A')}`,
    campaign.description ? `Details: ${String(campaign.description)}` : '',
    `Goal: ETB ${formatCurrency(Number(campaign.goal_amount || 0))}`,
    campaign.start_date ? `Start: ${new Date(campaign.start_date).toLocaleString('en-US')}` : '',
    campaign.end_date ? `End: ${new Date(campaign.end_date).toLocaleString('en-US')}` : '',
    channelUrl ? `Channel: ${channelUrl}` : '',
    groupUrl ? `Group: ${groupUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let posted = false;
  if (channelChatId) {
    posted = Boolean(await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true })) || posted;
  }
  if (groupChatId) {
    posted = Boolean(await sendTelegramMessage(groupChatId, message, { disable_web_page_preview: true })) || posted;
  }

  if (posted) {
    await updateCampaignFields(supabase, campaign.id, {
        telegram_announced_at: new Date().toISOString(),
        telegram_channel_url: channelUrl || null,
        telegram_group_url: groupUrl || null,
      });
  }

  return { posted, channelUrl, groupUrl };
}

export async function postCharityRankingSummary(supabase: any, force = false) {
  const settings = await loadAppSettings(supabase);
  if (!settings.autoPostSummary || !settings.channelChatId) {
    return { posted: false };
  }

  const { campaigns } = await loadCampaignRows(supabase);
  const activeCampaigns = campaigns.filter(isCampaignWithinSchedule);
  const activeCampaignIds = activeCampaigns.map((campaign) => String(campaign.id || '').trim()).filter(Boolean);
  if (!activeCampaignIds.length) {
    return { posted: false };
  }

  const lastSummaryDate = normalizeDate(settings.lastSummaryAt);
  if (!force && lastSummaryDate && Date.now() - lastSummaryDate.getTime() < 24 * 60 * 60 * 1000) {
    return { posted: false };
  }

  const now = Date.now();
  const weeklyRows = await getApprovedDonationsSince(
    supabase,
    new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    activeCampaignIds
  );
  const monthlyRows = await getApprovedDonationsSince(
    supabase,
    new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    activeCampaignIds
  );
  const yearlyRows = await getApprovedDonationsSince(
    supabase,
    new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(),
    activeCampaignIds
  );
  const aid = await getAidSummary(supabase, activeCampaignIds);

  const topWeekly = aggregateTopContributors(weeklyRows, 5);
  const topMonthly = aggregateTopContributors(monthlyRows, 5);
  const topYearly = aggregateTopContributors(yearlyRows, 5);

  const formatTop = (items: Array<[string, number]>) =>
    items.length
      ? items.map(([name, amount], idx) => `${idx + 1}. ${name} - ETB ${formatCurrency(amount)}`).join('\n')
      : 'No contributions yet.';

  const message = [
    `${settings.appName} charity rankings and aid summary`,
    '',
    `Active campaigns: ${activeCampaignIds.length}`,
    `Total approved aid: ETB ${formatCurrency(aid.totalAid)} (${aid.approvedCount} donation(s))`,
    '',
    'Weekly top contributors:',
    formatTop(topWeekly),
    '',
    'Monthly top contributors:',
    formatTop(topMonthly),
    '',
    'Yearly top contributors:',
    formatTop(topYearly),
  ].join('\n');

  const sent = await sendTelegramMessage(settings.channelChatId, message, { disable_web_page_preview: true });
  if (!sent) return { posted: false };

  await upsertAppSettingsFields(supabase, { charity_last_summary_post_at: new Date().toISOString() });
  return { posted: true };
}

export async function postCharityFinalCampaignSummaries(supabase: any) {
  const settings = await loadAppSettings(supabase);
  if (!settings.autoPostSummary) return { posted: 0 };
  const { campaigns, supportsFinalSummaryAt } = await loadCampaignRows(supabase);
  if (!supportsFinalSummaryAt) return { posted: 0 };
  const ended = campaigns.filter((campaign) => {
    const alreadyPosted = Boolean(String(campaign.telegram_final_summary_posted_at || '').trim());
    return isCampaignEnded(campaign) && !alreadyPosted;
  });

  let posted = 0;
  for (const campaign of ended.slice(0, 20)) {
    const campaignId = String(campaign.id || '').trim();
    if (!campaignId) continue;

    const { data: donations } = await supabase
      .from('charity_donations')
      .select('donor_name, donation_amount, approval_status')
      .eq('campaign_id', campaignId)
      .eq('approval_status', 'approved');

    const donationRows = (donations || []) as Array<{
      donor_name?: string | null;
      donation_amount?: number | null;
      approval_status?: string | null;
    }>;
    const donorCount = new Set(
      donationRows.map((row) => String(row.donor_name || 'Anonymous').trim() || 'Anonymous')
    ).size;
    const totalAid = donationRows.reduce((sum, row) => sum + Number(row.donation_amount || 0), 0);
    const topContributors = aggregateTopContributors(donationRows, 3)
      .map(([name, amount], idx) => `${idx + 1}. ${name} - ETB ${formatCurrency(amount)}`)
      .join('\n');

    const message = [
      `${settings.appName} campaign final summary`,
      '',
      `Campaign: ${String(campaign.name || 'Campaign')}`,
      `Cause: ${String(campaign.cause || 'N/A')}`,
      `Approved donations: ${donationRows.length}`,
      `Unique donors: ${donorCount}`,
      `Total aid: ETB ${formatCurrency(totalAid)}`,
      topContributors ? 'Top contributors:' : '',
      topContributors,
      '',
      'Thank you to everyone who contributed.',
    ]
      .filter(Boolean)
      .join('\n');

    const targetChannel = String(campaign.telegram_channel_chat_id || settings.channelChatId || '').trim();
    const targetGroup = String(campaign.telegram_group_chat_id || '').trim();

    let sent = false;
    if (targetChannel) {
      sent = Boolean(await sendTelegramMessage(targetChannel, message, { disable_web_page_preview: true })) || sent;
    }
    if (targetGroup) {
      sent = Boolean(await sendTelegramMessage(targetGroup, message, { disable_web_page_preview: true })) || sent;
    }
    if (!sent) continue;

    posted += 1;
    await updateCampaignFields(supabase, campaignId, {
      telegram_final_summary_posted_at: new Date().toISOString(),
    });
  }

  return { posted };
}

export async function sendCharityDonationThankYou(
  supabase: any,
  donationId: string,
  mode: 'submitted' | 'approved' = 'submitted'
) {
  const { data: donation } = await supabase
    .from('charity_donations')
    .select('id, campaign_id, telegram_user_id, donor_name, donor_phone, donation_amount, reference_number, receipt_file_url, receipt_file_name, approval_status, created_at')
    .eq('id', donationId)
    .maybeSingle();
  if (!donation) return { sent: false };

  const { data: campaign } = await supabase
    .from('charity_campaigns')
    .select('id, name, cause, telegram_channel_chat_id, telegram_group_chat_id, telegram_channel_url, telegram_group_url')
    .eq('id', donation.campaign_id)
    .maybeSingle();
  const settings = await loadAppSettings(supabase);

  const donorChatId = String(donation.telegram_user_id || '').trim();
  const channelChatId = String(campaign?.telegram_channel_chat_id || settings.channelChatId || '').trim();
  const groupChatId = String(campaign?.telegram_group_chat_id || '').trim();

  const profilePhotoUrl = await getTelegramUserProfilePhotoUrl(donation.telegram_user_id);
  const receiptUrl = await resolveReceiptAccessUrl(supabase, String(donation.receipt_file_url || ''));
  const receiptIsImage = isImageReceipt(receiptUrl || donation.receipt_file_name || donation.receipt_file_url || '');

  const caption = [
    mode === 'approved' ? 'Donation approved. Thank you for your support.' : 'Thank you for your donation submission.',
    `Campaign: ${String(campaign?.name || 'Campaign')}`,
    `Cause: ${String(campaign?.cause || 'N/A')}`,
    `Donor: ${String(donation.donor_name || 'Donor')}`,
    `Amount: ETB ${formatCurrency(Number(donation.donation_amount || 0))}`,
    `Reference: ${String(donation.reference_number || '-')}`,
    mode === 'approved' ? 'Status: Approved' : 'Status: Pending review',
  ].join('\n');

  const sendBundleToChat = async (chatId: string) => {
    if (!chatId) return false;
    if (profilePhotoUrl && receiptUrl && receiptIsImage) {
      const media = [
        { type: 'photo', media: profilePhotoUrl, caption },
        { type: 'photo', media: receiptUrl },
      ];
      const album = await sendTelegramMediaGroup(chatId, media);
      if (album) return true;
    }

    let sentAny = false;
    const baseMsg = await sendTelegramMessage(chatId, caption);
    sentAny = Boolean(baseMsg) || sentAny;
    if (profilePhotoUrl) {
      const sentPhoto = await sendTelegramPhoto(chatId, profilePhotoUrl, 'Donor profile');
      sentAny = Boolean(sentPhoto) || sentAny;
    }
    if (receiptUrl) {
      if (receiptIsImage) {
        const sentReceipt = await sendTelegramPhoto(chatId, receiptUrl, 'Donation receipt');
        sentAny = Boolean(sentReceipt) || sentAny;
      } else {
        const sentReceiptDoc = await sendTelegramDocument(chatId, receiptUrl, 'Donation receipt');
        sentAny = Boolean(sentReceiptDoc) || sentAny;
      }
    }
    return sentAny;
  };

  let sent = false;
  if (donorChatId) sent = (await sendBundleToChat(donorChatId)) || sent;
  if (mode === 'approved' && channelChatId) sent = (await sendBundleToChat(channelChatId)) || sent;
  if (mode === 'approved' && groupChatId) sent = (await sendBundleToChat(groupChatId)) || sent;

  if (sent && mode === 'approved') {
    await supabase
      .from('charity_donations')
      .update({
        thank_you_card_generated: true,
        thank_you_card_sent_at: new Date().toISOString(),
      })
      .eq('id', donationId);
  }
  return { sent };
}
