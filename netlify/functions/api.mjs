/**
 * Netlify Function serving the JSON API on Netlify deployments.
 *
 * `config.path` below binds this function to `/api/rates` and `/api/refresh`,
 * so the UI keeps calling the same URLs as with the local `server.js`.
 *
 * Netlify Functions are stateless and have no long-running timer, so the
 * "hourly refresh" works differently here:
 *   - Rates are fetched from Boursorama on demand and memoised in the warm
 *     function instance for one hour (REFRESH_INTERVAL_MS).
 *   - POST /api/refresh bypasses the memo and fetches immediately.
 *   - The committed `rates.json` is bundled and used as a fallback when
 *     Boursorama is unreachable, so the UI never shows an empty table.
 */

import rateLib from '../../lib/rates.js';
import bundledCache from '../../rates.json' with { type: 'json' };

const { REFRESH_INTERVAL_MS, initialState, refreshState, publicState } = rateLib;

let state = loadBundledCache();
let refreshing = null;

function loadBundledCache() {
	const s = initialState();
	if (bundledCache && bundledCache.rates && typeof bundledCache.rates === 'object') {
		Object.assign(s, bundledCache, { lastError: null, nextUpdateAt: null });
	}
	return s;
}

function isStale() {
	if (!state.updatedAt) return true;
	return Date.now() - Date.parse(state.updatedAt) >= REFRESH_INTERVAL_MS;
}

function refreshOnce() {
	if (!refreshing) {
		refreshing = refreshState(state).finally(() => {
			refreshing = null;
		});
	}
	return refreshing;
}

function json(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
}

export default async function handler(request) {
	const { pathname } = new URL(request.url);

	if (pathname === '/api/rates' && request.method === 'GET') {
		if (isStale()) {
			try {
				await refreshOnce();
			} catch (e) {
				state.lastError = e.message;
			}
		}
		return json(200, publicState(state));
	}

	if (pathname === '/api/refresh' && request.method === 'POST') {
		try {
			await refreshOnce();
			return json(200, publicState(state));
		} catch (e) {
			return json(500, { error: e.message });
		}
	}

	return json(404, { error: 'Not found' });
}

export const config = {
	path: ['/api/rates', '/api/refresh']
};
