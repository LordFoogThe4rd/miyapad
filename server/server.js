const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3');
const path = require('path');
const minimist = require('minimist');
const axios = require('axios');
const open = require('open');
const zlib = require('zlib');
const tokenizer = require('./tokenizer');

const app = express();

// Parse command line arguments
const args = minimist(process.argv.slice(2));
// Default fallbacks: command line args -> environment variables -> static defaults
const port = args.port || process.env.MIKUPAD_PORT || 3000;
const host = args.host || process.env.MIKUPAD_HOST || '0.0.0.0';
const noOpen = (args.open !== undefined && !args.open) || process.env.MIKUPAD_NO_OPEN;
const login = args.login || process.env.MIKUPAD_LOGIN || 'anon';
const password = args.password || process.env.MIKUPAD_PASSWORD || undefined;
const storagePath = args.storagePath || process.env.MIKUPAD_STORAGE_PATH || './web-session-storage.db';

// Headers that shouldn't be forwarded in the proxy endpoint.
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

// Server API version
const SERVER_VERSION = 4;

app.use(cors(), bodyParser.json({limit: "100mb"}));

// authentication middleware
app.use((req, res, next) => {
    if (!password) {
        // No password defined, access granted.
        return next();
    }

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [reqLogin, reqPassword] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (reqLogin == login && reqPassword == password) {
        // Access granted.
        return next();
    }

    // Access denied.
    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Authentication required.');
});

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

const runMigrationToV3 = (db) => {
    return new Promise((resolve, reject) => {
        // Check if the 'sessions' table exists and the 'names' table doesn't to determine if a 2->3 migration is needed.
        const migrationCheckSql = `
            SELECT 'migration_needed' as status
            FROM sqlite_master
            WHERE type = 'table' AND name = 'sessions'
              AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'names');
        `;
        
        db.get(migrationCheckSql, (err, row) => {
            if (err) {
                return reject(err);
            }

            if (row) {
                // This is a V2 database. We need to extract names and compress data.
                db.serialize(async () => {
                    try {
                        const migrateTable = async (tableName, processRow) => {
                            await new Promise((res, rej) => db.run(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`, (err) => err ? rej(err) : res()));
                            await new Promise((res, rej) => db.run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, data BLOB)`, (err) => err ? rej(err) : res()));
                            const rows = await new Promise((res, rej) => db.all(`SELECT key, data FROM ${tableName}_old`, [], (err, rows) => err ? rej(err) : res(rows)));
                            for (const row of rows) {
                                await processRow(row);
                            }
                            await new Promise((res, rej) => db.run(`DROP TABLE ${tableName}_old`, (err) => err ? rej(err) : res()));
                        };

                        db.run("BEGIN TRANSACTION;");
                        
                        await new Promise((res, rej) => db.run(`CREATE TABLE names (key TEXT PRIMARY KEY, data TEXT);`, (err) => err ? rej(err) : res()));

                        await migrateTable('sessions', async (row) => {
                            const sessionData = JSON.parse(row.data);
                            const sessionName = sessionData.name;

                            if (sessionName) {
                                await new Promise((res, rej) => db.run("INSERT INTO names (key, data) VALUES (?, ?)", [row.key, sessionName], (err) => err ? rej(err) : res()));
                                delete sessionData.name;
                            }

                            const compressedData = await compressData(JSON.stringify(sessionData));
                            await new Promise((res, rej) => db.run("INSERT INTO sessions (key, data) VALUES (?, ?)", [row.key, compressedData], (err) => err ? rej(err) : res()));
                        });

                        await migrateTable('templates', async (row) => {
                            const compressedData = await compressData(row.data);
                            await new Promise((res, rej) => db.run("INSERT INTO templates (key, data) VALUES (?, ?)", [row.key, compressedData], (err) => err ? rej(err) : res()));
                        });

                        db.run("COMMIT;", (err) => {
                            if (err) {
                                return reject(err);
                            }
                            // Migration was successful!
                            resolve(true);
                        });

                    } catch (e) {
                        db.run("ROLLBACK;");
                        reject(e);
                    }
                });
            } else {
                // This is already a V3 db, no migration needed.
                resolve(false);
            }
        });
    });
};

