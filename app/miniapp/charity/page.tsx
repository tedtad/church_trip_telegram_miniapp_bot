'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import {
  ethiopianToGregorianYmd,
  formatLocalizedDateTime,
  gregorianToEthiopianYmd,
} from '@/lib/date-localization';

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
  promiseId?: string;
  donorName: string;
  donorPhone: string;
  donationAmount: string;
  referenceNumber: string;
  receipt?: File;
}

interface PromiseRow {
  id: string;
  campaign_id?: string;
  donor_name?: string;
  donor_phone?: string | null;
  promise_type?: string;
  pledged_amount?: number | null;
  item_description?: string | null;
  due_at?: string | null;
  status?: string | null;
  created_at?: string;
}

type Lang = 'en' | 'am';

const COPY: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Make a Donation',
    donateNow: 'Donate Now',
    promiseLedger: 'Promise Ledger',
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
    logPromise: 'Log Charity Promise',
    campaign: 'Campaign',
    selectCampaignOption: 'Select campaign',
    promiseType: 'Promise Type',
    promiseTypeCash: 'Cash',
    promiseTypeInKind: 'In Kind',
    dueDate: 'Due Date',
    pledgedAmount: 'Pledged Amount (ETB)',
    inKindDetails: 'In-kind Details',
    reminderDays: 'Reminder Days Before Due',
    noteOptional: 'Reference Note (optional)',
    createPromise: 'Create Promise',
    creatingPromise: 'Creating...',
    promiseLogged: 'Promise logged successfully.',
    promiseListEmpty: 'No promises yet.',
    executePromise: 'Execute',
    promiseReadyForPayment: 'Promise ready for payment. Complete the normal donation submission.',
    inKindSubmitted: 'In-kind execution submitted for approval.',
    promiseErrorSelectCampaign: 'Please select a campaign for the promise.',
    promiseErrorCashAmount: 'Cash promise amount must be greater than zero.',
    promiseErrorInKindDetails: 'In-kind promise details are required.',
    promiseErrorExecuteInKindDetails: 'In-kind execution details are required.',
    promiseErrorCreateFailed: 'Failed to create promise',
    promiseErrorExecuteFailed: 'Failed to execute promise',
    promiseStatus: 'Status',
    promiseDue: 'Due',
    promiseAmount: 'Amount',
    promiseItem: 'Item',
    promiseExecutePrompt: 'Enter in-kind execution details',
    ethiopianDatePlaceholder: 'YYYY-MM-DD (Ethiopian)',
    ethiopianDateHint: 'Use Ethiopian calendar date format',
    gregorianLabel: 'Gregorian',
  },
  am: {
    title: 'ልገሳ ያድርጉ',
    donateNow: 'አሁን ልገሳ ያድርጉ',
    promiseLedger: 'የተስፋ መዝገብ',
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
    logPromise: 'የበጎ አድራጎት ተስፋ መዝግብ',
    campaign: 'ዘመቻ',
    selectCampaignOption: 'ዘመቻ ይምረጡ',
    promiseType: 'የተስፋ አይነት',
    promiseTypeCash: 'ገንዘብ',
    promiseTypeInKind: 'ዕቃ',
    dueDate: 'የመጨረሻ ቀን',
    pledgedAmount: 'የተስፋ መጠን (ብር)',
    inKindDetails: 'የዕቃ ዝርዝር',
    reminderDays: 'ከየመጨረሻ ቀን በፊት የማስታወሻ ቀን',
    noteOptional: 'ማስታወሻ (አማራጭ)',
    createPromise: 'ተስፋ ፍጠር',
    creatingPromise: 'በመፍጠር ላይ...',
    promiseLogged: 'ተስፋው በተሳካ ሁኔታ ተመዝግቧል።',
    promiseListEmpty: 'እስካሁን ተስፋ የለም።',
    executePromise: 'አስፈጽም',
    promiseReadyForPayment: 'ተስፋው ለክፍያ ዝግጁ ነው። መደበኛ የልገሳ ሂደትን ይቀጥሉ።',
    inKindSubmitted: 'የዕቃ ማስፈጸሚያ ለማጽደቅ ተልኳል።',
    promiseErrorSelectCampaign: 'እባክዎ ለተስፋው ዘመቻ ይምረጡ።',
    promiseErrorCashAmount: 'የገንዘብ ተስፋ መጠን ከዜሮ በላይ መሆን አለበት።',
    promiseErrorInKindDetails: 'የዕቃ ተስፋ ዝርዝር ያስፈልጋል።',
    promiseErrorExecuteInKindDetails: 'ለዕቃ ማስፈጸሚያ ዝርዝር ያስፈልጋል።',
    promiseErrorCreateFailed: 'ተስፋ መፍጠር አልተሳካም',
    promiseErrorExecuteFailed: 'ተስፋ ማስፈጸም አልተሳካም',
    promiseStatus: 'ሁኔታ',
    promiseDue: 'የመጨረሻ ቀን',
    promiseAmount: 'መጠን',
    promiseItem: 'ዕቃ',
    promiseExecutePrompt: 'የዕቃ ማስፈጸሚያ ዝርዝር ያስገቡ',
    ethiopianDatePlaceholder: 'YYYY-MM-DD (የኢትዮጵያ ቀን መቁጠሪያ)',
    ethiopianDateHint: 'የኢትዮጵያ ቀን መቁጠሪያ ቅርጸት ይጠቀሙ',
    gregorianLabel: 'ግሪጎሪያን',
  },
};

