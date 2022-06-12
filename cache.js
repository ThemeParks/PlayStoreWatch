import path from 'path';
import dotenv from 'dotenv';
import level from 'level';

dotenv.config();

const db = level(path.join(process.cwd(), 'store.db'));

export async function wrap(key, fn, ttl /* seconds */) {
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

    if (newValue === undefined) {
        await db.put(key, JSON.stringify({
            expires: 0,
        }));
        return undefined;
    }

    await db.put(key, JSON.stringify({
        data: newValue,
        expires: (+new Date()) + (ttl * 1000),
    }));

    // stringify and re-parse so we get the same result as if we had just pulled from the cache
    return JSON.parse(JSON.stringify(newValue));
}

export async function get(...args) {
    return db.get(...args);
}

export async function put(...args) {
    return db.put(...args);
}
