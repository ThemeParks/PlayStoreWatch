import path from 'path';
import https from 'https';

import dotenv from 'dotenv';
import gplay from 'google-play-scraper';
import fastify from 'fastify';
import pov from 'point-of-view';
import ejs from 'ejs';
import level from 'level';
import cron from 'cron';
const { CronJob } = cron;

dotenv.config();

const app = fastify({ logger: true });

const db = level(path.join(process.cwd(), 'store.db'));

const apiKey = process.env.API_KEY;

async function request(url, data, options) {
    return new Promise((resolve, reject) => {
        var req = https.request(url, options, (res) => {
            res.on('end', resolve);

            res.on('data', (d) => {
                // process.stdout.write(d);
            });
        });

        req.on('error', (e) => {
            app.log.error(e);
            reject(e);
        });

        req.write(data);
        req.end();
    });
}

const notifyQueue = [];

async function notifyLoop() {
    setInterval(async () => {
        try {
            await runNotifyQueue();
        } catch (e) {
            app.log.error(`Error running notify loop: ${e}`);
        }
    }, 1000 * 10);
}
notifyLoop();

async function runNotifyQueue() {
    if (notifyQueue.length === 0) return;
    const todo = [];
    while (notifyQueue.length > 0) {
        todo.push(notifyQueue.shift());
    }
    await Promise.allSettled(todo.map(async (next) => {
        var postData = JSON.stringify({
            username: "Stapler",
            avatar_url: next.icon,
            content: next.message,
        });

        var options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length
            },
        };

        try {
            await request(process.env.DISCORD_URL, postData, options);
        } catch (e) {
            console.error('notify error!', e);
            // add back to queue and try again later
            notifyQueue.push(next);
        }
    }));
}

async function notify(message, icon = undefined) {
    if (!process.env.DISCORD_URL) return;
    // push to our queue, process later
    notifyQueue.push({
        message,
        icon,
    });
}

async function wrap(key, fn, ttl /* seconds */) {
    try {
        const res = await db.get(key);
        const data = JSON.parse(res);
        const now = +new Date();
        if (data.expires >= now) {
            return data.data;
        }
    } catch (e) {
        if (e.name !== 'NotFoundError') {
            throw e;
        }
    }

    // could not find cached data, fetch it
    const newValue = await fn();

    await db.put(key, JSON.stringify({
        data: newValue,
        expires: (+new Date()) + (ttl * 1000),
    }));

    // stringify and re-parse so we get the same result as if we had just pulled from the cache
    return JSON.parse(JSON.stringify(newValue));
}

async function appBrainQuery(appId) {
    if (!process.env.APPBRAIN) {
        return undefined;
    }

    return wrap(`appbrain_${appId}`, async () => {
        return new Promise((resolve) => {
            var options = {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
            };

            app.log.info(`Fetching ${appId} from appbrain due to varying devices...`);

            var req = https.request(`https://api.appbrain.com/v2/info/getapp?apikey=${process.env.APPBRAIN}&package=${appId}&format=json`, options, (res) => {
                res.on('end', () => {
                    const data = parts.map(x => x.toString()).join('');
                    const obj = JSON.parse(data.trim());
                    return resolve(obj);
                });

                const parts = [];

                res.on('data', (d) => {
                    parts.push(d);
                });
            });

            req.on('error', (e) => {
                app.log.error(e);
                throw e;
            });

            req.end();
        });
    }, 60 * 60 * 24); // cache this for 24 hours, API only allows 500 uses a month, so keep this to a minimum!
}

async function getAppDataFromAppBrain(appId) {
    const resp = await appBrainQuery(appId);
    if (!resp) {
        return undefined;
    }

    let recentChanges = '';
    try {
        recentChanges = (resp.description || '').split('Recent changes:\n').pop();
    } catch (e) {
        // app.log.error(e);
    }

    const appData = {
        id: appId,
        version: resp.versionString,
        updated: new Date(resp.lastAppUpdateTime * 1000),
        changelog: recentChanges,
        size: resp.apkSize,
        name: resp.name,
        icon: resp.iconUrl,
        url: `https://play.google.com/store/apps/details?id=${appId}`,
    };

    return appData;
}

