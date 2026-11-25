import axios from 'axios';
import { URL } from 'url';
import { Readable } from 'stream';
import type { Express, Request, Response } from 'express';
import { headersToRemove } from '../lib/utils.js';

// ponytail: SSRF checks removed — private IP blocking broke local LLM backends.
// User considers hosting-on-unsecured-networks problems wontfix.
export function isValidProxyUrl(urlString: string): boolean {
    try {
        const parsed = new URL(urlString);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

export function safeFinalUrl(targetBaseUrl: string, path: string): string | null {
    const baseParsed = new URL(targetBaseUrl);
    const basePath = baseParsed.pathname;
    const baseDir = basePath.endsWith('/') ? basePath : basePath + '/';
    // Resolve against the base as a directory: against "https://aihorde.net/api", "v2/x"
    // would replace the "api" segment instead of going under it.
    const finalUrl = path ? new URL(path, new URL(baseDir, baseParsed)).href : targetBaseUrl;
    const finalParsed = new URL(finalUrl);

    if (finalParsed.origin !== baseParsed.origin) return null;

    const finalPath = finalParsed.pathname;

    if (finalPath === basePath) return finalUrl;

    if (!finalPath.startsWith(baseDir)) return null;

    return finalUrl;
}

export const MAX_PROXY_URL_REDIRECTS = 5;
export const MAX_PROXY_URL_BYTES = 10 * 1024 * 1024;

export default function(app: Express): void {
    // Named for what it does rather than for images alone: the plugins tab fetches plugin code through it too.
    app.get('/proxy-url', async (req: Request, res: Response) => {
        const imageUrl = req.query.url as string | undefined;
        if (!imageUrl) {
            return res.status(400).send('Missing url query parameter');
        }
        if (!await isValidProxyUrl(imageUrl)) {
            return res.status(403).json({ error: { message: 'Invalid or disallowed image URL' } });
        }
        try {
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                },
                maxRedirects: MAX_PROXY_URL_REDIRECTS,
                maxContentLength: MAX_PROXY_URL_BYTES,
                beforeRedirect: (options: { protocol?: string }) => {
                    if (options.protocol && !['http:', 'https:'].includes(options.protocol)) {
                        throw new Error('Disallowed redirect protocol');
                    }
                },
            });
            if (response.headers['content-type']) {
                res.set('Content-Type', response.headers['content-type'] as string);
            }
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(Buffer.from(response.data as ArrayBuffer));
        } catch (e: unknown) {
            if (axios.isAxiosError(e)) {
                if (e.code === 'ERR_BAD_RESPONSE' && /maxContentLength/i.test(e.message)) {
                    return res.status(413).send('Response exceeds size limit');
                }
                if (e.code === 'ERR_FR_TOO_MANY_REDIRECTS' || /Disallowed redirect protocol/i.test(e.message)) {
                    return res.status(502).send('Too many or disallowed redirects');
                }
                return res.status(e.response?.status || 502).send('Failed to fetch URL');
            }
            res.status(500).send('Failed to fetch URL');
        }
    });

    const proxyPost = async (req: Request, res: Response) => {
        const path = (req.params.splat as string[] | undefined)?.join('/') || '';
        const targetBaseUrl = req.headers['x-real-url'] as string | undefined;
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !await isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).json({ error: { message: 'Invalid or disallowed target URL' } });
        }

        const authorization = req.headers['x-real-authorization'] as string | undefined;
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = safeFinalUrl(targetBaseUrl, path);
        if (!finalUrl) {
            return res.status(403).json({ error: { message: 'Path traversal detected' } });
        }

        try {
            const response = await axios({
                method: 'post',
                url: finalUrl,
                data: req.body,
                headers: {
                    ...req.headers,
                    'Content-Type': 'application/json',
                    'Host': new URL(targetBaseUrl).hostname,
                    'Accept-Encoding': 'identity',
                    'Authorization': authorization
                },
                responseType: 'stream',
                maxRedirects: 0,
            });

            res.set(response.headers as Record<string, string>);
            (response.data as Readable).pipe(res);

            res.on('close', () => {
                (response.data as Readable).destroy();
            });
        } catch (e: unknown) {
            if (axios.isAxiosError(e) && e.response) {
                const responseData = e.response.data as Readable | undefined;
                const status = e.response.status;
                if (responseData?.pipe) {
                    const MAX_ERROR_BYTES = 10_240;
                    const chunks: Buffer[] = [];
                    let totalBytes = 0;
                    let aborted = false;

                    const cleanup = () => {
                        responseData.removeAllListeners('data');
                        responseData.removeAllListeners('end');
                        responseData.removeAllListeners('error');
                        responseData.destroy();
                    };

                    responseData.on('data', (c: Buffer) => {
                        totalBytes += c.length;
                        if (totalBytes > MAX_ERROR_BYTES) {
                            aborted = true;
                            cleanup();
                            if (!res.headersSent)
                                res.status(status).json({ error: 'Error response body too large' });
                        } else {
                            chunks.push(c);
                        }
                    });

                    responseData.on('end', () => {
                        if (!aborted) {
                            const body = Buffer.concat(chunks).toString('utf8');
                            res.status(status).json({ error: body });
                        }
                    });

                    responseData.on('error', () => {
                        cleanup();
                        if (!res.headersSent)
                            res.status(status).json({ error: 'Error reading error response body' });
                    });
                } else {
                    res.status(status).json({ error: e.response.data });
                }
            } else if (axios.isAxiosError(e) && e.request) {
                res.status(504).json({ error: 'No response from target server.' });
            } else {
                res.status(500).json({ error: 'Error setting up request to target server.' });
            }
        }
    };

    const proxyGet = async (req: Request, res: Response) => {
        const path = (req.params.splat as string[] | undefined)?.join('/') || '';
        const targetBaseUrl = req.headers['x-real-url'] as string | undefined;
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !await isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).json({ error: { message: 'Invalid or disallowed target URL' } });
        }

        const authorization = req.headers['x-real-authorization'] as string | undefined;
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = safeFinalUrl(targetBaseUrl, path);
        if (!finalUrl) {
            return res.status(403).json({ error: { message: 'Path traversal detected' } });
        }

        try {
            const response = await axios.get(finalUrl, {
                params: req.query,
                headers: {
                    ...req.headers,
                    'Content-Type': 'application/json',
                    'Host': new URL(targetBaseUrl).hostname,
                    'Accept-Encoding': 'identity',
                    'Authorization': authorization
                },
                maxRedirects: 0,
            });

            res.send(response.data);
        } catch (e: unknown) {
            if (axios.isAxiosError(e) && e.response) {
                res.status(e.response.status).json({ error: e.response.data });
            } else if (axios.isAxiosError(e) && e.request) {
                res.status(504).json({ error: 'No response from target server.' });
            } else {
                res.status(500).json({ error: 'Error setting up request to target server.' });
            }
        }
    };

    const proxyDelete = async (req: Request, res: Response) => {
        const path = (req.params.splat as string[] | undefined)?.join('/') || '';
        const targetBaseUrl = req.headers['x-real-url'] as string | undefined;
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !await isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).json({ error: { message: 'Invalid or disallowed target URL' } });
        }

        const authorization = req.headers['x-real-authorization'] as string | undefined;
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = safeFinalUrl(targetBaseUrl, path);
        if (!finalUrl) {
            return res.status(403).json({ error: { message: 'Path traversal detected' } });
        }

        try {
            const response = await axios.delete(finalUrl, {
                headers: {
                    ...req.headers,
                    'Content-Type': 'application/json',
                    'Host': new URL(targetBaseUrl).hostname,
                    'Accept-Encoding': 'identity',
                    'Authorization': authorization
                },
                maxRedirects: 0,
            });

            res.send(response.data);
        } catch (e: unknown) {
            if (axios.isAxiosError(e) && e.response) {
                res.status(e.response.status).json({ error: e.response.data });
            } else if (axios.isAxiosError(e) && e.request) {
                res.status(504).json({ error: 'No response from target server.' });
            } else {
                res.status(500).json({ error: 'Error setting up request to target server.' });
            }
        }
    };

    app.post('/proxy', proxyPost);
    app.post('/proxy/*splat', proxyPost);
    app.get('/proxy', proxyGet);
    app.get('/proxy/*splat', proxyGet);
    app.delete('/proxy', proxyDelete);
    app.delete('/proxy/*splat', proxyDelete);
};
