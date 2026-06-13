import axios from 'axios';
import { URL } from 'url';
import { Readable } from 'stream';
import * as dns from 'dns/promises';
import type { Express, Request, Response } from 'express';
import { headersToRemove } from '../lib/utils.js';

const PRIVATE_IP_RANGES = [
    { start: 0x0A000000, end: 0x0AFFFFFF },   // 10.0.0.0/8
    { start: 0x7F000000, end: 0x7FFFFFFF },   // 127.0.0.0/8 (loopback)
    { start: 0xA9FE0000, end: 0xA9FEFFFF },   // 169.254.0.0/16 (link-local)
    { start: 0xAC100000, end: 0xAC1FFFFF },   // 172.16.0.0/12
    { start: 0xC0A80000, end: 0xC0A8FFFF },   // 192.168.0.0/16
];

function ip4ToInt(ip: string): number {
    const parts = ip.split('.');
    return ((+parts[0] << 24) | (+parts[1] << 16) | (+parts[2] << 8) | (+parts[3])) >>> 0;
}

function isPrivateIP(ip: string): boolean {
    const m = ip.match(/^((?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]))\.((?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]))\.((?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]))\.((?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]))$/);
    if (!m) return false;
    const num = ip4ToInt(ip);
    return PRIVATE_IP_RANGES.some(r => num >= r.start && num <= r.end);
}

function isPrivateHostname(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (lower === 'localhost' || lower === '127.0.0.1' || lower === '0.0.0.0' || lower === '[::1]') return true;
    if (lower.endsWith('.internal') || lower.endsWith('.local')) return true;
    return false;
}

async function isValidProxyUrl(urlString: string): Promise<boolean> {
    try {
        const parsed = new URL(urlString);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        if (isPrivateHostname(parsed.hostname)) return false;

        const lookup = dns.lookup(parsed.hostname, { all: true });
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('DNS timeout')), 5000)
        );
        const addresses = await Promise.race([lookup, timeout]);
        for (const addr of addresses) {
            if (isPrivateIP(addr.address)) return false;
        }

        return true;
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
            return res.status(403).send('Invalid or disallowed image URL');
        }
        try {
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                }
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
        const path = req.params['0'] || '';
        const targetBaseUrl = req.headers['x-real-url'] as string | undefined;
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !await isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).send('Invalid or disallowed target URL');
        }

        const authorization = req.headers['x-real-authorization'] as string | undefined;
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = safeFinalUrl(targetBaseUrl, path);
        if (!finalUrl) {
            return res.status(403).send('Path traversal detected');
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
                responseType: 'stream'
            });

            res.set(response.headers as Record<string, string>);
            (response.data as Readable).pipe(res);

            res.on('close', () => {
                (response.data as Readable).destroy();
            });
        } catch (e: unknown) {
            if (axios.isAxiosError(e) && e.response) {
                const responseData = e.response.data as Readable | undefined;
                if (responseData?.pipe) {
                    const chunks: Buffer[] = [];
                    responseData.on('data', (c: Buffer) => chunks.push(c));
                    responseData.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8');
                        res.status(e.response.status).json({ error: body });
                    });
                } else {
                    res.status(e.response.status).json({ error: e.response.data });
                }
            } else if (axios.isAxiosError(e) && e.request) {
                res.status(504).json({ error: 'No response from target server.' });
            } else {
                res.status(500).json({ error: 'Error setting up request to target server.' });
            }
        }
    };

    const proxyGet = async (req: Request, res: Response) => {
        const path = req.params['0'] || '';
        const targetBaseUrl = req.headers['x-real-url'] as string | undefined;
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !await isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).send('Invalid or disallowed target URL');
        }

        const authorization = req.headers['x-real-authorization'] as string | undefined;
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = safeFinalUrl(targetBaseUrl, path);
        if (!finalUrl) {
            return res.status(403).send('Path traversal detected');
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
                }
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
        const path = req.params['0'] || '';
        const targetBaseUrl = req.headers['x-real-url'] as string | undefined;
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !await isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).send('Invalid or disallowed target URL');
        }

        const authorization = req.headers['x-real-authorization'] as string | undefined;
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = safeFinalUrl(targetBaseUrl, path);
        if (!finalUrl) {
            return res.status(403).send('Path traversal detected');
        }

        try {
            const response = await axios.delete(finalUrl, {
                headers: {
                    ...req.headers,
                    'Content-Type': 'application/json',
                    'Host': new URL(targetBaseUrl).hostname,
                    'Accept-Encoding': 'identity',
                    'Authorization': authorization
                }
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
    app.post('/proxy/*', proxyPost);
    app.get('/proxy', proxyGet);
    app.get('/proxy/*', proxyGet);
    app.delete('/proxy', proxyDelete);
    app.delete('/proxy/*', proxyDelete);
};
