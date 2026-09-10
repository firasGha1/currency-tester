/**
 * Currency converter server.
 * - Pulls exchange rates from boursorama.com every hour (and on startup).
 * - Serves the single-page UI (index.html) and a small JSON API.
 * - No npm dependencies: Node >= 18 (native fetch).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_FILE = path.join(__dirname, 'rates.json');
const BOURSORAMA_URL = 'https://www.boursorama.com/bourse/action/graph/ws/UpdateCharts?symbol=';

/**
 * Currencies handled by the app. Every rate is expressed "1 unit of currency = X EUR",
 * exactly like the Excel sheet (GBP 1.16488, USD 0.8592, EUR 1, ZAR 0.05346).
 * Conversion A -> B = amount * rate[A] / rate[B].
 *
 * `toEur`  : Boursorama symbols quoting CCY/EUR (used directly).
 * `fromEur`: Boursorama symbols quoting EUR/CCY (fallback, inverted).
 */
const CURRENCIES = [
	{ code: 'EUR', name: 'Euro', toEur: [], fromEur: [] },
	{ code: 'GBP', name: 'Livre sterling', toEur: ['3fGBPEUR', '3fGBP_EUR'], fromEur: ['1xGBPVS'] },
	{ code: 'USD', name: 'Dollar US', toEur: ['3fUSD_EUR'], fromEur: ['1xEURUS'] },
	{ code: 'ZAR', name: 'Rand sud-africain', toEur: ['3fZAR_EUR'], fromEur: ['1xZARVS'] }
	// Example to add a currency:
	// { code: 'CHF', name: 'Franc suisse', toEur: ['3fCHF_EUR'], fromEur: ['1xCHFVS'] },
];

/** in-memory state served to the UI */
let state = {
	rates: {}, // { EUR: 1, USD: 0.86, ... }
	updatedAt: null, // ISO string of the last successful fetch
	nextUpdateAt: null,
	lastAttemptAt: null,
	lastError: null,
	source: 'boursorama.com',
	details: {} // per currency: { symbol, day }
};

// ---------------------------------------------------------------------------
// Boursorama scraping
// ---------------------------------------------------------------------------

async function fetchSymbol(symbol) {
	const res = await fetch(BOURSORAMA_URL + encodeURIComponent(symbol), {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
			Accept: 'application/json, text/plain, */*'
		}
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} for symbol "${symbol}"`);
	let json;
	try {
		json = await res.json();
	} catch {
		throw new Error(`non-JSON response for symbol "${symbol}"`);
	}
	const rate = json && json.c;
	if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
		throw new Error(`invalid rate "${rate}" for symbol "${symbol}"`);
	}
	return { rate, day: json.d };
}

/** returns { rate (CCY -> EUR), symbol, day } */
async function fetchRateToEur(currency) {
	if (currency.code === 'EUR') return { rate: 1, symbol: null, day: null };
	const failures = [];
	for (const symbol of currency.toEur) {
		try {
			const r = await fetchSymbol(symbol);
			return { rate: r.rate, symbol, day: r.day };
		} catch (e) {
			failures.push(e.message);
		}
	}
	for (const symbol of currency.fromEur) {
		try {
			const r = await fetchSymbol(symbol);
			return { rate: 1 / r.rate, symbol: `1/${symbol}`, day: r.day };
		} catch (e) {
			failures.push(e.message);
		}
	}
	throw new Error(`${currency.code}: ${failures.join('; ')}`);
}

async function refreshRates() {
	const attemptAt = new Date();
	state.lastAttemptAt = attemptAt.toISOString();
	console.log(`[${attemptAt.toLocaleString()}] Fetching rates from boursorama.com...`);

	const results = await Promise.allSettled(CURRENCIES.map((c) => fetchRateToEur(c)));
	const rates = {};
	const details = {};
	const errors = [];
	results.forEach((r, i) => {
		const code = CURRENCIES[i].code;
		if (r.status === 'fulfilled') {
			rates[code] = r.value.rate;
			details[code] = { symbol: r.value.symbol, day: r.value.day };
		} else {
			errors.push(r.reason.message);
		}
	});

	if (errors.length === 0) {
		state.rates = rates;
		state.details = details;
		state.updatedAt = attemptAt.toISOString();
		state.lastError = null;
		saveCache();
		console.log('  OK:', Object.entries(rates).map(([k, v]) => `${k}=${v}`).join('  '));
	} else {
		// keep previous rates, but apply any currency that did succeed
		for (const code of Object.keys(rates)) {
			state.rates[code] = rates[code];
			state.details[code] = details[code];
		}
		state.lastError = errors.join(' | ');
		console.error('  FAILED:', state.lastError);
	}
	state.nextUpdateAt = new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString();
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

function publicState() {
	return {
		...state,
		currencies: CURRENCIES.map((c) => ({ code: c.code, name: c.name })),
		refreshIntervalMs: REFRESH_INTERVAL_MS
	};
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
		return sendJson(res, 200, publicState());
	}

	if (url.pathname === '/api/refresh' && req.method === 'POST') {
		try {
			await refreshOnce();
			return sendJson(res, 200, publicState());
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