const enableTransparentCompressionIfMissing = (db, tableName) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [`_${tableName}_zstd`], (err, row) => {
            if (err) return reject(err);
            if (row) {
                // Transparent compression is already enabled
                return resolve();
            }
            const colName = getColumnName(tableName);
            console.log(`Enabling transparent zstd compression for table: ${tableName} (column: ${colName})...`);
            const config = JSON.stringify({
                table: tableName,
                column: colName,
                compression_level: 3,
                dict_chooser: "'a'"
            });
            db.run(`SELECT zstd_enable_transparent(?)`, [config], (err) => {
                if (err) {
                    console.error(`Failed to enable transparent compression for ${tableName}:`, err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
};

const runMigrationToV4 = (db) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT value FROM meta WHERE key = 'version'", async (err, row) => {
            if (err) {
                // If meta table doesn't exist, this is a new database.
                return resolve(false);
            }
            
            const version = row ? parseInt(row.value, 10) : 1;
            if (version >= 4) {
                return resolve(false);
            }

            console.log(`Migrating database from version ${version} to 4 (sqlite-zstd transparent compression)...`);
            
            try {
                const migrateTableToZstd = async (tableName) => {
                    const colName = getColumnName(tableName);
                    
                    // Check if table exists
                    const tableExists = await new Promise((res, rej) => {
                        db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName], (err, row) => {
                            if (err) rej(err);
                            else res(!!row);
                        });
                    });

                    if (!tableExists) {
                        await new Promise((res, rej) => db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`, (err) => err ? rej(err) : res()));
                        return;
                    }

                    // Check what columns the table currently has. If it already has the new column name, we don't need to rename it, but we might still need to migrate from V3.
                    const hasOldColumnName = await new Promise((res, rej) => {
                        db.all(`PRAGMA table_info(${tableName})`, [], (err, infoRows) => {
                            if (err) return rej(err);
                            const hasOld = infoRows.some(info => info.name === 'data');
                            res(hasOld);
                        });
                    });

                    let oldColName = hasOldColumnName ? 'data' : colName;

                    // Read all old rows
                    const rows = await new Promise((res, rej) => {
                        db.all(`SELECT key, ${oldColName} FROM ${tableName}`, [], (err, rows) => err ? rej(err) : res(rows));
                    });

                    console.log(`Migrating ${rows.length} rows from table ${tableName}...`);

                    // Decompress old Gzipped rows
                    const decompressedRows = [];
                    for (const row of rows) {
                        let decompressed;
                        try {
                            decompressed = await decompressData(row[oldColName]);
                        } catch (e) {
                            decompressed = row[oldColName] ? row[oldColName].toString() : '';
                        }
                        decompressedRows.push({ key: row.key, data: decompressed });
                    }

                    // Drop old table
                    await new Promise((res, rej) => db.run(`DROP TABLE ${tableName}`, (err) => err ? rej(err) : res()));

                    // Recreate empty table with the new column name
                    await new Promise((res, rej) => db.run(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, ${colName} BLOB)`, (err) => err ? rej(err) : res()));

                    // Enable transparent compression using sqlite-zstd
                    const config = JSON.stringify({
                        table: tableName,
                        column: colName,
                        compression_level: 3,
                        dict_chooser: "'a'"
                    });
                    await new Promise((res, rej) => db.run(`SELECT zstd_enable_transparent(?)`, [config], (err) => err ? rej(err) : res()));

                    // Insert the uncompressed data back
                    if (decompressedRows.length > 0) {
                        await new Promise((res, rej) => db.run("BEGIN TRANSACTION", (err) => err ? rej(err) : res()));
                        try {
                            for (const row of decompressedRows) {
                                await new Promise((res, rej) => db.run(`INSERT INTO ${tableName} (key, ${colName}) VALUES (?, ?)`, [row.key, row.data], (err) => err ? rej(err) : res()));
                            }
                            await new Promise((res, rej) => db.run("COMMIT", (err) => err ? rej(err) : res()));
                        } catch (insertErr) {
                            await new Promise((res) => db.run("ROLLBACK", () => res()));
                            throw insertErr;
                        }
                    }
                };

                await migrateTableToZstd('sessions');
                await migrateTableToZstd('templates');
                await migrateTableToZstd('themes');

                // Run initial maintenance to train dictionaries and compress data
                console.log("Running initial zstd incremental maintenance (training dictionaries)...");
                await new Promise((res, rej) => db.run(`SELECT zstd_incremental_maintenance(null, 1)`, (err) => err ? rej(err) : res()));

                resolve(true);
            } catch (e) {
                reject(e);
            }
        });
    });
};

