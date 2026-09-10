/**
 * Netlify Function serving the JSON API on Netlify deployments.
 *
 * `config.path` below binds this function to `/api/rates` and `/api/refresh`,
 * so the UI keeps calling the same URLs as with the local `server.js`.
 *
 * State lives in Netlify Blobs (see `netlify/lib/store.mjs`), shared by every
 * function instance:
 *   - `functions/refresh-rates.mjs` (scheduled, @hourly) refreshes it every hour.
 *   - GET /api/rates reads it. As a safety net, if the stored state is older than
 *     REFRESH_INTERVAL_MS (store empty before the first scheduled run, or a
 *     missed run), it refreshes inline before answering.
 *   - POST /api/refresh fetches immediately and writes the result to the store.
 */

import rateLib from '../../lib/rates.js';
import { loadState, saveState } from '../lib/store.mjs';

const { REFRESH_INTERVAL_MS, refreshState, publicState } = rateLib;

let refreshing = null;

function isStale(state) {
	if (!state.updatedAt) return true;
	return Date.now() - Date.parse(state.updatedAt) >= REFRESH_INTERVAL_MS;
}

/** Fetches, saves to Blobs and returns the fresh state. Concurrent calls share one fetch. */
function refreshOnce(state) {
	if (!refreshing) {
		refreshing = (async () => {
			try {
				await refreshState(state);
			} finally {
				// Save even on partial failure so lastAttemptAt / lastError are shared.
				await saveState(state);
			}
			return state;
		})().finally(() => {
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
		let state = await loadState();
		if (isStale(state)) {
			try {
				state = await refreshOnce(state);
			} catch (e) {
				state.lastError = e.message;
			}
		}
		return json(200, publicState(state));
	}

	if (pathname === '/api/refresh' && request.method === 'POST') {
		try {
			const state = await refreshOnce(await loadState());
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
