export type BankAccountConfig = {
  bank_name: string;
  account_name: string;
  account_number: string;
};

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeBankAccount(entry: any): BankAccountConfig | null {
  const bankName = toText(entry?.bank_name || entry?.bankName);
  const accountName = toText(entry?.account_name || entry?.accountName);
  const accountNumber = toText(entry?.account_number || entry?.accountNumber);
  if (!bankName && !accountName && !accountNumber) return null;
  return {
    bank_name: bankName || 'Bank',
    account_name: accountName || 'Account Name',
    account_number: accountNumber || 'N/A',
  };
}

function parseBankLine(line: string): BankAccountConfig | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const pipeParts = trimmed
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  if (pipeParts.length >= 3) {
    return {
      bank_name: pipeParts[0],
      account_name: pipeParts[1],
      account_number: pipeParts.slice(2).join(' | '),
    };
  }

  const commaParts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length >= 3) {
    return {
      bank_name: commaParts[0],
      account_name: commaParts[1],
      account_number: commaParts.slice(2).join(', '),
    };
  }

  return {
    bank_name: 'Bank',
    account_name: 'Account',
    account_number: trimmed,
  };
}

export function parseBankAccounts(raw: unknown): BankAccountConfig[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(normalizeBankAccount).filter(Boolean) as BankAccountConfig[];
  }

  if (typeof raw === 'object') {
    const normalized = normalizeBankAccount(raw);
    return normalized ? [normalized] : [];
  }

  const text = toText(raw);
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeBankAccount).filter(Boolean) as BankAccountConfig[];
    }
  } catch {
    // Treat input as line-based text when not valid JSON.
  }

  return text
    .split('\n')
    .map((line) => parseBankLine(line))
    .filter(Boolean) as BankAccountConfig[];
}

export function serializeBankAccountsForTextInput(accounts: unknown) {
  return parseBankAccounts(accounts)
    .map((account) => `${account.bank_name} | ${account.account_name} | ${account.account_number}`)
    .join('\n');
}

export function formatBankAccounts(accounts: BankAccountConfig[]) {
  if (!accounts.length) return '';
  return accounts
    .map(
      (account, idx) =>
        `${idx + 1}) ${account.bank_name}\n   Account Name: ${account.account_name}\n   Account No: ${account.account_number}`
    )
    .join('\n');
}

export function getTripManualPaymentConfig(trip: any) {
  return {
    telebirrManualAccountName: toText(
      trip?.telebirr_manual_account_name || trip?.telebirr_account_name || trip?.telebirrAccountName
    ),
    telebirrManualAccountNumber: toText(
      trip?.telebirr_manual_account_number || trip?.telebirr_account_number || trip?.telebirrAccountNumber
    ),
    manualPaymentNote: toText(trip?.manual_payment_note || trip?.manualPaymentNote),
    bankAccounts: parseBankAccounts(trip?.bank_accounts || trip?.bankAccounts),
  };
}

