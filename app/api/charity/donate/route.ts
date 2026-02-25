import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { sendCharityDonationThankYou } from '@/lib/charity-automation';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);
const MAX_RECEIPT_BYTES = 6 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
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
    const receipt = formData.get('receipt') as File | null;

    if (!campaignId) {
      return NextResponse.json({ message: 'Campaign is required' }, { status: 400 });
    }
    if (!Number.isFinite(donationAmount) || donationAmount <= 0) {
      return NextResponse.json({ message: 'Donation amount must be greater than zero' }, { status: 400 });
    }
    if (!referenceNumber) {
      return NextResponse.json({ message: 'Reference number is required' }, { status: 400 });
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

    const { data, error } = await supabase
      .from('charity_donations')
      .insert([
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
      ])
      .select()
      .single();

    if (error) {
      console.error('[charity-donate] Error creating donation:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await sendCharityDonationThankYou(supabase, data.id, 'submitted');
    return NextResponse.json({ donation: data, message: 'Donation submitted. Thank you for your support.' });
  } catch (error) {
    console.error('[charity-donate] Error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
