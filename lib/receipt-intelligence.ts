export type ReceiptProvider =
  | 'ethio_telecom_transactioninfo'
  | 'cbe_apps'
  | 'cbe_cbepay'
  | 'unknown';

export interface ParsedReceiptLink {
  url: string;
  provider: ReceiptProvider;
  reference: string;
  amount: number | null;
  date: string;
}

export interface ReceiptAnalysisResult {
  reference: string;
  receiptDate: string;
  link: ParsedReceiptLink;
  score: number;
  flags: string[];
  error?: string;
}

export function normalizeReferenceToken(raw: unknown) {
  const text = String(raw || '').trim();
  return (text.match(/[A-Za-z0-9_-]{3,120}/g) || [])[0] || '';
}

export function parseReceiptDateToken(raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseAmountToken(raw: unknown): number | null {
  const token = String(raw || '').trim().replace(/,/g, '');
  if (!token) return null;
  const numeric = Number(token);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(2));
}

export function parseReceiptLink(link: string): ParsedReceiptLink {
  const urlValue = String(link || '').trim();
  if (!urlValue) {
    return { url: '', provider: 'unknown', reference: '', amount: null, date: '' };
  }

  try {
    const parsed = new URL(urlValue);
    const host = parsed.hostname.toLowerCase();
    const params = parsed.searchParams;

    let provider: ReceiptProvider = 'unknown';
    let reference = '';

    if (host.includes('transactioninfo.ethiotelecom.et')) {
      provider = 'ethio_telecom_transactioninfo';
      const parts = parsed.pathname.split('/').filter(Boolean);
      reference = normalizeReferenceToken(parts[parts.length - 1] || '');
    } else if (host.includes('apps.cbe.com.et')) {
      provider = 'cbe_apps';
      reference = normalizeReferenceToken(params.get('id') || '');
    } else if (host.includes('cbepay1.cbe.com.et')) {
      provider = 'cbe_cbepay';
      reference = normalizeReferenceToken(params.get('TID') || params.get('tid') || '');
    }

    if (!reference) {
      const genericCandidates = [
        params.get('ref'),
        params.get('reference'),
        params.get('referenceNumber'),
        params.get('tx_ref'),
        params.get('txref'),
        params.get('transaction'),
        params.get('transaction_id'),
        params.get('payment_ref'),
        params.get('paymentReference'),
      ];
      reference = normalizeReferenceToken(
        genericCandidates.find((value) => String(value || '').trim()) ||
          parsed.pathname.split('/').filter(Boolean).pop() ||
          ''
      );
    }

    const amount = parseAmountToken(
      params.get('amount') || params.get('paid') || params.get('value') || ''
    );
    const date = parseReceiptDateToken(
      params.get('date') || params.get('payment_date') || params.get('created_at') || params.get('time') || ''
    );

    return {
      url: parsed.toString(),
      provider,
      reference,
      amount,
      date,
    };
  } catch {
    return {
      url: urlValue,
      provider: 'unknown',
      reference: normalizeReferenceToken(urlValue),
      amount: null,
      date: '',
    };
  }
}

type AnalyzeParams = {
  receiptLink: string;
  referenceInput: string;
  receiptDateInput: string;
  amountPaid: number;
  strict: boolean;
};

export function analyzeReceiptSubmission(params: AnalyzeParams): ReceiptAnalysisResult {
  const link = parseReceiptLink(params.receiptLink);
  const referenceInput = normalizeReferenceToken(params.referenceInput);
  const receiptDateInput = parseReceiptDateToken(params.receiptDateInput);
  const flags: string[] = [];
  let score = 40;

  if (link.url) {
    score += 20;
  } else {
    flags.push('no_receipt_link');
  }

  if (link.provider !== 'unknown') {
    score += 20;
    flags.push(`provider:${link.provider}`);
  } else if (link.url) {
    flags.push('unknown_receipt_provider');
  }

  const reference = referenceInput || link.reference;
  if (!reference) {
    return {
      reference: '',
      receiptDate: receiptDateInput || link.date,
      link,
      score: 0,
      flags: [...flags, 'missing_reference'],
      error: 'Valid reference number is required',
    };
  }

  if (referenceInput && link.reference && referenceInput !== link.reference) {
    flags.push('reference_mismatch_with_link');
    score -= 20;
    if (params.strict) {
      return {
        reference: '',
        receiptDate: receiptDateInput || link.date,
        link,
        score: Math.max(0, score),
        flags,
        error: 'Reference does not match receipt link reference',
      };
    }
  } else if (link.reference) {
    score += 15;
  }

  if (link.amount !== null) {
    const delta = Math.abs(Number(params.amountPaid.toFixed(2)) - Number(link.amount.toFixed(2)));
    if (delta > 1) {
      flags.push('amount_mismatch_with_link');
      score -= 20;
      if (params.strict) {
        return {
          reference: '',
          receiptDate: receiptDateInput || link.date,
          link,
          score: Math.max(0, score),
          flags,
          error: 'Receipt link amount does not match entered payment amount',
        };
      }
    } else {
      score += 10;
    }
  }

  const receiptDate = receiptDateInput || link.date;
  if (!receiptDate) {
    flags.push('missing_receipt_date');
  } else {
    score += 5;
  }

  return {
    reference,
    receiptDate,
    link,
    score: Math.max(0, Math.min(100, score)),
    flags,
  };
}
