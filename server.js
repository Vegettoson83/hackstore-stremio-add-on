const { addonBuilder } = require('stremio-addon-sdk');
const WebTorrent = require('webtorrent-hybrid');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');

const client = new WebTorrent();
const app = express();
app.use(cors());

const TRACKERS = [
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.opentrackr.org:1337',
    'udp://tracker.internetwarriors.net:1337',
    'udp://exodus.desync.com:6969',
    'udp://tracker.leechers-paradise.org:6969',
    'udp://tracker.coppersurfer.tk:6969',
    'udp://9.rarbg.to:2710',
    'udp://tracker.torrent.eu.org:451',
    'udp://opentracker.i2p.rocks:6969',
    'udp://tracker.moeking.me:6969',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.fastcast.nz',
];

// ESPADA: Scrape Hackstore catalog and map IMDB IDs
async function getCatalog() {
    const url = 'https://www.hackstore.to/peliculas-latino/page/1/';
    const resp = await axios.get(url);
    const $ = cheerio.load(resp.data);

    const items = [];

    $('.item_1.items').each((i, el) => {
        const title = $(el).find('h2').text().trim();
        const poster = $(el).find('img').attr('src');
        const href = $(el).find('a').attr('href');
        const slug = href.split('/').filter(Boolean).pop();

        // Extract IMDB ID from slug pattern (e.g., pelicula-gratis-latino-tt1234567)
        const imdbMatch = slug.match(/(tt\d{7,8})/);
        if (imdbMatch) {
            const imdb = imdbMatch[1];
            items.push({
                id: imdb,
                name: title,
                poster: poster,
                slug: slug
            });
        }
    });

    return items;
}

// STREAM HANDLER: Use magnet from Hackstore
app.get('/stream/:imdb_id', async (req, res) => {
    const imdb_id = req.params.imdb_id;
    const catalog = await getCatalog();

    const movie = catalog.find(m => m.id === imdb_id);
    if (!movie) return res.status(404).json({ error: 'Not found in Hackstore' });

    // Fetch magnet from Hackstore page
    const page = await axios.get(`https://www.hackstore.to/${movie.slug}`);
    const $ = cheerio.load(page.data);

    let magnet;
    $('a[href^="magnet:?xt"]').each((i, el) => {
        magnet = $(el).attr('href');
    });

    if (!magnet) return res.status(404).json({ error: 'Magnet not found' });

    // Inject trackers
    TRACKERS.forEach(tr => {
        if (!magnet.includes(tr)) {
            magnet += `&tr=${encodeURIComponent(tr)}`;
        }
    });

    client.add(magnet, { announce: TRACKERS }, torrent => {
        const file = torrent.files.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.avi'));
        res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
        file.createReadStream().pipe(res);
    });
});

// STREMIO ADDON: Catalog & Streams
const builder = new addonBuilder({
    id: 'org.espada.hackstore',
    version: '1.0.0',
    name: 'Hackstore Espada',
    catalogs: [
        {
            type: 'movie',
            id: 'hackstore',
            name: 'Hackstore Latinos',
            extra: [{ name: 'search' }]
        }
    ],
    resources: ['catalog', 'stream'],
    types: ['movie'],
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (id !== 'hackstore') return { metas: [] };

    const catalog = await getCatalog();

    // Search support
    let metas = catalog.map(m => ({
        id: m.id,
        type: 'movie',
        name: m.name,
        poster: m.poster
    }));

    if (extra.search) {
        const query = extra.search.toLowerCase();
        metas = metas.filter(m => m.name.toLowerCase().includes(query));
    }

    return { metas };
});

builder.defineStreamHandler(async ({ type, id }) => {
    return {
        streams: [{
            title: "Hackstore Magnet Stream",
            url: `https://<your-fly-app>.fly.dev/stream/${id}`
        }]
    };
});

app.get('/manifest.json', (req, res) => {
    res.json(builder.getInterface().getManifest());
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;
    const extra = req.query || {};
    const resp = await builder.getInterface().getCatalog({ type, id, extra });
    res.json(resp);
});

app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const resp = await builder.getInterface().getStream({ type, id });
    res.json(resp);
});

app.listen(7000, () => console.log('🩸 Hackstore Espada Addon running on port 7000'));