const startBackgroundMaintenance = (db) => {
    console.log("Scheduling background zstd incremental maintenance every 5 minutes.");
    setInterval(() => {
        db.run("SELECT zstd_incremental_maintenance(null, 1)", (err) => {
            if (err) {
                console.error("Error running background zstd_incremental_maintenance:", err.message);
            }
        });
    }, 5 * 60 * 1000);
};


const configureAutoVacuum = (db) => {
    return new Promise((resolve) => {
        db.get('PRAGMA auto_vacuum', (err, row) => {
            if (err || !row || row.auto_vacuum !== 0) {
                return resolve();
            }

            console.log('Enabling SQLite auto_vacuum mode...');
            db.serialize(() => {
                db.run('PRAGMA auto_vacuum = FULL');
                db.run('VACUUM', (err) => {
                    if (err) {
                        console.error('Failed to run VACUUM for auto_vacuum:', err.message);
                    } else {
                        console.log('Database auto_vacuum enabled successfully.');
                    }
                    resolve();
                });
            });
        });
    });
};


// Open a database connection
const db = new sqlite3.Database(storagePath, (err) => {
    if (err) {
        console.error(err.message);
        process.exit(1);
    }

    const zstdLibName = {
        'win32': 'sqlite_zstd.dll',
        'darwin': 'libsqlite_zstd.dylib',
        'linux': 'libsqlite_zstd.so'
    }[process.platform] || 'libsqlite_zstd.so';
    db.loadExtension(path.join(__dirname, zstdLibName), (err) => {
        if (err) {
            console.error('Failed to load sqlite-zstd extension:', err.message);
            process.exit(1);
        }
        console.log('sqlite-zstd extension loaded successfully.');

        // Check if database is brand new by seeing if the 'sessions' table exists before we create anything
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'", (err, row) => {
            if (err) {
                console.error("Failed to query database schema:", err.message);
                process.exit(1);
            }

            const isNewDatabase = !row;

            configureAutoVacuum(db).then(() => {
                const initTables = () => {
                    return new Promise((res, rej) => {
                        db.serialize(() => {
                            const sessionCol = getColumnName('sessions');
                            const templateCol = getColumnName('templates');
                            const themeCol = getColumnName('themes');
                            db.run(`CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, ${sessionCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS templates (key TEXT PRIMARY KEY, ${templateCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS themes (key TEXT PRIMARY KEY, ${themeCol} BLOB)`);
                            db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`, (err) => {
                                if (err) rej(err);
                                else res();
                            });
                        });
                    });
                };

                initTables().then(() => {
                    let migrationPromise;
                    if (isNewDatabase) {
                        console.log('Initializing brand new database at version 4 schema...');
                        migrationPromise = Promise.resolve();
                    } else {
                        migrationPromise = runMigrationToV3(db).then((didMigrateV3) => {
                            if (didMigrateV3) {
                                console.log('Successfully migrated database to version 3.');
                            }
                            return runMigrationToV4(db);
                        }).then((didMigrateV4) => {
                            if (didMigrateV4) {
                                console.log('Running VACUUM after migration to compact database...');
                                return new Promise((res) => {
                                    db.run('VACUUM', (err) => {
                                        if (err) console.error('Failed to run post-migration VACUUM:', err.message);
                                        res();
                                    });
                                });
                            }
                        });
                    }

                    return migrationPromise.then(() => {
                        return Promise.all([
                            enableTransparentCompressionIfMissing(db, 'sessions'),
                            enableTransparentCompressionIfMissing(db, 'templates'),
                            enableTransparentCompressionIfMissing(db, 'themes')
                        ]);
                    }).then(() => {
                        return new Promise((res, rej) => {
                            db.serialize(() => {
                                db.run(`CREATE TABLE IF NOT EXISTS names (key TEXT PRIMARY KEY, data TEXT)`);
                                db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('version', 4)`, (err) => {
                                    if (err) rej(err);
                                    else res();
                                });
                            });
                        });
                    }).then(() => {
                        startBackgroundMaintenance(db);
                    });
                }).catch((err) => {
                    console.error("Migration/Initialization failed:", err.message);
                    process.exit(1);
                });
            });
        });
    });
});

