const axios = require('axios');
const { URL } = require('url');
const { headersToRemove } = require('../lib/utils');

const BLOCKED_HOSTS = new Set([
    'localhost', '127.0.0.1', '0.0.0.0', '[::1]',
    '10.0.0.0', '10.0.0.1',
    '172.16.0.0', '172.17.0.0', '172.18.0.0', '172.19.0.0',
    '172.20.0.0', '172.21.0.0', '172.22.0.0', '172.23.0.0',
    '172.24.0.0', '172.25.0.0', '172.26.0.0', '172.27.0.0',
    '172.28.0.0', '172.29.0.0', '172.30.0.0', '172.31.0.0',
    '192.168.0.0', '192.168.0.1',
]);

function isPrivateHostname(hostname) {
    const lower = hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(lower)) return true;
    if (lower.endsWith('.internal') || lower.endsWith('.local')) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(lower)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(lower)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(lower)) return true;
    return false;
}

function isValidProxyUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        if (isPrivateHostname(parsed.hostname)) return false;
        return true;
    } catch {
        return false;
    }
}

module.exports = function(app) {
    app.get('/proxy-image', async (req, res) => {
        const imageUrl = req.query.url;
        if (!imageUrl) {
            return res.status(400).send('Missing url query parameter');
        }
        if (!isValidProxyUrl(imageUrl)) {
            return res.status(403).send('Invalid or disallowed image URL');
        }
        try {
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                }
            });
            res.set('Content-Type', response.headers['content-type']);
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Cache-Control', 'public, max-age=86400');
            res.send(Buffer.from(response.data));
        } catch (error) {
            res.status(error.response?.status || 500).send('Failed to fetch image');
        }
    });

    const proxyPost = async (req, res) => {
        const path = req.params[0] || '';
        const targetBaseUrl = req.headers['x-real-url'];
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).send('Invalid or disallowed target URL');
        }

        const authorization = req.headers['x-real-authorization'];
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = path ? new URL(path, targetBaseUrl).href : targetBaseUrl;
        const baseOrigin = new URL(targetBaseUrl).origin;
        const basePath = new URL(targetBaseUrl).pathname;
        if (!finalUrl.startsWith(baseOrigin + basePath)) {
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

            res.set(response.headers);
            response.data.pipe(res);

            res.on('close', () => {
                response.data.destroy();
            });
        } catch (error) {
            if (error.response) {
                if (error.response.data?.pipe) {
                    const chunks = [];
                    error.response.data.on('data', c => chunks.push(c));
                    error.response.data.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf8');
                        res.status(error.response.status).json({ error: body });
                    });
                } else {
                    res.status(error.response.status).json({ error: error.response.data });
                }
            } else if (error.request) {
                res.status(504).json({ error: 'No response from target server.' });
            } else {
                res.status(500).json({ error: 'Error setting up request to target server.' });
            }
        }
    };

    const proxyGet = async (req, res) => {
        const path = req.params[0] || '';
        const targetBaseUrl = req.headers['x-real-url'];
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).send('Invalid or disallowed target URL');
        }

        const authorization = req.headers['x-real-authorization'];
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = path ? new URL(path, targetBaseUrl).href : targetBaseUrl;
        const baseOrigin = new URL(targetBaseUrl).origin;
        const basePath = new URL(targetBaseUrl).pathname;
        if (!finalUrl.startsWith(baseOrigin + basePath)) {
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
        } catch (error) {
            if (error.response) {
                res.status(error.response.status).json({ error: error.response.data });
            } else if (error.request) {
                res.status(504).json({ error: 'No response from target server.' });
            } else {
                res.status(500).json({ error: 'Error setting up request to target server.' });
            }
        }
    };

    const proxyDelete = async (req, res) => {
        const path = req.params[0] || '';
        const targetBaseUrl = req.headers['x-real-url'];
        delete req.headers['x-real-url'];

        if (!targetBaseUrl || !isValidProxyUrl(targetBaseUrl)) {
            return res.status(403).send('Invalid or disallowed target URL');
        }

        const authorization = req.headers['x-real-authorization'];
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = path ? new URL(path, targetBaseUrl).href : targetBaseUrl;
        const baseOrigin = new URL(targetBaseUrl).origin;
        const basePath = new URL(targetBaseUrl).pathname;
        if (!finalUrl.startsWith(baseOrigin + basePath)) {
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
        } catch (error) {
            if (error.response) {
                res.status(error.response.status).json({ error: error.response.data });
            } else if (error.request) {
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
