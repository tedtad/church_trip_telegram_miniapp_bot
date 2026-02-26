import { EthDateTime } from 'ethiopian-calendar-date-converter';

export type LocalizedLang = 'en' | 'am';
type DateLike = string | number | Date | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function twoDigits(value: number) {
  return String(value).padStart(2, '0');
}

export function formatYmd(date: Date) {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function normalizeEthiopianYmdInput(value: string) {
  const cleaned = String(value || '').trim().replace(/[/.]/g, '-');
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 13) return null;
  if (day < 1 || day > 30) return null;
  if (month === 13 && day > 6) return null;

  return { year, month, day };
}

export function ethiopianToGregorianYmd(value: string) {
  const parsed = normalizeEthiopianYmdInput(value);
  if (!parsed) return null;

  try {
    const converted = new EthDateTime(parsed.year, parsed.month, parsed.day).toEuropeanDate();
    return Number.isNaN(converted.getTime()) ? null : formatYmd(converted);
  } catch {
    return null;
  }
}

export function gregorianToEthiopianYmd(value: DateLike) {
  const date = toDate(value);
  if (!date) return '';

  try {
    const eth = EthDateTime.fromEuropeanDate(date);
    return `${String(eth.year).padStart(4, '0')}-${twoDigits(eth.month)}-${twoDigits(eth.date)}`;
  } catch {
    return '';
  }
}

export function formatLocalizedDateTime(
  value: DateLike,
  lang: LocalizedLang = 'en',
  naText = 'N/A',
  options?: { includeTime?: boolean }
) {
  const date = toDate(value);
  if (!date) return naText;

  const includeTime = options?.includeTime !== false;
  if (lang === 'am') {
    try {
      const eth = EthDateTime.fromEuropeanDate(date);
      const etDate = `${String(eth.year).padStart(4, '0')}-${twoDigits(eth.month)}-${twoDigits(eth.date)}`;
      if (!includeTime) return etDate;
      return `${etDate} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
    } catch {
      return includeTime ? date.toLocaleString('am-ET') : date.toLocaleDateString('am-ET');
    }
  }

  return includeTime ? date.toLocaleString('en-US') : date.toLocaleDateString('en-US');
}
