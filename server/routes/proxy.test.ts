// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isValidProxyUrl, safeFinalUrl } from './proxy.js';

describe('isValidProxyUrl', () => {
    it('accepts http and https, including local backends', () => {
        expect(isValidProxyUrl('http://127.0.0.1:5001')).toBe(true);
        expect(isValidProxyUrl('https://api.openai.com/v1')).toBe(true);
    });

    it('refuses other protocols', () => {
        expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
        expect(isValidProxyUrl('ftp://example.com')).toBe(false);
        expect(isValidProxyUrl('javascript:alert(1)')).toBe(false);
    });

    it('refuses something that is not a URL', () => {
        expect(isValidProxyUrl('')).toBe(false);
        expect(isValidProxyUrl('localhost:5001')).toBe(false);
    });
});

describe('safeFinalUrl', () => {
    it('returns the base itself when there is no path', () => {
        expect(safeFinalUrl('http://h:5001/v1', '')).toBe('http://h:5001/v1');
    });

    it('appends a path to a root base', () => {
        expect(safeFinalUrl('http://h:5001', 'v1/completions')).toBe('http://h:5001/v1/completions');
    });

    it('appends a path under a base that ends in a slash', () => {
        expect(safeFinalUrl('http://h/api/', 'v1/generate')).toBe('http://h/api/v1/generate');
    });

    it('keeps the path of a base that does not end in a slash', () => {
        expect(safeFinalUrl('https://aihorde.net/api', 'v2/status/models')).toBe('https://aihorde.net/api/v2/status/models');
        expect(safeFinalUrl('https://openrouter.ai/api', 'v1/chat/completions')).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('refuses to climb out of the base path with ..', () => {
        expect(safeFinalUrl('http://h/api', '../admin')).toBeNull();
        expect(safeFinalUrl('http://h/api/', '../admin')).toBeNull();
        expect(safeFinalUrl('http://h/api/', 'v1/../../admin')).toBeNull();
    });

    it('refuses an encoded .. too, since URL parsing decodes it', () => {
        expect(safeFinalUrl('http://h/api/', '%2e%2e/admin')).toBeNull();
        expect(safeFinalUrl('http://h/api/', '.%2E/admin')).toBeNull();
    });

    it('refuses a path that switches to another host', () => {
        expect(safeFinalUrl('http://h/', '//evil.example/x')).toBeNull();
        expect(safeFinalUrl('http://h/', 'http://evil.example/x')).toBeNull();
    });

    it('refuses a path that only shares a prefix with the base directory', () => {
        expect(safeFinalUrl('http://h/v1/', '/v1x/models')).toBeNull();
    });

    it('allows an absolute path on the same origin when the base is the root', () => {
        expect(safeFinalUrl('http://h:5001', '/v1/models')).toBe('http://h:5001/v1/models');
    });
});
