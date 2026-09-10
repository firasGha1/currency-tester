/**
 * Netlify Scheduled Function: refreshes the rates every hour, with or without visitors.
 *
 * Runs at minute 0 of every hour (UTC), fetches Boursorama through the shared
 * `lib/rates.js` logic and writes the result to Netlify Blobs, where
 * `functions/api.mjs` reads it. Scheduled functions cannot be invoked by URL;
 * use "Run now" in the Netlify UI or `netlify functions:invoke refresh-rates`.
 */

import rateLib from '../../lib/rates.js';
import { loadState, saveState } from '../lib/store.mjs';

const { refreshState } = rateLib;

export default async function handler(request) {
	let nextRun = null;
	try {
		const body = await request.json();
		nextRun = body && body.next_run ? body.next_run : null;
	} catch {
		// Manual invocation without a body: keep the default nextUpdateAt.
	}

	const state = await loadState();
	let ok = false;
	try {
		ok = await refreshState(state);
	} catch (e) {
		state.lastError = e.message;
	}
	if (nextRun) state.nextUpdateAt = nextRun;

	// Always save, even on failure, so lastAttemptAt / lastError reach the UI.
	await saveState(state);

	if (ok) {
		console.log(
			'[refresh-rates] OK:',
			Object.entries(state.rates).map(([k, v]) => `${k}=${v}`).join('  '),
			'| next run:', state.nextUpdateAt
		);
	} else {
		console.error('[refresh-rates] FAILED:', state.lastError, '| next run:', state.nextUpdateAt);
	}
}

export const config = {
	schedule: '@hourly'
};