// Serve static assets from the Parcel build output
app.use(express.static(path.join(__dirname, '..', 'dist')));

// GET route to serve Mikupad html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'mikupad.html'));
});

// GET route to get the server version
app.get('/version', (req, res) => {
    res.json({
        version: SERVER_VERSION,
        features: { zstd_compression: true, server_tokenizer: true },
        tokenizers: tokenizer.getAvailableTokenizers()
    });
});

// GET route to run VACUUM on the database
app.get('/vacuum', (req, res) => {
    db.run('VACUUM', (err) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error running VACUUM: ' + err.message });
        } else {
            res.json({ ok: true, message: 'VACUUM completed successfully' });
        }
    });
});

// GET route to get zstd transparent compression configurations
app.get('/zstd_get_configs', (req, res) => {
    db.all('SELECT id, config FROM _zstd_configs', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ ok: false, message: 'Error querying zstd configs: ' + err.message });
        }
        const configs = {};
        rows.forEach((row) => {
            try {
                configs[row.id] = JSON.parse(row.config);
            } catch (_) {
                configs[row.id] = row.config;
            }
        });
        res.json({ ok: true, configs });
    });
});

// POST route to enable transparent compression on a table
app.post('/zstd_enable_transparent', (req, res) => {
    const { table, column, compression_level, train_dict_samples_ratio } = req.body;
    const config = JSON.stringify({
        table: table || 'sessions',
        column: column || getColumnName(table || 'sessions'),
        compression_level: compression_level || 3,
        dict_chooser: "'a'",
        ...(train_dict_samples_ratio ? { train_dict_samples_ratio } : {})
    });
    db.run('SELECT zstd_enable_transparent(?)', [config], (err) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error enabling transparent compression: ' + err.message });
        } else {
            res.json({ ok: true, message: 'Transparent compression enabled' });
        }
    });
});

// POST route to update transparent compression settings
app.post('/zstd_update_transparent', (req, res) => {
    const { compression_level, train_dict_samples_ratio } = req.body;
    const patch = {};
    if (compression_level !== undefined) patch.compression_level = compression_level;
    if (train_dict_samples_ratio !== undefined) patch.train_dict_samples_ratio = train_dict_samples_ratio;
    db.run('UPDATE _zstd_configs SET config = json_patch(config, ?)', [JSON.stringify(patch)], function(err) {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error updating compression config: ' + err.message });
        } else {
            res.json({ ok: true, message: 'Compression config updated', changes: this.changes });
        }
    });
});

// POST route to run zstd incremental maintenance
app.post('/zstd_incremental_maintenance', (req, res) => {
    const { duration, db_load } = req.body;
    const durationArg = duration !== undefined && duration !== null ? duration : 'null';
    const dbLoadArg = db_load !== undefined ? db_load : 1.0;
    db.run(`SELECT zstd_incremental_maintenance(${durationArg}, ${dbLoadArg})`, (err) => {
        if (err) {
            res.status(500).json({ ok: false, message: 'Error running maintenance: ' + err.message });
        } else {
            res.json({ ok: true, message: 'Maintenance completed' });
        }
    });
});

// Image proxy route - fetches images server-side to avoid CORS issues
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

