const axios = require('axios');
const { headersToRemove } = require('../lib/utils');

module.exports = function(app) {
    app.get('/proxy-image', async (req, res) => {
        const imageUrl = req.query.url;
        if (!imageUrl) {
            return res.status(400).send('Missing url query parameter');
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

        const authorization = req.headers['x-real-authorization'];
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = path ? `${targetBaseUrl}/${path}` : targetBaseUrl;

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
                if (error.response.data.pipe !== undefined) {
                    error.response.data.pipe(res.status(error.response.status));
                } else {
                    res.status(error.response.status).send(error.response.data);
                }
            } else if (error.request) {
                res.status(504).send('No response from target server.');
            } else {
                res.status(500).send(`Error setting up request to target server: ${error.message}`);
            }
        }
    };

    const proxyGet = async (req, res) => {
        const path = req.params[0] || '';
        const targetBaseUrl = req.headers['x-real-url'];
        delete req.headers['x-real-url'];

        const authorization = req.headers['x-real-authorization'];
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = path ? `${targetBaseUrl}/${path}` : targetBaseUrl;

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
                res.status(error.response.status).send(error.response.data);
            } else if (error.request) {
                res.status(504).send('No response from target server.');
            } else {
                res.status(500).send(`Error setting up request to target server: ${error.message}`);
            }
        }
    };

    const proxyDelete = async (req, res) => {
        const path = req.params[0] || '';
        const targetBaseUrl = req.headers['x-real-url'];
        delete req.headers['x-real-url'];

        const authorization = req.headers['x-real-authorization'];
        delete req.headers['x-real-authorization'];

        headersToRemove.forEach(header => {
            delete req.headers[header.toLowerCase()];
        });

        const finalUrl = path ? `${targetBaseUrl}/${path}` : targetBaseUrl;

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
                res.status(error.response.status).send(error.response.data);
            } else if (error.request) {
                res.status(504).send('No response from target server.');
            } else {
                res.status(500).send(`Error setting up request to target server: ${error.message}`);
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
