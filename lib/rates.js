/**
 * Shared rate-fetching logic used by both `server.js` (local Node server)
 * and `netlify/functions/api.js` (Netlify deployment).
 * No npm dependencies: Node >= 18 (native fetch).
 */

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
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

/**
 * Fetches every currency from Boursorama.
 * Returns { rates, details, errors } where `errors` is an array of messages
 * for the currencies that failed (empty when everything succeeded).
 */
async function fetchAllRates() {
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
	return { rates, details, errors };
}

/** Fresh, empty state object. */
function initialState() {
	return {
		rates: {}, // { EUR: 1, USD: 0.86, ... }
		updatedAt: null, // ISO string of the last successful fetch
		nextUpdateAt: null,
		lastAttemptAt: null,
		lastError: null,
		source: 'boursorama.com',
		details: {} // per currency: { symbol, day }
	};
}

/**
 * Fetches rates and merges them into `state` (mutated in place).
 * On partial failure, previous rates are kept for the failed currencies.
 * Returns true when every currency succeeded.
 */
async function refreshState(state) {
	const attemptAt = new Date();
	state.lastAttemptAt = attemptAt.toISOString();
	const { rates, details, errors } = await fetchAllRates();

	if (errors.length === 0) {
		state.rates = rates;
		state.details = details;
		state.updatedAt = attemptAt.toISOString();
		state.lastError = null;
	} else {
		for (const code of Object.keys(rates)) {
			state.rates[code] = rates[code];
			state.details[code] = details[code];
		}
		state.lastError = errors.join(' | ');
	}
	state.nextUpdateAt = new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString();
	return errors.length === 0;
}

/** State as exposed by the JSON API. */
function publicState(state) {
	return {
		...state,
		currencies: CURRENCIES.map((c) => ({ code: c.code, name: c.name })),
		refreshIntervalMs: REFRESH_INTERVAL_MS
	};
}

module.exports = {
	CURRENCIES,
	REFRESH_INTERVAL_MS,
	fetchSymbol,
	fetchRateToEur,
	fetchAllRates,
	initialState,
	refreshState,
	publicState
};