// GET route to list available tokenizers
app.get('/api/v1/tokenizers', (req, res) => {
    try {
        const available = tokenizer.getAvailableTokenizers();
        res.json({ ok: true, tokenizers: available, loaded: tokenizer.getLoadedModel() });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// POST route to load a tokenizer
app.post('/api/v1/tokenizer/load', async (req, res) => {
    const { model } = req.body;
    if (!model) {
        return res.status(400).json({ ok: false, message: 'Missing model parameter' });
    }
    try {
        await tokenizer.loadTokenizer(model);
        res.json({ ok: true, model });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// POST route to count tokens
app.post('/api/v1/token-count', async (req, res) => {
    const { content } = req.body;
    if (content === undefined || content === null) {
        return res.status(400).json({ ok: false, message: 'Missing content parameter' });
    }
    try {
        const count = await tokenizer.tokenCount(content);
        res.json({ ok: true, count });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// POST route to tokenize
app.post('/api/v1/tokenize', async (req, res) => {
    const { content } = req.body;
    if (content === undefined || content === null) {
        return res.status(400).json({ ok: false, message: 'Missing content parameter' });
    }
    try {
        const { ids, tokens } = await tokenizer.tokenize(content);
        res.json({ ok: true, ids, strings: tokens });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// POST route to detokenize
app.post('/api/v1/detokenize', async (req, res) => {
    const { tokens: tokenIds } = req.body;
    if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
        return res.status(400).json({ ok: false, message: 'Missing or invalid tokens parameter' });
    }
    try {
        const content = await tokenizer.detokenize(tokenIds);
        res.json({ ok: true, content });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

// Dynamic POST proxy route
app.post('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    // Proxy authorization (since we use authorization headers as well)
    const authorization = req.headers['x-real-authorization'];
    delete req.headers['x-real-authorization'];

    headersToRemove.forEach(header => {
        delete req.headers[header.toLowerCase()];
    });

    try {
        const response = await axios({
            method: 'post',
            url: `${targetBaseUrl}/${path}`,
            data: req.body,
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname,  // Update the Host header for the target server
                'Accept-Encoding': 'identity',
                'Authorization': authorization
            },
            responseType: 'stream'
        });

        // Proxy the headers
        res.set(response.headers);

        // Proxy stream requests
        response.data.pipe(res);

        // Stop stream requests if the connection is aborted on the other end
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
});

// Dynamic GET proxy route
app.get('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    // Proxy authorization (since we use authorization headers as well)
    const authorization = req.headers['x-real-authorization'];
    delete req.headers['x-real-authorization'];

    headersToRemove.forEach(header => {
        delete req.headers[header.toLowerCase()];
    });

    try {
        const response = await axios.get(`${targetBaseUrl}/${path}`, {
            params: req.query,
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname,  // Update the Host header for the target server
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
});

// Dynamic DELETE proxy route
app.delete('/proxy/*', async (req, res) => {
    // Capture the part of the URL after '/proxy'
    const path = req.params[0];

    // Target server base URL
    const targetBaseUrl = req.headers['x-real-url'];
    delete req.headers['x-real-url'];

    // Proxy authorization (since we use authorization headers as well)
    const authorization = req.headers['x-real-authorization'];
    delete req.headers['x-real-authorization'];

    headersToRemove.forEach(header => {
        delete req.headers[header.toLowerCase()];
    });

    try {
        const response = await axios.delete(`${targetBaseUrl}/${path}`, {
            headers: {
                ...req.headers,
                'Content-Type': 'application/json',
                'Host': new URL(targetBaseUrl).hostname,  // Update the Host header for the target server
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
});

const getColumnName = (storeName) => {
    if (storeName === 'sessions') return 'session_data';
    if (storeName === 'templates') return 'template_data';
    if (storeName === 'themes') return 'theme_data';
    return 'data';
};

const normalizeStoreName = (storeName) => {
    if (!storeName) {
        return "sessions";
    }
    const normalizedStoreName = storeName.split(' ')[0].toLowerCase();
    if (["sessions", "templates", "names", "themes"].includes(normalizedStoreName)) {
        return normalizedStoreName;
    }
    return null;
};

// POST route for client logging
app.post('/log', (req, res) => {
    console.log('[CLIENT LOG]', req.body);
    res.json({ ok: true });
});

// POST route to load data
app.post('/load', (req, res) => {
    const { storeName, key } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }
    const colName = getColumnName(normStoreName);
    db.get(`SELECT ${colName} AS data FROM ${normStoreName} WHERE key = ?`, [key], async (err, row) => {
        if (err) {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }
        if (!row) {
            return res.status(404).json({ ok: false, message: 'Key not found' });
        }

        try {
            if (normStoreName !== "names") {
                const plainText = typeof row.data === 'string' ? row.data : row.data.toString();
                res.json({ ok: true, result: JSON.parse(plainText) });
            } else {
                let parsedResult = row.data;
                try {
                    const parsed = JSON.parse(row.data);
                    if (parsed && typeof parsed === 'object' && parsed.name !== undefined) {
                        parsedResult = parsed;
                    }
                } catch {
                    // Ignore, legacy string
                }
                res.json({ ok: true, result: parsedResult });
            }
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to parse data.' });
        }
    });
});

// POST route to save data
app.post('/save', async (req, res) => {
    const { storeName, key, data } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }

    try {
        let dataToStore;
        if (normStoreName !== "names") {
            dataToStore = JSON.stringify(data);
        } else {
            dataToStore = typeof data === 'object' ? JSON.stringify(data) : data;
        }

        const colName = getColumnName(normStoreName);
        db.run(`INSERT OR REPLACE INTO ${normStoreName} (key, ${colName}) VALUES (?, ?)`, [key, dataToStore], (err) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error writing to the database' });
            } else {
                res.json({ ok: true, result: 'Data saved successfully' });
            }
        });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Failed to save data.' });
    }
});

// POST route to update session name
app.post('/rename', (req, res) => {
    const { storeName, key, newName } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (normStoreName !== 'sessions') {
        return res.status(400).json({ ok: false, message: 'Renaming is only supported for sessions' });
    }
    // Read existing metadata, update name and modified
    db.get(`SELECT data FROM names WHERE key = ?`, [key], (err, row) => {
        if (err) {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }
        let nameData;
        if (row && row.data) {
            try {
                const parsed = JSON.parse(row.data);
                if (parsed && typeof parsed === 'object' && parsed.name !== undefined) {
                    nameData = { ...parsed, name: newName, modified: Date.now() };
                } else {
                    nameData = { name: newName, created: null, modified: Date.now() };
                }
            } catch {
                nameData = { name: newName, created: null, modified: Date.now() };
            }
        } else {
            nameData = { name: newName, created: null, modified: Date.now() };
        }
        db.run(
            `UPDATE names SET data = ? WHERE key = ?`,
            [JSON.stringify(nameData), key],
            (err) => {
                if (err) {
                    res.status(500).json({ ok: false, message: 'Error updating the database' });
                } else {
                    res.json({ ok: true, result: 'Session renamed successfully' });
                }
            }
        );
    });
});

// POST route to get all rows from a table
app.post('/all', (req, res) => {
    const { storeName } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }
    const colName = getColumnName(normStoreName);
    db.all(`SELECT key, ${colName} AS data FROM ${normStoreName}`, [], async (err, rows) => {
        if (err) {
            return res.status(500).json({ ok: false, message: 'Error querying the database' });
        }

        try {
            const all = {};
            if (normStoreName !== "names") {
                rows.forEach((row) => {
                    const plainText = typeof row.data === 'string' ? row.data : row.data.toString();
                    all[row.key] = JSON.parse(plainText);
                });
            } else {
                rows.forEach((row) => {
                    all[row.key] = row.data;
                });
            }
            res.json({ ok: true, result: all });
        } catch (e) {
            res.status(500).json({ ok: false, message: 'Failed to parse data for one or more items.' });
        }
    });
});

// POST route to get session info
app.post('/sessions', (req, res) => {
    const { storeName } = req.body;
    db.all(
        `
        SELECT key, data AS name
        FROM names
        `,
        [],
        (err, rows) => {
            if (err) {
                res.status(500).json({ ok: false, message: 'Error querying the database' });
            } else {
                const sessions = {};
                rows.forEach((row) => {
                    // Handle both legacy string names and new JSON metadata objects
                    try {
                        const parsed = JSON.parse(row.name);
                        if (parsed && typeof parsed === 'object' && parsed.name !== undefined) {
                            sessions[row.key] = parsed;
                        } else {
                            sessions[row.key] = row.name;
                        }
                    } catch {
                        sessions[row.key] = row.name;
                    }
                });
                res.json({ ok: true, result: sessions });
            }
        }
    );
});

// POST route to delete a session
app.post('/delete', (req, res) => {
    const { storeName, key } = req.body;
    const normStoreName = normalizeStoreName(storeName);
    if (!normStoreName) {
        return res.status(400).json({ ok: false, message: 'Invalid store name provided' });
    }
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        db.run(`DELETE FROM ${normStoreName} WHERE key = ?`, [key]);

        if (normStoreName === 'sessions') {
            db.run(`DELETE FROM names WHERE key = ?`, [key]);
        }

        db.run("COMMIT", (err) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ ok: false, message: 'Error deleting from the database' });
            }
            res.json({ ok: true, result: 'Session deleted successfully' });
        });
    });
});

// Start the server
app.listen(port, host, () => {
    console.log(`Server listening at http://${host}:${port}`);
    if (!noOpen) {
        open(`http://127.0.0.1:${port}/`);
    }
});

// Close db connection on server close
process.on('SIGINT', () => {
    db.close(() => {
        process.exit(0);
    });
});
