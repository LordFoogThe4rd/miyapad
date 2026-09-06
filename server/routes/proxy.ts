import axios from 'axios';
import { URL } from 'url';
import { Readable } from 'stream';
import type { Express, Request, Response } from 'express';
import { headersToRemove } from '../lib/utils.js';

// ponytail: SSRF checks removed — private IP blocking broke local LLM backends.
// User considers hosting-on-unsecured-networks problems wontfix.
function isValidProxyUrl(urlString: string): boolean {
    try {
        const parsed = new URL(urlString);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function safeFinalUrl(targetBaseUrl: string, path: string): string | null {
    const finalUrl = path ? new URL(path, targetBaseUrl).href : targetBaseUrl;
    const baseParsed = new URL(targetBaseUrl);
    const finalParsed = new URL(finalUrl);

    if (finalParsed.origin !== baseParsed.origin) return null;

    const basePath = baseParsed.pathname;
    const finalPath = finalParsed.pathname;

    if (finalPath === basePath) return finalUrl;

    const baseDir = basePath.endsWith('/') ? basePath : basePath + '/';
    if (!finalPath.startsWith(baseDir)) return null;

    return finalUrl;
}

export default function(app: Express): void {
    app.get('/proxy-image', async (req: Request, res: Response) => {
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
                maxRedirects: 0,
            });
            res.set('Content-Type', response.headers['content-type'] as string);
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(Buffer.from(response.data as ArrayBuffer));
        } catch (e: unknown) {
            res.status(axios.isAxiosError(e) ? e.response?.status || 500 : 500).send('Failed to fetch image');
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
