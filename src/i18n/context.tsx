import { html } from 'htm/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './en.json';
import { AVAILABLE_LOCALES, type LocaleCode } from './locales';

type TranslationKey = keyof typeof en;

const I18nContext = createContext<Record<string, string>>(en);

export function I18nProvider({ locale = 'en', children }: { locale?: string; children: ReactNode }) {
	const [strings, setStrings] = useState<Record<string, string>>(en);

	useEffect(() => {
		let cancelled = false;
		if (locale === 'en' || !AVAILABLE_LOCALES.includes(locale as LocaleCode)) {
			setStrings(en);
			return;
		}
		import(`./${locale}.json`)
			.then(mod => { if (!cancelled) setStrings({ ...en, ...mod.default }); })
			.catch(() => {
				if (!cancelled) {
					console.warn(`Locale '${locale}' not found, falling back to en`);
					setStrings(en);
				}
			});
		return () => { cancelled = true; };
	}, [locale]);

	return html`<${I18nContext.Provider} value=${strings}>${children}</${I18nContext.Provider}>`;
}

export function useT() {
	const strings = useContext(I18nContext);
	return useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
		let result: string = strings[key] ?? key;
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				result = result.replaceAll(`{{${k}}}`, () => String(v));
			}
		}
		return result;
	}, [strings]);
}
