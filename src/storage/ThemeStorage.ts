import { AbstractStorage } from './AbstractStorage';
import { defaultThemes } from '../defaults/themes';
import { isThemeData } from './validators';

export class ThemeStorage extends AbstractStorage {
    themes: Record<string, ThemeData> = {};

    constructor(dbAdapter: DatabaseAdapter) {
        super('Themes', dbAdapter);
    }

    async init() {
        const db = await this.openDatabase();
        await this.loadThemes(db);

        // If the DB is empty, populate with default themes.
        if (Object.keys(this.themes).length === 0) {
            await this.performFullSave(defaultThemes);
            return;
        }

        // For existing users, check for new or updated default themes.
        const updatedThemes = { ...this.themes };
        let themesWereModified = false;

        for (const themeName in defaultThemes) {
            const defaultTheme = (defaultThemes as Record<string, ThemeData>)[themeName];
            const userTheme = updatedThemes[themeName];

            if (!userTheme) {
            	// A new default theme is missing from the user's storage.
                updatedThemes[themeName] = defaultTheme;
                themesWereModified = true;
                continue;
            }

            if (defaultTheme.isDefault && userTheme.isDefault) {
                if (userTheme.css !== defaultTheme.css) {
            		// An existing theme is a default theme, and its CSS has changed in the code.
                    updatedThemes[themeName] = defaultTheme;
                    themesWereModified = true;
                }
            }
        }

        if (themesWereModified) {
            await this.performFullSave(updatedThemes);
        }
    }

    async performFullSave(newThemes: Record<string, ThemeData>) {
        const db = await this.openDatabase();

        for (const key of Object.keys(this.themes)) {
            if (!Object.hasOwn(newThemes, key)) {
                await this.deleteFromDatabase(db, key);
            }
        }

        for (const [key, value] of Object.entries(newThemes)) {
            if (JSON.stringify(value) !== JSON.stringify(this.themes[key])) {
                await this.saveToDatabase(db, key, value);
            }
        }

        this.themes = newThemes;
        this.dispatchChangeEvent();
    }

	getStorageData(): Record<string, ThemeData> {
		return this.themes;
	}

    async loadThemes(db: DbConnection) {
        const raw = await this.loadAllFromDatabase(db);
        this.themes = {};
        for (const [key, value] of Object.entries(raw)) {
            if (isThemeData(value)) {
                this.themes[key] = value;
            } else {
                console.warn(`[ThemeStorage] Skipped invalid entry: ${key}`);
            }
        }
    }
}
