/**
 * Shared persistence for the Netlify Functions, backed by Netlify Blobs.
 *
 * Lives outside `netlify/functions` so Netlify does not treat it as a function.
 * Both `functions/api.mjs` and `functions/refresh-rates.mjs` read/write the same
 * `state` entry of the site-wide `rates` store, so every function instance
 * serves the same rates regardless of cold starts.
 *
 * The committed `rates.json` is bundled and used as the initial state when the
 * store is still empty (first deploy, before the first scheduled run).
 */

import { getStore } from '@netlify/blobs';
import rateLib from '../../lib/rates.js';
import bundledCache from '../../rates.json' with { type: 'json' };

const { initialState } = rateLib;

const STORE_NAME = 'rates';
const STATE_KEY = 'state';

export function getRatesStore() {
	// Strong consistency: a GET right after POST /api/refresh must see the new value.
	return getStore({ name: STORE_NAME, consistency: 'strong' });
}

/** State built from the bundled rates.json (or an empty state if it is unusable). */
export function bundledState() {
	const s = initialState();
	if (bundledCache && bundledCache.rates && typeof bundledCache.rates === 'object') {
		Object.assign(s, bundledCache, { lastError: null, nextUpdateAt: null });
	}
	return s;
}

/** Loads the shared state from Blobs, falling back to the bundled rates.json. */
export async function loadState() {
	const stored = await getRatesStore().get(STATE_KEY, { type: 'json' });
	if (stored && stored.rates && typeof stored.rates === 'object') {
		return { ...initialState(), ...stored };
	}
	return bundledState();
}

/** Persists the shared state to Blobs. */
export async function saveState(state) {
	await getRatesStore().setJSON(STATE_KEY, state);
}
