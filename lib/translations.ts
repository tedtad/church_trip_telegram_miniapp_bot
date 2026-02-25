import en from '@/locales/en.json';
import am from '@/locales/am.json';

export type Language = 'en' | 'am';

const translations = {
  en,
  am,
};

export function getTranslation(lang: Language | string | undefined): typeof en {
  const language = lang === 'am' ? 'am' : 'en';
  return translations[language] as typeof en;
}

export function t(lang: Language | string | undefined, key: string, defaultValue?: string): string {
  const language = lang === 'am' ? 'am' : 'en';
  const trans = translations[language];
  
  const keys = key.split('.');
  let value: any = trans;
  
  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      return defaultValue || key;
    }
  }
  
  return typeof value === 'string' ? value : (defaultValue || key);
}

export const availableLanguages = {
  en: 'English',
  am: 'አማርኛ',
} as const;
