'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, AlertCircle, CheckCircle, Loader } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  cause: string;
  description: string;
  goal_amount: number;
  collected_amount: number;
  status: string;
  telegram_channel_url?: string | null;
  telegram_group_url?: string | null;
}

interface DonationStep {
  step: 1 | 2;
  campaignId?: string;
  campaignName?: string;
  donorName: string;
  donorPhone: string;
  donationAmount: string;
  referenceNumber: string;
  receipt?: File;
}

type Lang = 'en' | 'am';

const COPY: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Make a Donation',
    selectCampaign: 'Select a Charity Campaign',
    noCampaigns: 'No active campaigns available.',
    campaignGoal: 'Goal',
    campaignCollected: 'Collected',
    selectThisCampaign: 'Select',
    donorInfo: 'Donor Information',
    fullName: 'Full Name',
    phone: 'Phone Number',
    donationAmount: 'Donation Amount (ETB)',
    uploadReceipt: 'Upload Receipt',
    receiptInstruction: 'Upload receipt (JPG, PNG, WEBP, or PDF)',
    referenceNumber: 'Payment Reference Number',
    donate: 'Submit Donation',
    back: 'Back',
    submitted: 'Donation submitted successfully. Thank you.',
    errorCampaignRequired: 'Please select a campaign.',
    errorAmountRequired: 'Donation amount must be greater than zero.',
    errorReferenceRequired: 'Reference number is required.',
    openChannel: 'Open Campaign Channel',
    openGroup: 'Open Campaign Group',
    backHome: 'Back to Home',
    language: 'Language',
  },
  am: {
    title: 'ልገሳ ያድርጉ',
    selectCampaign: 'የበጎ አድራጎት ዘመቻ ይምረጡ',
    noCampaigns: 'አሁን የተከፈተ ዘመቻ የለም።',
    campaignGoal: 'ግብ',
    campaignCollected: 'የተሰበሰበ',
    selectThisCampaign: 'ይምረጡ',
    donorInfo: 'የለጋሽ መረጃ',
    fullName: 'ሙሉ ስም',
    phone: 'ስልክ ቁጥር',
    donationAmount: 'የልገሳ መጠን (ብር)',
    uploadReceipt: 'ደረሰኝ ያስገቡ',
    receiptInstruction: 'ደረሰኝ ያስገቡ (JPG, PNG, WEBP ወይም PDF)',
    referenceNumber: 'የክፍያ ማጣቀሻ ቁጥር',
    donate: 'ልገሳ ይላኩ',
    back: 'ተመለስ',
    submitted: 'ልገሳዎ በተሳካ ሁኔታ ተልኳል። እናመሰግናለን።',
    errorCampaignRequired: 'እባክዎ ዘመቻ ይምረጡ።',
    errorAmountRequired: 'የልገሳ መጠን ከዜሮ በላይ መሆን አለበት።',
    errorReferenceRequired: 'የክፍያ ማጣቀሻ ቁጥር ያስፈልጋል።',
    openChannel: 'የዘመቻ ቻናል ክፈት',
    openGroup: 'የዘመቻ ግሩፕ ክፈት',
    backHome: 'ወደ መነሻ ተመለስ',
    language: 'ቋንቋ',
  },
};

function resolveInitDataFromPage() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get('initData') || params.get('tgWebAppData') || '').trim();
  const fromTg = String(window.Telegram?.WebApp?.initData || '').trim();
  return fromTg || fromQuery;
}

function normalizeDiscountCodeInput(value: string) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

