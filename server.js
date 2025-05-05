const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const WebTorrent = require('webtorrent-hybrid');
const express = require('express');
const app = express();
const client = new WebTorrent();

const PORT = process.env.PORT || 3000;

///// 🟣 STREMIO MANIFEST
const manifest = {
    id: 'org.hackstore.remoteaddon',
    version: '3.0.0',
    name: 'Hackstore (Remote Stream)',
    description: 'Latino movies & series scraped from Hackstore.fo + global magnet streaming',
    resources: ['catalog', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        { type: 'movie', id: 'hackstore_movies', name: 'Hackstore Movies' },
        { type: 'series', id: 'hackstore_series', name: 'Hackstore Series' }
    ],
    idPrefixes: ['hackstore']
};

const builder = new addonBuilder(manifest);

///// 📚 CATALOG HANDLER
builder.defineCatalogHandler(async ({ type, id }) => {
    const items = [];
    const url = (type === 'movie')
        ? 'https://hackstore.fo/peliculas/'
        : 'https://hackstore.fo/series/';

    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    $('.item').each((i, el) => {
        const title = $(el).find('.title').text().trim();
        const poster = $(el).find('img').attr('src');
        const pageUrl = $(el).find('a').attr('href');

        items.push({
            id: `hackstore_${Buffer.from(pageUrl).toString('base64')}`,
            name: title,
            poster,
        });
    });

    return { metas: items };
});

///// 📺 STREAM HANDLER
builder.defineStreamHandler(async ({ id }) => {
    const streams = [];

    const pageUrl = Buffer.from(id.replace('hackstore_', ''), 'base64').toString('utf8');
    const res = await axios.get(pageUrl);
    const $ = cheerio.load(res.data);

    $('a[href*="magnet:"], a[href*=".mp4"], a[href*=".mkv"]').each((i, el) => {
        const link = $(el).attr('href');

        if (link.startsWith('magnet:')) {
            streams.push({
                title: 'Stream Magnet (WebTorrent)',
                url: `${BASE_URL}/stream/${encodeURIComponent(link)}`,
            });
        } else {
            streams.push({
                title: 'Direct Link',
                url: link,
            });
        }
    });

    return { streams };
});

///// 🟢 ADDON HTTP INTERFACE
app.get('/manifest.json', (req, res) => {
    res.json(builder.getInterface().manifest);
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const resp = await builder.getInterface().get('/catalog', req.params, req.query);
    res.json(resp);
});

app.get('/stream/:type/:id/:extra?.json', async (req, res) => {
    const resp = await builder.getInterface().get('/stream', req.params, req.query);
    res.json(resp);
});

///// 🎥 MAGNET STREAM ENDPOINT
app.get('/stream/:magnet', (req, res) => {
    const magnet = decodeURIComponent(req.params.magnet);

    client.add(magnet, torrent => {
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));

        if (!file) return res.status(404).send('No playable video found in torrent.');

        res.writeHead(200, {
            'Content-Type': 'video/mp4',
        });

        const stream = file.createReadStream();
        stream.pipe(res);

        res.on('close', () => {
            torrent.destroy();
        });
    });
});

///// 🚀 START SERVER
app.listen(PORT, () => {
    console.log(`Hackstore remote addon running on port ${PORT}`);
});

///// 🌐 BASE URL (auto detect or default)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
