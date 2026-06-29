import { promisify } from 'node:util';
import zlib from 'node:zlib';

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

const getColumnName = (storeName: string): string => {
    if (storeName === 'sessions') return 'session_data';
    if (storeName === 'templates') return 'template_data';
    if (storeName === 'themes') return 'theme_data';
    if (storeName === 'connections') return 'connection_data';
    return 'data';
};

const normalizeStoreName = (storeName: string): string | null => {
    if (!storeName) {
        return 'sessions';
    }
    const normalized = storeName.split(' ')[0].toLowerCase();
    if (['sessions', 'templates', 'names', 'themes', 'connections'].includes(normalized)) {
        return normalized;
    }
    return null;
};

const compressData = promisify(zlib.gzip);

const decompressData = (buffer: Buffer) =>
    (promisify(zlib.gunzip) as (buf: Buffer) => Promise<Buffer>)(buffer).then(b => b.toString());

export {
    headersToRemove,
    getColumnName,
    normalizeStoreName,
    compressData,
    decompressData
};
