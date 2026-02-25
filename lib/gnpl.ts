export type GnplAccountStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'overdue'
  | 'completed'
  | 'cancelled';

export type GnplSettings = {
  enabled: boolean;
  requireAdminApproval: boolean;
  defaultTermDays: number;
  penaltyEnabled: boolean;
  penaltyPercent: number;
  penaltyPeriodDays: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
};

export type GnplAccountSnapshot = {
  principalAmount: number;
  principalPaid: number;
  principalOutstanding: number;
  penaltyAccrued: number;
  penaltyPaid: number;
  penaltyOutstanding: number;
  totalDue: number;
  status: GnplAccountStatus;
  dueDate: string | null;
  overdueDays: number;
};

export type GnplPaymentAllocation = {
  principalComponent: number;
  penaltyComponent: number;
  unapplied: number;
};

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function toPositiveInt(value: unknown, fallback: number) {
  const numeric = Math.floor(toNumber(value, fallback));
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

function toDate(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function normalizeGnplSettings(raw: any): GnplSettings {
  return {
    enabled: Boolean(raw?.gnpl_enabled),
    requireAdminApproval: raw?.gnpl_require_admin_approval !== false,
    defaultTermDays: toPositiveInt(raw?.gnpl_default_term_days, 14),
    penaltyEnabled: raw?.gnpl_penalty_enabled !== false,
    penaltyPercent: Math.max(0, Number(toNumber(raw?.gnpl_penalty_percent, 5).toFixed(2))),
    penaltyPeriodDays: toPositiveInt(raw?.gnpl_penalty_period_days, 7),
    reminderEnabled: raw?.gnpl_reminder_enabled !== false,
    reminderDaysBefore: Math.max(0, Math.floor(toNumber(raw?.gnpl_reminder_days_before, 0))),
  };
}

export function computeGnplAccountSnapshot(account: any, now = new Date()): GnplAccountSnapshot {
  const principalAmount = Math.max(
    0,
    Number(
      (
        toNumber(account?.approved_amount, toNumber(account?.base_amount, toNumber(account?.final_amount, 0))) || 0
      ).toFixed(2)
    )
  );
  const principalPaid = Math.max(0, Number(toNumber(account?.principal_paid, 0).toFixed(2)));
  const penaltyAccrued = Math.max(0, Number(toNumber(account?.penalty_accrued, 0).toFixed(2)));
  const penaltyPaid = Math.max(0, Number(toNumber(account?.penalty_paid, 0).toFixed(2)));

  const principalOutstanding = Math.max(0, Number((principalAmount - principalPaid).toFixed(2)));
  const penaltyOutstanding = Math.max(0, Number((penaltyAccrued - penaltyPaid).toFixed(2)));
  const totalDue = Math.max(0, Number((principalOutstanding + penaltyOutstanding).toFixed(2)));

  const dueDateObj = toDate(account?.due_date);
  const dueDate = dueDateObj ? dueDateObj.toISOString().slice(0, 10) : null;
  const overdueDays =
    dueDateObj && totalDue > 0
      ? Math.max(0, Math.floor((now.getTime() - dueDateObj.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;

  let status = String(account?.status || 'pending_approval').trim().toLowerCase() as GnplAccountStatus;
  if (status === 'approved' && overdueDays > 0 && totalDue > 0) {
    status = 'overdue';
  }
  if (totalDue <= 0 && ['approved', 'overdue', 'completed'].includes(status)) {
    status = 'completed';
  }

  return {
    principalAmount,
    principalPaid,
    principalOutstanding,
    penaltyAccrued,
    penaltyPaid,
    penaltyOutstanding,
    totalDue,
    status,
    dueDate,
    overdueDays,
  };
}

export function allocateGnplPayment(snapshot: GnplAccountSnapshot, rawAmount: unknown): GnplPaymentAllocation {
  const amount = Math.max(0, Number(toNumber(rawAmount, 0).toFixed(2)));
  if (amount <= 0) {
    return {
      principalComponent: 0,
      penaltyComponent: 0,
      unapplied: 0,
    };
  }

  const penaltyComponent = Math.min(amount, snapshot.penaltyOutstanding);
  const principalBudget = amount - penaltyComponent;
  const principalComponent = Math.min(principalBudget, snapshot.principalOutstanding);
  const unapplied = Math.max(0, Number((amount - penaltyComponent - principalComponent).toFixed(2)));

  return {
    principalComponent: Number(principalComponent.toFixed(2)),
    penaltyComponent: Number(penaltyComponent.toFixed(2)),
    unapplied,
  };
}

export function addDays(input: Date, days: number) {
  const out = new Date(input);
  out.setDate(out.getDate() + Math.floor(days));
  return out;
}

export function calculatePenaltyApplications(nextPenaltyAt: Date | null, now: Date, periodDays: number) {
  if (!nextPenaltyAt) {
    return { periods: 0, nextPenaltyAt: null as Date | null };
  }
  const safePeriodDays = Math.max(1, Math.floor(periodDays));
  if (nextPenaltyAt.getTime() > now.getTime()) {
    return { periods: 0, nextPenaltyAt };
  }

  const msPerPeriod = safePeriodDays * 24 * 60 * 60 * 1000;
  const diffMs = now.getTime() - nextPenaltyAt.getTime();
  const periods = Math.floor(diffMs / msPerPeriod) + 1;
  const advanced = new Date(nextPenaltyAt.getTime() + periods * msPerPeriod);
  return { periods, nextPenaltyAt: advanced };
}