function resolveInitDataFromPage() {
  const tg = window.Telegram?.WebApp;
  tg?.ready?.();
  tg?.expand?.();
  const params = new URLSearchParams(window.location.search);
  const fromQuery = String(params.get('initData') || params.get('tgWebAppData') || '').trim();
  const fromTg = String(tg?.initData || '').trim();
  return fromTg || fromQuery;
}

function normalizeDiscountCodeInput(value: string) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

function formatDateLocalized(value?: string | null, lang: Lang = 'en', naText = '-') {
  return formatLocalizedDateTime(value, lang, naText);
}

export default function CharityPage() {
  const [viewMode, setViewMode] = useState<'donate' | 'promises'>('donate');
  const [lang, setLang] = useState<Lang>('am');
  const [initData, setInitData] = useState('');
  const [appName, setAppName] = useState('TicketHub');
  const [invitationCode, setInvitationCode] = useState('');
  const [campaignHintId, setCampaignHintId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [promises, setPromises] = useState<PromiseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [promisesLoading, setPromisesLoading] = useState(false);
  const [creatingPromise, setCreatingPromise] = useState(false);
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
  const [promiseCampaignId, setPromiseCampaignId] = useState('');
  const [promiseType, setPromiseType] = useState<'cash' | 'in_kind'>('cash');
  const [pledgedAmount, setPledgedAmount] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [promiseDueAt, setPromiseDueAt] = useState('');
  const [promiseDueAtEthInput, setPromiseDueAtEthInput] = useState('');
  const [promiseReminderDays, setPromiseReminderDays] = useState('1');
  const [promiseNote, setPromiseNote] = useState('');

  const t = useCallback((key: string) => COPY[lang]?.[key] || COPY.en[key] || key, [lang]);

  useEffect(() => {
    if (lang !== 'am') return;
    setPromiseDueAtEthInput(gregorianToEthiopianYmd(promiseDueAt));
  }, [lang, promiseDueAt]);

  const onPromiseDueAtInput = useCallback(
    (value: string) => {
      if (lang === 'am') {
        setPromiseDueAtEthInput(value);
        const converted = ethiopianToGregorianYmd(value);
        setPromiseDueAt(converted ? `${converted}T00:00` : '');
        return;
      }
      setPromiseDueAt(value);
    },
    [lang]
  );

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

  const loadPromises = useCallback(async () => {
    try {
      setPromisesLoading(true);
      const res = await apiFetch('/api/charity/promises');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Failed to load promises');
      }
      setPromises((data.promises || []) as PromiseRow[]);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load promises');
    } finally {
      setPromisesLoading(false);
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
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

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

    const tryResolveSession = async (attempt: number) => {
      if (disposed) return;
      const resolved = resolveInitDataFromPage();

      if (!resolved) {
        if (attempt < 20) {
          timer = setTimeout(() => {
            void tryResolveSession(attempt + 1);
          }, 150);
          return;
        }
        setAccessMessage('Invalid Telegram Mini App session');
        setLoading(false);
        return;
      }

      setInitData(resolved);
      const allowed = await ensureMiniAppCharityAccess(resolved);
      if (!allowed) {
        if (!disposed) setLoading(false);
        return;
      }
      await loadCampaigns();
      if (disposed) return;
      await loadPromises();
    };

    void tryResolveSession(0);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [ensureMiniAppCharityAccess, loadCampaigns, loadPromises]);

  useEffect(() => {
    if (!campaignHintId || campaigns.length === 0) return;
    const matched = campaigns.find((campaign) => campaign.id === campaignHintId);
    if (!matched) return;
    setDonation((prev) => ({
      ...prev,
      step: 2,
      campaignId: matched.id,
      campaignName: matched.name,
      promiseId: undefined,
    }));
    setCampaignHintId('');
  }, [campaignHintId, campaigns]);

  useEffect(() => {
    if (!promiseCampaignId && campaigns[0]?.id) {
      setPromiseCampaignId(campaigns[0].id);
    }
  }, [campaigns, promiseCampaignId]);

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
      if (donation.promiseId) formData.append('promiseId', donation.promiseId);
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
        promiseId: undefined,
      });
      await loadCampaigns();
      await loadPromises();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to submit donation');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreatePromise(e: React.FormEvent) {
    e.preventDefault();
    setCreatingPromise(true);
    setError('');
    setSuccess('');
    try {
      if (!promiseCampaignId) {
        throw new Error(t('promiseErrorSelectCampaign'));
      }
      if (promiseType === 'cash' && Number(pledgedAmount || 0) <= 0) {
        throw new Error(t('promiseErrorCashAmount'));
      }
      if (promiseType === 'in_kind' && !itemDescription.trim()) {
        throw new Error(t('promiseErrorInKindDetails'));
      }

      const response = await apiFetch('/api/charity/promises', {
        method: 'POST',
        body: JSON.stringify({
          campaignId: promiseCampaignId,
          donorName: donation.donorName,
          donorPhone: donation.donorPhone,
          promiseType,
          pledgedAmount: promiseType === 'cash' ? Number(pledgedAmount || 0) : undefined,
          itemDescription: promiseType === 'in_kind' ? itemDescription.trim() : undefined,
          dueAt: promiseDueAt || undefined,
          reminderDaysBefore: Number(promiseReminderDays || 1),
          referenceNote: promiseNote.trim() || undefined,
          invitationCode: invitationCode || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || t('promiseErrorCreateFailed'));
      }

      setSuccess(t('promiseLogged'));
      setPledgedAmount('');
      setItemDescription('');
      setPromiseDueAt('');
      setPromiseReminderDays('1');
      setPromiseNote('');
      await loadPromises();
    } catch (err) {
      setError((err as Error)?.message || t('promiseErrorCreateFailed'));
    } finally {
      setCreatingPromise(false);
    }
  }

  async function handleExecutePromise(promise: PromiseRow) {
    try {
      setError('');
      setSuccess('');
      const details =
        String(promise.promise_type || '').toLowerCase() === 'in_kind'
          ? window.prompt(t('promiseExecutePrompt'), String(promise.item_description || '')) ?? ''
          : '';
      if (String(promise.promise_type || '').toLowerCase() === 'in_kind' && !details.trim()) {
        setError(t('promiseErrorExecuteInKindDetails'));
        return;
      }

      const response = await apiFetch(`/api/charity/promises/${encodeURIComponent(String(promise.id || ''))}/execute`, {
        method: 'POST',
        body: JSON.stringify({
          inKindDetails: details.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || t('promiseErrorExecuteFailed'));
      }

      if (String(data?.mode || '').toLowerCase() === 'cash') {
        const campaign = campaigns.find((row) => row.id === String(promise.campaign_id || ''));
        setDonation((prev) => ({
          ...prev,
          step: 2,
          campaignId: String(promise.campaign_id || ''),
          campaignName: campaign?.name || prev.campaignName,
          promiseId: String(promise.id || ''),
          donationAmount:
            Number(promise.pledged_amount || 0) > 0 ? String(Number(promise.pledged_amount || 0)) : prev.donationAmount,
        }));
        setViewMode('donate');
        setSuccess(t('promiseReadyForPayment'));
      } else {
        setSuccess(t('inKindSubmitted'));
      }
      await loadPromises();
    } catch (err) {
      setError((err as Error)?.message || t('promiseErrorExecuteFailed'));
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

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode('donate')}
            className={`px-3 py-2 rounded-lg text-sm ${
              viewMode === 'donate' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t('donateNow')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('promises')}
            className={`px-3 py-2 rounded-lg text-sm ${
              viewMode === 'promises' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t('promiseLedger')}
          </button>
        </div>

        {viewMode === 'donate' ? (donation.step === 1 ? (
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
                            promiseId: undefined,
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
              {donation.promiseId ? (
                <p className="text-xs text-slate-400 mt-1">
                  Promise execution: <span className="font-mono text-slate-200">{donation.promiseId}</span>
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
        )) : (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">{t('logPromise')}</h2>
            <form onSubmit={handleCreatePromise} className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">{t('campaign')}</label>
                <select
                  value={promiseCampaignId}
                  onChange={(e) => setPromiseCampaignId(e.target.value)}
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                >
                  <option value="">{t('selectCampaignOption')}</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('promiseType')}</label>
                  <select
                    value={promiseType}
                    onChange={(e) => setPromiseType(e.target.value === 'in_kind' ? 'in_kind' : 'cash')}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                  >
                    <option value="cash">{t('promiseTypeCash')}</option>
                    <option value="in_kind">{t('promiseTypeInKind')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('dueDate')}</label>
                  {lang === 'am' ? (
                    <>
                      <input
                        type="text"
                        value={promiseDueAtEthInput}
                        onChange={(e) => onPromiseDueAtInput(e.target.value)}
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                        placeholder={t('ethiopianDatePlaceholder')}
                      />
                      <p className="mt-1 text-[11px] text-slate-400">
                        {t('ethiopianDateHint')}
                        {promiseDueAt ? ` (${t('gregorianLabel')}: ${promiseDueAt.slice(0, 10)})` : ''}
                      </p>
                    </>
                  ) : (
                    <input
                      type="datetime-local"
                      value={promiseDueAt}
                      onChange={(e) => onPromiseDueAtInput(e.target.value)}
                      className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                    />
                  )}
                </div>
              </div>

              {promiseType === 'cash' ? (
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('pledgedAmount')}</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={pledgedAmount}
                    onChange={(e) => setPledgedAmount(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('inKindDetails')}</label>
                  <textarea
                    value={itemDescription}
                    onChange={(e) => setItemDescription(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('reminderDays')}</label>
                  <input
                    type="number"
                    min="0"
                    value={promiseReminderDays}
                    onChange={(e) => setPromiseReminderDays(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">{t('noteOptional')}</label>
                  <input
                    type="text"
                    value={promiseNote}
                    onChange={(e) => setPromiseNote(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={creatingPromise}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-700 text-sm font-medium"
              >
                {creatingPromise ? t('creatingPromise') : t('createPromise')}
              </button>
            </form>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">{t('promiseLedger')}</h3>
              {promisesLoading ? <p className="text-slate-400 text-sm">Loading promises...</p> : null}
              {promises.length === 0 ? (
                <p className="text-slate-400 text-sm">{t('promiseListEmpty')}</p>
              ) : (
                promises.map((row) => {
                  const campaign = campaigns.find((c) => c.id === String(row.campaign_id || ''));
                  const rowStatus = String(row.status || '').toLowerCase();
                  const canExecute = !['fulfilled', 'cancelled'].includes(rowStatus);
                  return (
                    <div key={row.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-1">
                      <p className="font-medium">{campaign?.name || row.campaign_id || t('campaign')}</p>
                      <p className="text-xs text-slate-300">
                        {t('promiseType')}: {row.promise_type || '-'} | {t('promiseStatus')}: {row.status || '-'}
                      </p>
                      <p className="text-xs text-slate-300">
                        {String(row.promise_type || '').toLowerCase() === 'cash'
                          ? `${t('promiseAmount')}: ETB ${Number(row.pledged_amount || 0).toFixed(2)}`
                          : `${t('promiseItem')}: ${String(row.item_description || '-')}`}
                      </p>
                      <p className="text-xs text-slate-400">
                        {t('promiseDue')}: {formatDateLocalized(row.due_at, lang, '-')}
                      </p>
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => handleExecutePromise(row)}
                          disabled={!canExecute}
                          className="px-3 py-1 rounded-md bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-700 text-white text-xs"
                        >
                          {t('executePromise')}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
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
