export const AVAILABLE_LOCALES = ['en'] as const;
export type LocaleCode = (typeof AVAILABLE_LOCALES)[number];
