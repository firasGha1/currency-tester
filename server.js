/**
 * Currency converter server (local / classic Node hosting).
 * - Pulls exchange rates from boursorama.com every hour (and on startup).
 * - Serves the single-page UI (index.html) and a small JSON API.
 * - No npm dependencies: Node >= 18 (native fetch).
 *
 * For Netlify, the same API is served by `netlify/functions/api.js`.
 * Currency definitions and scraping live in `lib/rates.js`.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { REFRESH_INTERVAL_MS, initialState, refreshState, publicState } = require('./lib/rates');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_FILE = path.join(__dirname, 'rates.json');

/** in-memory state served to the UI */
let state = initialState();

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refreshRates() {
	console.log(`[${new Date().toLocaleString()}] Fetching rates from boursorama.com...`);
	const ok = await refreshState(state);
	if (ok) {
		saveCache();
		console.log('  OK:', Object.entries(state.rates).map(([k, v]) => `${k}=${v}`).join('  '));
	} else {
		console.error('  FAILED:', state.lastError);
	}
	return state;
}

// ---------------------------------------------------------------------------
// Persistence (so the last known rates survive a restart when the site is down)
// ---------------------------------------------------------------------------

function saveCache() {
	try {
		fs.writeFileSync(CACHE_FILE, JSON.stringify(state, null, 2), 'utf8');
	} catch (e) {
		console.error('Could not write cache file:', e.message);
	}
}

function loadCache() {
	try {
		if (!fs.existsSync(CACHE_FILE)) return;
		const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
		if (cached && cached.rates && typeof cached.rates === 'object') {
			state = { ...state, ...cached, lastError: null };
			console.log(`Loaded cached rates from ${CACHE_FILE} (updated ${cached.updatedAt})`);
		}
	} catch (e) {
		console.error('Could not read cache file:', e.message);
	}
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store'
	});
	res.end(JSON.stringify(body));
}

let refreshing = null;
function refreshOnce() {
	if (!refreshing) {
		refreshing = refreshRates().finally(() => {
			refreshing = null;
		});
	}
	return refreshing;
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`);

	if (url.pathname === '/api/rates' && req.method === 'GET') {
		return sendJson(res, 200, publicState(state));
	}

	if (url.pathname === '/api/refresh' && req.method === 'POST') {
		try {
			await refreshOnce();
			return sendJson(res, 200, publicState(state));
		} catch (e) {
			return sendJson(res, 500, { error: e.message });
		}
	}

	if (url.pathname === '/' || url.pathname === '/index.html') {
		fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
			if (err) {
				res.writeHead(500);
				return res.end('index.html not found');
			}
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
			res.end(data);
		});
		return;
	}

	res.writeHead(404);
	res.end('Not found');
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

loadCache();
server.listen(PORT, () => {
	console.log(`Currency converter running at http://localhost:${PORT}`);
	console.log(`Rates refresh every ${REFRESH_INTERVAL_MS / 60000} minutes.`);
});

refreshOnce().catch((e) => console.error(e));
setInterval(() => refreshOnce().catch((e) => console.error(e)), REFRESH_INTERVAL_MS);
