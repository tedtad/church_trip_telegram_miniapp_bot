import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { sendCharityDonationThankYou } from '@/lib/charity-automation';
import { normalizeDiscountCode, incrementVoucherUsage } from '@/lib/discount-vouchers';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);
const MAX_RECEIPT_BYTES = 6 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

type InvitationRow = {
  id: string;
  max_uses?: number | null;
  current_uses?: number | null;
  used_count?: number | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active?: boolean | null;
};

type CharityPromiseRow = {
  id: string;
  campaign_id?: string | null;
  telegram_user_id?: number | null;
  promise_type?: string | null;
  status?: string | null;
};

function normalizeReference(raw: unknown) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 80);
}

function normalizePhone(raw: unknown) {
  return String(raw || '').trim().replace(/[^\d+]/g, '');
}

function resolveInitData(request: NextRequest, formData: FormData) {
  return String(
    request.headers.get('x-telegram-init-data') ||
      formData.get('initData') ||
      request.nextUrl.searchParams.get('initData') ||
      ''
  ).trim();
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

async function loadInvitationByCode(supabase: any, invitationCode: string): Promise<InvitationRow | null> {
  const selectCandidates = [
    'id, max_uses, current_uses, used_count, valid_from, expires_at, is_active',
    'id, max_uses, current_uses, used_count, expires_at, is_active',
    'id, max_uses, current_uses, used_count, expires_at',
    'id, max_uses, current_uses, used_count',
    'id, max_uses, current_uses',
    'id',
  ];

  for (const selectClause of selectCandidates) {
    const { data, error } = await supabase
      .from('invitations')
      .select(selectClause)
      .ilike('invitation_code', invitationCode)
      .limit(1)
      .maybeSingle();

    if (!error) return (data || null) as InvitationRow | null;
    if (
      isMissingColumn(error, 'valid_from') ||
      isMissingColumn(error, 'expires_at') ||
      isMissingColumn(error, 'is_active') ||
      isMissingColumn(error, 'current_uses') ||
      isMissingColumn(error, 'used_count') ||
      isMissingColumn(error, 'max_uses')
    ) {
      continue;
    }
  }

  return null;
}

async function loadPromiseById(supabase: any, promiseId: string): Promise<CharityPromiseRow | null> {
  const selectCandidates = [
    'id, campaign_id, telegram_user_id, promise_type, status',
    'id, campaign_id, telegram_user_id, promise_type',
    'id, campaign_id, telegram_user_id',
    'id, campaign_id',
    'id',
  ];

  for (const selectClause of selectCandidates) {
    const { data, error } = await supabase
      .from('charity_promises')
      .select(selectClause)
      .eq('id', promiseId)
      .maybeSingle();

    if (!error) return (data || null) as CharityPromiseRow | null;
    if (
      isMissingColumn(error, 'status') ||
      isMissingColumn(error, 'promise_type') ||
      isMissingColumn(error, 'telegram_user_id') ||
      isMissingColumn(error, 'campaign_id')
    ) {
      continue;
    }
  }

  return null;
}

async function insertPromiseExecutionWithFallback(supabase: any, payload: Record<string, unknown>) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data, error } = await supabase.from('charity_promise_executions').insert(working).select('*').single();
    if (!error) return data || null;

    const missingCandidates = [
      'execution_type',
      'campaign_id',
      'telegram_user_id',
      'donation_id',
      'reference_number',
      'receipt_file_url',
      'receipt_file_name',
      'approval_status',
      'notes',
      'updated_at',
    ];
    const missing = missingCandidates.find((column) => isMissingColumn(error, column));
    if (!missing || !(missing in working)) break;
    delete (working as any)[missing];
  }
  return null;
}

async function updateDonationPromiseExecutionWithFallback(
  supabase: any,
  donationId: string,
  executionId: string
) {
  const payloadCandidates = [
    { promise_execution_id: executionId, updated_at: new Date().toISOString() },
    { promise_execution_id: executionId },
  ];
  for (const payload of payloadCandidates) {
    const result = await supabase.from('charity_donations').update(payload).eq('id', donationId);
    if (!result.error) return true;
    if (isMissingColumn(result.error, 'promise_execution_id') || isMissingColumn(result.error, 'updated_at')) {
      continue;
    }
    return false;
  }
  return false;
}