export default function CharityPage() {
  const [lang, setLang] = useState<Lang>('am');
  const [initData, setInitData] = useState('');
  const [appName, setAppName] = useState('TicketHub');
  const [invitationCode, setInvitationCode] = useState('');
  const [campaignHintId, setCampaignHintId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessMessage, setAccessMessage] = useState('');
  const [donation, setDonation] = useState<DonationStep>({
    step: 1,
    donorName: '',
    donorPhone: '',
    donationAmount: '',
    referenceNumber: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const t = useCallback((key: string) => COPY[lang]?.[key] || COPY.en[key] || key, [lang]);

  const apiFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      if (initData) headers.set('x-telegram-init-data', initData);
      return fetch(input, { ...init, headers, cache: 'no-store' });
    },
    [initData]
  );

  const loadCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/charity/campaigns');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to load campaigns');
      }
      setCampaigns((data.campaigns || []) as Campaign[]);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const ensureMiniAppCharityAccess = useCallback(async (resolvedInitData: string) => {
    try {
      const response = await fetch('/api/miniapp/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(resolvedInitData ? { 'x-telegram-init-data': resolvedInitData } : {}),
        },
        body: JSON.stringify({ initData: resolvedInitData }),
        cache: 'no-store',
      });
      const json = await response.json().catch(() => ({}));
      const sessionSettings = (json?.appSettings || {}) as Record<string, unknown>;
      setAppName(String(sessionSettings?.appName || 'TicketHub'));

      if (!response.ok || !json?.ok) {
        if (String(json?.error || '') === 'MINIAPP_MAINTENANCE') {
          setAccessMessage(String(json?.message || 'Mini App is under maintenance.'));
          return false;
        }
        setAccessMessage(String(json?.error || json?.message || 'Mini App session is not available.'));
        return false;
      }

      if (sessionSettings?.charityEnabled === false) {
        setAccessMessage('Charity module is currently disabled.');
        return false;
      }

      return true;
    } catch {
      setAccessMessage('Failed to validate mini app session.');
      return false;
    }
  }, []);

  useEffect(() => {
    const resolved = resolveInitDataFromPage();
    setInitData(resolved);
    const params = new URLSearchParams(window.location.search);
    setInvitationCode(
      normalizeDiscountCodeInput(
        String(params.get('invitationCode') || params.get('discountCode') || params.get('inviteCode') || '')
      )
    );
    setCampaignHintId(String(params.get('campaignId') || params.get('campaign') || '').trim());

    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser) {
      const fullName = [String(tgUser.first_name || ''), String(tgUser.last_name || '')].filter(Boolean).join(' ').trim();
      if (fullName) {
        setDonation((prev) => ({ ...prev, donorName: fullName }));
      }
      setLang(String(tgUser.language_code || '').toLowerCase() === 'en' ? 'en' : 'am');
    }

    (async () => {
      const allowed = await ensureMiniAppCharityAccess(resolved);
      if (!allowed) {
        setLoading(false);
        return;
      }
      await loadCampaigns();
    })();
  }, [ensureMiniAppCharityAccess, loadCampaigns]);

  useEffect(() => {
    if (!campaignHintId || campaigns.length === 0) return;
    const matched = campaigns.find((campaign) => campaign.id === campaignHintId);
    if (!matched) return;
    setDonation((prev) => ({
      ...prev,
      step: 2,
      campaignId: matched.id,
      campaignName: matched.name,
    }));
    setCampaignHintId('');
  }, [campaignHintId, campaigns]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      if (!donation.campaignId) throw new Error(t('errorCampaignRequired'));
      if (!Number.isFinite(Number(donation.donationAmount)) || Number(donation.donationAmount) <= 0) {
        throw new Error(t('errorAmountRequired'));
      }
      if (!String(donation.referenceNumber || '').trim()) {
        throw new Error(t('errorReferenceRequired'));
      }

      const formData = new FormData();
      formData.append('campaignId', donation.campaignId || '');
      formData.append('donorName', donation.donorName);
      formData.append('donorPhone', donation.donorPhone);
      formData.append('donationAmount', donation.donationAmount);
      formData.append('referenceNumber', donation.referenceNumber);
      if (initData) formData.append('initData', initData);
      if (invitationCode) formData.append('invitationCode', invitationCode);
      if (donation.receipt) {
        formData.append('receipt', donation.receipt);
      }

      const res = await apiFetch('/api/charity/donate', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to submit donation');
      }

      setSuccess(t('submitted'));
      setDonation({
        step: 1,
        donorName: donation.donorName,
        donorPhone: donation.donorPhone,
        donationAmount: '',
        referenceNumber: '',
      });
      await loadCampaigns();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to submit donation');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (accessMessage) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
        <div className="max-w-xl mx-auto space-y-4 pt-10 text-center">
          <h1 className="text-2xl font-semibold">{appName}</h1>
          <div className="rounded-lg border border-amber-400 bg-amber-900/30 p-4">
            <p className="text-amber-100">{accessMessage}</p>
          </div>
          <Link href="/miniapp" className="text-sm text-blue-400 hover:text-blue-300">
            ← {t('backHome')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />

      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Heart className="w-8 h-8 text-red-500" />
            {t('title')}
          </h1>
          <button
            onClick={() => setLang(lang === 'en' ? 'am' : 'en')}
            className="px-3 py-1 rounded-lg bg-slate-800 text-sm hover:bg-slate-700"
          >
            {lang === 'en' ? 'አማርኛ' : 'English'}
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-400 bg-red-900/30 p-4 flex gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-200">{error}</p>
          </div>
        ) : null}

        {success ? (
          <div className="rounded-lg border border-green-400 bg-green-900/30 p-4 flex gap-2">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-green-200">{success}</p>
          </div>
        ) : null}

        {donation.step === 1 ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">{t('selectCampaign')}</h2>

            {campaigns.length === 0 ? (
              <p className="text-slate-400">{t('noCampaigns')}</p>
            ) : (
              <div className="grid gap-3">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 space-y-2">
                    <h3 className="font-semibold text-lg">{campaign.name}</h3>
                    <p className="text-sm text-slate-300">{campaign.cause}</p>
                    {campaign.description ? <p className="text-xs text-slate-400">{campaign.description}</p> : null}

                    <div className="flex flex-wrap gap-3 text-xs">
                      {campaign.telegram_channel_url ? (
                        <a
                          href={campaign.telegram_channel_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 underline"
                        >
                          {t('openChannel')}
                        </a>
                      ) : null}
                      {campaign.telegram_group_url ? (
                        <a
                          href={campaign.telegram_group_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 underline"
                        >
                          {t('openGroup')}
                        </a>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="flex gap-4 text-sm">
                        <div>
                          <span className="text-slate-400">{t('campaignGoal')}:</span>
                          <span className="ml-1 font-mono">ETB {Number(campaign.goal_amount || 0).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">{t('campaignCollected')}:</span>
                          <span className="ml-1 font-mono text-green-400">
                            ETB {Number(campaign.collected_amount || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          setDonation((prev) => ({
                            ...prev,
                            step: 2,
                            campaignId: campaign.id,
                            campaignName: campaign.name,
                          }))
                        }
                        className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm font-medium"
                      >
                        {t('selectThisCampaign')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <p className="text-sm font-medium text-slate-300">
                Campaign: <span className="text-white">{donation.campaignName}</span>
              </p>
              {invitationCode ? (
                <p className="text-xs text-slate-400 mt-1">
                  Invitation code: <span className="font-mono text-slate-200">{invitationCode}</span>
                </p>
              ) : null}
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold">{t('donorInfo')}</h2>

              <div>
                <label className="block text-sm text-slate-300 mb-2">{t('fullName')}</label>
                <input
                  type="text"
                  required
                  value={donation.donorName}
                  onChange={(e) => setDonation((prev) => ({ ...prev, donorName: e.target.value }))}
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">{t('phone')}</label>
                <input
                  type="tel"
                  value={donation.donorPhone}
                  onChange={(e) => setDonation((prev) => ({ ...prev, donorPhone: e.target.value }))}
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">{t('donationAmount')}</label>
                <input
                  type="number"
                  required
                  min="1"
                  step="0.01"
                  value={donation.donationAmount}
                  onChange={(e) => setDonation((prev) => ({ ...prev, donationAmount: e.target.value }))}
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">{t('referenceNumber')}</label>
                <input
                  type="text"
                  required
                  value={donation.referenceNumber}
                  onChange={(e) => setDonation((prev) => ({ ...prev, referenceNumber: e.target.value }))}
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-300 mb-2">{t('uploadReceipt')}</label>
                <div className="rounded-lg border-2 border-dashed border-slate-700 p-4 text-center">
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setDonation((prev) => ({ ...prev, receipt: e.target.files?.[0] }))}
                    className="hidden"
                    id="receipt-input"
                  />
                  <label htmlFor="receipt-input" className="cursor-pointer text-slate-400 hover:text-slate-300">
                    {donation.receipt ? (
                      <span className="text-green-400">{donation.receipt.name}</span>
                    ) : (
                      <span>{t('receiptInstruction')}</span>
                    )}
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDonation((prev) => ({ ...prev, step: 1 }))}
                className="flex-1 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-medium"
              >
                {t('back')}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-700 text-sm font-medium flex items-center justify-center gap-2"
              >
                {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
                {t('donate')}
              </button>
            </div>
          </form>
        )}

        <div className="pt-4 border-t border-slate-700">
          <Link href="/miniapp" className="text-sm text-blue-400 hover:text-blue-300">
            ← {t('backHome')}
          </Link>
        </div>
      </div>
    </div>
  );
}