async function queryApp(appId) {
    return wrap(`gdata_${appId}`, async () => {
        const data = {
            id: appId,
            last_changed: null,
        };
        try {
            const resp = await gplay.app({
                appId,
            });

            data.name = resp.title;
            data.icon = resp.icon;
            data.url = resp.url;
            data.updated = new Date(resp.updated);
            data.changelog = resp.recentChanges;
            data.size = resp.size;
            data.version = resp.version;
        } catch (e) {
            // node library failed, use appbrain
            app.log.error(`Error querying nodejs lib: ${e}`);
            const appData = await getAppDataFromAppBrain(appId);
            Object.keys(appData).forEach(key => {
                data[key] = appData[key];
            });
        }

        // get last changed date
        let lastChangedDate = null;
        try {
            lastChangedDate = new Date(await db.get(`app_lastchanged_${appId}`));
        } catch (e) { }
        data.last_changed = lastChangedDate;

        if (data.version.trim().toLowerCase() === 'varies with device') {
            // fetch from appbrain instead
            const appbrainData = await appBrainQuery(appId);
            data.version = appbrainData.versionString;
        }

        app.log.info(`Updated app ${appId}...`);

        let existing;
        try {
            existing = JSON.parse(await db.get(`app_${appId}`));
        } catch (e) { }
        if (existing === undefined || existing.version != data.version) {
            app.log.warn(`App ${appId} version changed from ${existing?.version} to ${data.version}`);

            // record detected update time (publish time can be in the past if it was a slow roll out for alpha/beta etc.)
            const now = new Date();
            await db.put(`app_lastchanged_${appId}`, now.toString());
            data.last_changed = now;

            // send notification
            notify(`App ${appId} version changed from ${existing?.version} to ${data.version}`, data.icon);
        }

        // store last-fetched app data
        await db.put(`app_${appId}`, JSON.stringify(data));

        return data;
    }, 120);
}

let configInvalid = true;
let _config = {};
async function getConfig() {
    if (!configInvalid) {
        return _config;
    }
    try {
        const c = await db.get('config');
        _config = JSON.parse(c);
    } catch (e) {
        _config = {
            apps: [],
        };
    }
    configInvalid = false;
    return _config;
}

async function addConfigArrayElement(key, value) {
    const conf = await getConfig();
    if (conf[key] === undefined) {
        conf[key] = [];
        configInvalid = true;
    }
    // put our new value if it's not already in the array
    if (conf[key].indexOf(value) < 0) {
        conf[key].push(value);
        await db.put('config', JSON.stringify(conf));
        configInvalid = true;
    } else {
        throw new Error('Element already in array');
    }
}

async function setConfig(key, value) {
    const conf = await getConfig();
    conf[key] = value;
    await db.put('config', JSON.stringify(conf));
    configInvalid = true;
}

function authRequest(req, res, done) {
    // API key auth takes priority
    if (apiKey) {
        if (req.headers['api-key'] == apiKey) {
            done();
        } else {
            res.code(401).send({ ok: false });
        }
        return;
    }

    // otherwise assume we're behind some auth system that exposes "remote-groups" header
    const groups = (req.headers['remote-groups'] || '').split(',').map(x => x.trim());
    if (groups.indexOf('admin') < 0) {
        res.code(401).send({ ok: false });
    }
    done();
}

async function watch() {
    app.log.info('Watching...');
    // for the watch.
    const config = await getConfig();
    // refresh all apps
    await Promise.all(config.apps.map(async (application) => {
        try {
            await queryApp(application);
        } catch (err) {
            app.log.error(err);
        }
    }));
}

let job = null;
async function startWatcher() {
    job = new CronJob(
        '0 * * * *', // hourly
        async () => {
            try {
                await watch();
            } catch (err) {
                // TODO - alert on failure
            }
        },
        null,
        true,
        'Europe/London',
    );
    // fire our function once when starting up
    job.fireOnTick();
}

async function getLatest() {
    const config = await getConfig();
    const apps = await Promise.all(config.apps.map(async (app) => {
        try {
            return {
                id: app,
                data: JSON.parse(await db.get(`app_${app}`)),
            };
        } catch (err) {
            return {
                id: app,
                data: undefined,
            };
        }
    }));
    return apps.filter(x => x.data !== undefined);
}

app.get('/', async (req, res) => {
    const data = await getLatest();
    // sort by latest -> oldest app update
    const apps = data.map((x => ({
        ...x.data,
        changelog: x?.data?.changelog ? x.data.changelog.replace("<br>", "\n") : '',
    })));
    apps.sort((a, b) => new Date(b.last_changed) - new Date(a.last_changed));
    return res.view('/templates/index.ejs', { apps });
});

app.get('/latest', async (req, res) => {
    return await getLatest();
});

app.get('/latest/:appId', async (req, res) => {
    try {
        const data = JSON.parse(await db.get(`app_${req.params.appId}`));
        return data;
    } catch (e) {
        res.code(404).send({ error: "Not found" });
    }
});

app.route({
    method: 'POST',
    url: '/admin/refresh',
    preHandler: authRequest,
    handler: async (req, res) => {
        await watch();
        return { ok: true };
    },
});

app.route({
    method: 'POST',
    url: '/admin/add_app',
    schema: {
        body: {
            appId: { type: 'array' },
        },
        response: {
            200: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                },
            },
        },
    },
    preHandler: authRequest,
    handler: async (req, res) => {
        try {
            for (let i = 0; i < req.body.appId.length; i++) {
                try {
                    await addConfigArrayElement('apps', req.body.appId[i]);
                    await queryApp(req.body.appId[i]);
                } catch (e) {
                    app.log.error(e);
                }
            }
            return { ok: true };
        } catch (e) {
            app.log.error(e);
            return { ok: false };
        }
    },
});

async function startServer() {
    try {
        await app.listen(process.env.PORT || 3000, '0.0.0.0');
        app.log.info(`server listening on ${app.server.address().port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

app.register(pov, {
    engine: {
        ejs,
    },
});

startServer();
startWatcher();