async function updatePromiseStatusWithFallback(
  supabase: any,
  promiseId: string,
  status: string
) {
  const payloadCandidates = [
    { status, updated_at: new Date().toISOString() },
    { status },
  ];
  for (const payload of payloadCandidates) {
    const result = await supabase.from('charity_promises').update(payload).eq('id', promiseId);
    if (!result.error) return true;
    if (isMissingColumn(result.error, 'status') || isMissingColumn(result.error, 'updated_at')) {
      continue;
    }
    return false;
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const appSettings = await getMiniAppRuntimeSettings(supabase);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }
    if (!appSettings.charityEnabled) {
      return NextResponse.json({ ok: false, message: 'Charity module is currently disabled.' }, { status: 403 });
    }

    const formData = await request.formData();
    const initData = resolveInitData(request, formData);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized mini app session' }, { status: 401 });
    }

    const campaignId = String(formData.get('campaignId') || '').trim();
    const donorNameInput = String(formData.get('donorName') || '').trim();
    const donorPhone = normalizePhone(formData.get('donorPhone'));
    const donationAmount = Number(formData.get('donationAmount') || 0);
    const referenceNumber = normalizeReference(formData.get('referenceNumber'));
    const invitationCode = normalizeDiscountCode(formData.get('invitationCode'));
    const promiseId = String(formData.get('promiseId') || '').trim();
    const receipt = formData.get('receipt') as File | null;
    let invitationId: string | null = null;
    let resolvedPromise: CharityPromiseRow | null = null;

    if (!campaignId) {
      return NextResponse.json({ message: 'Campaign is required' }, { status: 400 });
    }
    if (!Number.isFinite(donationAmount) || donationAmount <= 0) {
      return NextResponse.json({ message: 'Donation amount must be greater than zero' }, { status: 400 });
    }
    if (!referenceNumber) {
      return NextResponse.json({ message: 'Reference number is required' }, { status: 400 });
    }

    if (promiseId) {
      const promise = await loadPromiseById(supabase, promiseId);
      if (!promise?.id) {
        return NextResponse.json({ message: 'Promise record not found' }, { status: 400 });
      }
      if (String(promise.campaign_id || '').trim() && String(promise.campaign_id || '').trim() !== campaignId) {
        return NextResponse.json({ message: 'Promise campaign mismatch' }, { status: 400 });
      }
      if (
        promise.telegram_user_id !== null &&
        promise.telegram_user_id !== undefined &&
        Number(promise.telegram_user_id) !== Number(auth.user.id)
      ) {
        return NextResponse.json({ message: 'Promise ownership mismatch' }, { status: 403 });
      }
      const promiseType = String(promise.promise_type || 'cash').trim().toLowerCase();
      if (promiseType !== 'cash') {
        return NextResponse.json({ message: 'Only cash promises can be executed via donation payment flow' }, { status: 400 });
      }
      const promiseStatus = String(promise.status || '').trim().toLowerCase();
      if (['fulfilled', 'executed', 'cancelled'].includes(promiseStatus)) {
        return NextResponse.json({ message: 'Promise is already completed or closed' }, { status: 400 });
      }
      resolvedPromise = promise;
    }

    if (invitationCode) {
      const invitation = await loadInvitationByCode(supabase, invitationCode);
      if (!invitation) {
        return NextResponse.json({ message: 'Invitation code not found' }, { status: 400 });
      }
      if (invitation.is_active === false) {
        return NextResponse.json({ message: 'Invitation code is inactive' }, { status: 400 });
      }
      if (invitation.valid_from) {
        const validFrom = new Date(invitation.valid_from);
        if (!Number.isNaN(validFrom.getTime()) && Date.now() < validFrom.getTime()) {
          return NextResponse.json({ message: 'Invitation code is not active yet' }, { status: 400 });
        }
      }
      if (invitation.expires_at) {
        const expiresAt = new Date(invitation.expires_at);
        if (!Number.isNaN(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
          return NextResponse.json({ message: 'Invitation code has expired' }, { status: 400 });
        }
      }
      const maxUsesRaw = Number(invitation.max_uses);
      const maxUses = Number.isFinite(maxUsesRaw) && maxUsesRaw > 0 ? Math.floor(maxUsesRaw) : null;
      const currentUsesRaw = Number(invitation.current_uses ?? invitation.used_count ?? 0);
      const currentUses = Number.isFinite(currentUsesRaw) ? Math.max(0, Math.floor(currentUsesRaw)) : 0;
      if (maxUses !== null && currentUses >= maxUses) {
        return NextResponse.json({ message: 'Invitation code usage limit reached' }, { status: 400 });
      }
      invitationId = invitation.id;
    }

    const { data: campaign } = await supabase
      .from('charity_campaigns')
      .select('id, status, name')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign || String(campaign.status || 'active').toLowerCase() !== 'active') {
      return NextResponse.json({ message: 'Campaign is not available' }, { status: 400 });
    }

    const { data: existingDonation } = await supabase
      .from('charity_donations')
      .select('id')
      .eq('reference_number', referenceNumber)
      .maybeSingle();
    if (existingDonation) {
      return NextResponse.json({ message: 'This reference number has already been used' }, { status: 400 });
    }

    const donorName =
      donorNameInput ||
      [String(auth.user.first_name || ''), String(auth.user.last_name || '')].filter(Boolean).join(' ').trim() ||
      'Telegram Donor';

    await supabase.from('telegram_users').upsert(
      {
        id: auth.user.id,
        first_name: auth.user.first_name || donorName.split(' ')[0] || 'Telegram',
        last_name: auth.user.last_name || null,
        username: auth.user.username || null,
        phone_number: donorPhone || null,
        language_code: auth.user.language_code === 'en' ? 'en' : 'am',
        last_activity: new Date().toISOString(),
        last_interaction: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    let receiptPath: string | null = null;
    let receiptFileName: string | null = null;

    if (receipt) {
      if (receipt.size <= 0 || receipt.size > MAX_RECEIPT_BYTES) {
        return NextResponse.json({ message: 'Receipt size must be between 1 byte and 6MB' }, { status: 400 });
      }
      const receiptType = String(receipt.type || '').toLowerCase();
      if (receiptType && !ALLOWED_RECEIPT_TYPES.has(receiptType)) {
        return NextResponse.json({ message: 'Receipt must be JPG, PNG, WEBP, or PDF' }, { status: 400 });
      }

      const originalName = String(receipt.name || 'receipt.bin');
      const extension = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase() : '.bin';
      const safeRef = referenceNumber.slice(0, 24);
      const storagePath = `charity/${campaignId}/${auth.user.id}/${Date.now()}-${safeRef}${extension}`;
      const fileBuffer = await receipt.arrayBuffer();
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(storagePath, fileBuffer, {
          upsert: false,
          contentType: receipt.type || undefined,
        });

      if (uploadError) {
        console.error('[charity-donate] receipt upload failed:', uploadError);
        return NextResponse.json({ message: 'Failed to upload receipt' }, { status: 500 });
      }

      receiptPath = String(uploadData?.path || storagePath);
      receiptFileName = originalName;
    }

    const insertBase = {
      campaign_id: campaignId,
      telegram_user_id: auth.user.id,
      donor_name: donorName,
      donor_phone: donorPhone || null,
      donation_amount: Number(donationAmount.toFixed(2)),
      payment_method: 'manual',
      reference_number: referenceNumber,
      receipt_file_url: receiptPath,
      receipt_file_name: receiptFileName,
      approval_status: 'pending',
      promise_id: resolvedPromise?.id || null,
      promise_execution_id: null,
    };

    const insertCandidates: Array<Record<string, unknown>> = [
      {
        ...insertBase,
        invitation_code: invitationCode || null,
        invitation_id: invitationId,
      },
      {
        ...insertBase,
        invitation_code: invitationCode || null,
      },
      {
        campaign_id: campaignId,
        telegram_user_id: auth.user.id,
        donor_name: donorName,
        donor_phone: donorPhone || null,
        donation_amount: Number(donationAmount.toFixed(2)),
        payment_method: 'manual',
        reference_number: referenceNumber,
        receipt_file_url: receiptPath,
        receipt_file_name: receiptFileName,
        approval_status: 'pending',
      },
    ];

    let data: any = null;
    let error: any = null;
    for (const payload of insertCandidates) {
      const result = await supabase.from('charity_donations').insert([payload]).select().single();
      if (!result.error) {
        data = result.data;
        error = null;
        break;
      }
      if (isMissingColumn(result.error, 'invitation_code') || isMissingColumn(result.error, 'invitation_id')) {
        error = result.error;
        continue;
      }
      error = result.error;
      break;
    }

    if (error || !data) {
      console.error('[charity-donate] Error creating donation:', error);
      return NextResponse.json({ error: error?.message || 'Failed to create donation' }, { status: 500 });
    }

    if (invitationId) {
      try {
        await incrementVoucherUsage(supabase, invitationId);
      } catch (usageError) {
        console.error('[charity-donate] invitation usage update failed:', usageError);
      }
    }

    if (resolvedPromise?.id) {
      const execution = await insertPromiseExecutionWithFallback(supabase, {
        promise_id: resolvedPromise.id,
        campaign_id: campaignId,
        telegram_user_id: auth.user.id,
        execution_type: 'cash_collection',
        donation_id: data.id,
        reference_number: referenceNumber,
        receipt_file_url: receiptPath,
        receipt_file_name: receiptFileName,
        approval_status: 'pending',
        notes: 'Cash promise execution submitted via mini app donation flow',
        updated_at: new Date().toISOString(),
      });
      if (execution?.id) {
        await updateDonationPromiseExecutionWithFallback(supabase, data.id, String(execution.id));
      }
      await updatePromiseStatusWithFallback(supabase, resolvedPromise.id, 'active');
    }

    await sendCharityDonationThankYou(supabase, data.id, 'submitted');
    return NextResponse.json({ donation: data, message: 'Donation submitted. Thank you for your support.' });
  } catch (error) {
    console.error('[charity-donate] Error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
