// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getColumnName, normalizeStoreName } from './utils.js';
import { toKey } from '../routes/data.js';

describe('getColumnName', () => {
    it('maps each store to its own data column', () => {
        expect(getColumnName('sessions')).toBe('session_data');
        expect(getColumnName('templates')).toBe('template_data');
        expect(getColumnName('themes')).toBe('theme_data');
        expect(getColumnName('connections')).toBe('connection_data');
        expect(getColumnName('samplerpresets')).toBe('sampler_preset_data');
        expect(getColumnName('sessionhistory')).toBe('history_data');
    });

    it('falls back to "data" for a store without its own column', () => {
        expect(getColumnName('names')).toBe('data');
    });
});

describe('normalizeStoreName', () => {
    it('lowercases the name the client sends', () => {
        expect(normalizeStoreName('Sessions')).toBe('sessions');
        expect(normalizeStoreName('SamplerPresets')).toBe('samplerpresets');
        expect(normalizeStoreName('SessionHistory')).toBe('sessionhistory');
    });

    it('keeps only the first word', () => {
        expect(normalizeStoreName('Names extra')).toBe('names');
    });

    it('treats a missing name as the sessions store', () => {
        expect(normalizeStoreName('')).toBe('sessions');
    });

    it('refuses a store it does not know, so it never reaches SQL', () => {
        expect(normalizeStoreName('meta')).toBeNull();
        expect(normalizeStoreName('sessions;DROP')).toBeNull();
    });
});

describe('toKey', () => {
    it('turns a number into the string the TEXT key column holds', () => {
        expect(toKey(81)).toBe('81');
        expect(toKey('nextSessionId')).toBe('nextSessionId');
    });

    it('refuses anything that is not a string or a number', () => {
        for (const key of [undefined, null, {}, [1], true]) expect(toKey(key)).toBeNull();
    });
});
