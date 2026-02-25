export type Language = 'en' | 'am';

export const languages = {
  en: 'English',
  am: 'አማርኛ (Amharic)',
} as const;

export const defaultLanguage: Language = 'en';
