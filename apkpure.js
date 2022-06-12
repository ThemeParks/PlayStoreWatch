import cheerio from 'cheerio';
import { wrap } from './cache.js';

const apkPureBaseURL = 'https://apkpure.com';

async function fetchAppSearchResults(appId) {
    return wrap(`apkpure_url:${appId}`, async () => {
        const url = `${apkPureBaseURL}/search?q=${appId}`;
        const response = await fetch(url);
        const html = await response.text();
        return html;
    }, 60 * 60 * 24);
}

async function findAppURL(appId) {
    const searchBody = await fetchAppSearchResults(appId);
    const $ = cheerio.load(searchBody);
    const appURL = $('p.search-title > a').attr('href');
    return appURL;
}

async function fetchAppDetailsPage(appId) {
    const appURL = await findAppURL(appId);

    if (!appURL) {
        return undefined;
    }

    return wrap(`apkpure_detail:${appId}`, async () => {
        const response = await fetch(`${apkPureBaseURL}${appURL}`);
        const html = await response.text();
        return html;
    }, 60 * 60);
}

export async function getAppDetails(appId) {
    const body = await fetchAppDetailsPage(appId);

    if (!body) {
        return undefined;
    }

    const $ = cheerio.load(body);
    const appName = $('div.title-like:first > h1').text();
    const appVersion = $('span[itemprop="version"]:first').text();
    const appPublishDate = $('p[itemprop="datePublished"]:first').text();
    const updateText = $('div#whatsnew:first').text();
    const icon = $('div.icon:first > img').attr('src');
    let size = $('span.fsize:first > span').text();

    const updateDate = new Date(Date.UTC(
        Number(appPublishDate.substring(0, 4)),
        Number(appPublishDate.substring(5, 7)) - 1,
        Number(appPublishDate.substring(8, 10)),
    ));

    if (size.indexOf('MB') !== -1) {
        size = Math.floor(Number(size.substring(0, size.indexOf('MB'))) * 1024 * 1024);
    } else if (size.indexOf('KB') !== -1) {
        size = Math.floor(Number(size.substring(0, size.indexOf('KB'))) * 1024);
    } else {
        size = Math.floor(Number(size)) || 0;
    }

    return {
        id: appId,
        version: appVersion.trim(),
        updated: updateDate,
        changelog: updateText,
        size: size,
        name: appName,
        icon: icon,
        url: `https://play.google.com/store/apps/details?id=${appId}`,
    };
}

