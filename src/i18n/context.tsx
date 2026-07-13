import { html } from 'htm/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './en.json';
import { AVAILABLE_LOCALES, type LocaleCode } from './locales';

type TranslationKey = keyof typeof en;

const I18nContext = createContext<Record<string, string>>(en);

export function I18nProvider({ locale = 'en', children }: { locale?: string; children: ReactNode }) {
	const [strings, setStrings] = useState<Record<string, string>>(en);

	useEffect(() => {
		if (locale === 'en' || !AVAILABLE_LOCALES.includes(locale as LocaleCode)) {
			setStrings(en);
			return;
		}
		import(`./${locale}.json`)
			.then(mod => setStrings(mod.default))
			.catch(() => {
				console.warn(`Locale '${locale}' not found, falling back to en`);
				setStrings(en);
			});
	}, [locale]);

	return html`<${I18nContext.Provider} value=${strings}>${children}</${I18nContext.Provider}>`;
}

export function useT() {
	const strings = useContext(I18nContext);
	return (key: TranslationKey): string => strings[key] ?? key;
}
