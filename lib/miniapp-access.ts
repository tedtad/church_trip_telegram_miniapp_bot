type RawSettings = Record<string, unknown>;

export type MiniAppRuntimeSettings = {
  appName: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  charityEnabled: boolean;
  discountEnabled: boolean;
  telegramChannelUrl: string;
  telegramChannelName: string;
  gnplEnabled: boolean;
  gnplRequireAdminApproval: boolean;
  gnplDefaultTermDays: number;
  gnplPenaltyEnabled: boolean;
  gnplPenaltyPercent: number;
  gnplPenaltyPeriodDays: number;
};

const SETTINGS_FIELDS = [
  'app_name',
  'maintenance_mode',
  'maintenance_message',
  'charity_enabled',
  'discount_enabled',
  'telegram_channel_url',
  'telegram_channel_name',
  'gnpl_enabled',
  'gnpl_require_admin_approval',
  'gnpl_default_term_days',
  'gnpl_penalty_enabled',
  'gnpl_penalty_percent',
  'gnpl_penalty_period_days',
];

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

async function loadRawMiniAppSettings(client: any): Promise<RawSettings> {
  let fields = [...SETTINGS_FIELDS];
  for (let attempt = 0; attempt < SETTINGS_FIELDS.length + 2; attempt += 1) {
    const { data, error } = await client
      .from('app_settings')
      .select(fields.join(', '))
      .eq('id', 'default')
      .maybeSingle();

    if (!error) return (data || {}) as RawSettings;

    const missing = detectMissingColumn(error);
    if (!missing || !fields.includes(missing)) break;
    fields = fields.filter((field) => field !== missing);
  }

  return {};
}

export function getMiniAppMaintenanceMessage(settings: Pick<MiniAppRuntimeSettings, 'maintenanceMessage'>) {
  const raw = String(settings.maintenanceMessage || '').trim();
  return raw || 'Mini App is temporarily under maintenance. Please try again shortly.';
}

export async function getMiniAppRuntimeSettings(client: any): Promise<MiniAppRuntimeSettings> {
  const row = await loadRawMiniAppSettings(client);
  return {
    appName: String(row.app_name || 'TicketHub').trim() || 'TicketHub',
    maintenanceMode: Boolean(row.maintenance_mode),
    maintenanceMessage: String(row.maintenance_message || '').trim(),
    charityEnabled: row.charity_enabled !== false,
    discountEnabled: row.discount_enabled !== false,
    telegramChannelUrl: String(row.telegram_channel_url || '').trim(),
    telegramChannelName: String(row.telegram_channel_name || '').trim(),
    gnplEnabled: Boolean(row.gnpl_enabled),
    gnplRequireAdminApproval: row.gnpl_require_admin_approval !== false,
    gnplDefaultTermDays: Math.max(1, Number(row.gnpl_default_term_days || 14)),
    gnplPenaltyEnabled: row.gnpl_penalty_enabled !== false,
    gnplPenaltyPercent: Math.max(0, Number(row.gnpl_penalty_percent || 0)),
    gnplPenaltyPeriodDays: Math.max(1, Number(row.gnpl_penalty_period_days || 7)),
  };
}
