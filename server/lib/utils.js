const zlib = require('zlib');

const headersToRemove = [
    'content-length',
    'cdn-loop',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto'
];

const getColumnName = (storeName) => {
    if (storeName === 'sessions') return 'session_data';
    if (storeName === 'templates') return 'template_data';
    if (storeName === 'themes') return 'theme_data';
    return 'data';
};

const normalizeStoreName = (storeName) => {
    if (!storeName) {
        return 'sessions';
    }
    const normalized = storeName.split(' ')[0].toLowerCase();
    if (['sessions', 'templates', 'names', 'themes'].includes(normalized)) {
        return normalized;
    }
    return null;
};

const compressData = (data) => {
    return new Promise((resolve, reject) => {
        zlib.gzip(data, (err, buffer) => {
            if (err) return reject(err);
            resolve(buffer);
        });
    });
};

const decompressData = (buffer) => {
    return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, decompressed) => {
            if (err) return reject(err);
            resolve(decompressed.toString());
        });
    });
};

module.exports = {
    headersToRemove,
    getColumnName,
    normalizeStoreName,
    compressData,
    decompressData
};
