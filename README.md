# Currency Tester

A small currency converter that pulls exchange rates from [boursorama.com](https://www.boursorama.com) every hour and shows them in a single-page web UI. The local server has no npm dependencies: only Node.js 18 or newer is required. (The Netlify deployment uses `@netlify/blobs`, installed automatically by Netlify at build time.)

Supported currencies: **EUR, GBP, USD, ZAR**.

## Requirements

- Node.js >= 18 (uses the built-in `fetch`)
- Internet access to `www.boursorama.com` (only needed for refreshing rates)

## Getting started

```bash
npm start
# or
node server.js
```

Then open <http://localhost:3000> in your browser.

To use another port:

```powershell
# PowerShell
$env:PORT = 8080; node server.js
```

```bash
# bash
PORT=8080 node server.js
```

## Using the web UI

1. **Valeur de base**: type an amount in the input. French formatting (`27 024,00`) and English formatting (`27,024.00`) are both accepted. The value is reformatted when the field loses focus.
2. **Currency selector**: choose which currency the base amount is expressed in. The matching conversion block is highlighted.
3. **Rates table** (left): shows the current rates as "1 unit of currency = X EUR".
4. **Conversion blocks** (right): for every currency pair, the base amount converted from one currency to the other.
5. **Actualiser maintenant**: forces an immediate fetch from Boursorama instead of waiting for the next hourly refresh.

The status line shows when the rates were last updated, when the next automatic refresh is due, and the last error if a fetch failed. The page also re-reads rates from the server every minute, so it stays current without a reload.

### How conversions work

All rates are stored as "1 unit of currency = X EUR", the same convention as the original Excel sheet. Converting an amount from currency A to currency B is:

```
result = amount × rate[A] ÷ rate[B]
```

## JSON API

| Method | Path           | Description                                                    |
| ------ | -------------- | -------------------------------------------------------------- |
| GET    | `/api/rates`   | Current rates, metadata, and the list of supported currencies. |
| POST   | `/api/refresh` | Fetches fresh rates from Boursorama now and returns the state. |

Example response:

```json
{
  "rates": { "EUR": 1, "GBP": 1.1637, "USD": 0.8608, "ZAR": 0.05322 },
  "updatedAt": "2026-09-10T13:51:40.435Z",
  "nextUpdateAt": "2026-09-10T14:49:07.395Z",
  "lastAttemptAt": "2026-09-10T13:51:40.435Z",
  "lastError": null,
  "source": "boursorama.com",
  "details": {
    "GBP": { "symbol": "3fGBPEUR", "day": 20706 },
    "USD": { "symbol": "3fUSD_EUR", "day": 20706 },
    "ZAR": { "symbol": "3fZAR_EUR", "day": 20706 }
  },
  "currencies": [
    { "code": "EUR", "name": "Euro" },
    { "code": "GBP", "name": "Livre sterling" },
    { "code": "USD", "name": "Dollar US" },
    { "code": "ZAR", "name": "Rand sud-africain" }
  ],
  "refreshIntervalMs": 3600000
}
```

Example with `curl`:

```bash
curl http://localhost:3000/api/rates
curl -X POST http://localhost:3000/api/refresh
```

## Rate refresh and caching

- Rates are fetched on startup and then every hour.
- After each successful fetch, the state is written to `rates.json` next to `server.js`. On startup this file is loaded first, so the last known rates are available even if Boursorama is unreachable.
- If a fetch partially fails, the currencies that did succeed are updated and the others keep their previous value. The error is exposed in `lastError` and shown in the UI.
- Only one refresh runs at a time; concurrent requests to `/api/refresh` share the same fetch.

## Deploying to Netlify

`server.js` is a long-running Node process, which Netlify does not run: a plain Netlify deploy only serves static files, so `/api/rates` returns **404**. The repo therefore also ships the API as a Netlify Function:

- `netlify.toml` publishes the repo root (for `index.html`) and points to `netlify/functions`.
- `netlify/functions/api.mjs` handles `GET /api/rates` and `POST /api/refresh` using the same scraping code as the local server (`lib/rates.js`).
- `netlify/functions/refresh-rates.mjs` is a [Scheduled Function](https://docs.netlify.com/build/functions/scheduled-functions/) that runs every hour (`@hourly`, minute 0 UTC) and refreshes the rates even when nobody visits the site.
- `netlify/lib/store.mjs` persists the state in [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) (store `rates`, key `state`), so every function instance serves the same rates and nothing is lost on cold starts.

Just connect the repo to Netlify (no build command needed) and push. Netlify installs `@netlify/blobs` from `package.json` and the deploy log should show "2 functions bundled" (`api`, `refresh-rates`). The UI works unchanged. `.nvmrc` pins Node 22 for the build, which Netlify also uses as the functions runtime (`@netlify/blobs` needs Node >= 22.12).

How it differs from the local server:

- The hourly refresh is done by the scheduled function instead of a `setInterval`. `nextUpdateAt` shown in the UI is the next scheduled run.
- `GET /api/rates` reads the shared state from Blobs. If it is older than one hour (first deploy before the first scheduled run, or a missed run) it refreshes inline before answering.
- **Actualiser maintenant** (`POST /api/refresh`) fetches fresh rates and writes them to Blobs, so all visitors see them.
- The committed `rates.json` is bundled and used only while the Blobs store is still empty. There is no need to recommit it.
- To trigger the scheduled function by hand: Netlify UI → Functions → `refresh-rates` → **Run now**, or `netlify functions:invoke refresh-rates` with `netlify dev` (which uses a sandboxed local Blobs store).

## Adding a currency

Edit the `CURRENCIES` array at the top of `lib/rates.js`. Each entry has:

- `code`: ISO code shown in the UI.
- `name`: display name.
- `toEur`: Boursorama symbols quoting `CCY/EUR`, tried first and used directly.
- `fromEur`: Boursorama symbols quoting `EUR/CCY`, used as a fallback and inverted.

Example:

```js
{ code: 'CHF', name: 'Franc suisse', toEur: ['3fCHF_EUR'], fromEur: ['1xCHFVS'] },
```

Restart the server afterwards. The UI picks up the new currency automatically from the API.

## Project layout

| File                         | Purpose                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `lib/rates.js`               | Currency list, Boursorama scraping, state refresh (shared).          |
| `server.js`                  | Local HTTP server: UI, JSON API, hourly refresh, `rates.json` cache. |
| `netlify/functions/api.mjs`  | Same JSON API as a Netlify Function, state read from Netlify Blobs.  |
| `netlify/functions/refresh-rates.mjs` | Scheduled Function (`@hourly`) refreshing the rates on Netlify. |
| `netlify/lib/store.mjs`      | Netlify Blobs persistence shared by the two functions.               |
| `netlify.toml`               | Netlify configuration (publish dir, functions dir, bundler).         |
| `index.html`                 | Single-page UI (French), served at `/`.                              |
| `rates.json`                 | Cache of the last successful fetch. Generated automatically.         |
| `package.json`               | Project metadata and the `npm start` script.                         |

## Troubleshooting

- **"Aucun taux disponible pour le moment"**: the first fetch has not finished or failed, and there is no `rates.json` cache yet. Check the server console for the error and try **Actualiser maintenant**.
- **`HTTP 4xx/5xx for symbol "..."` or `non-JSON response`**: Boursorama changed or blocked the endpoint for that symbol. Add an alternative symbol to `toEur` or `fromEur` for that currency.
- **Port already in use**: start the server with a different `PORT` as shown above.
- **`404 Not Found` on `/api/rates` on Netlify**: `netlify.toml` or `netlify/functions/api.mjs` is missing from the deployed commit, or the site's "Functions directory" setting in the Netlify UI overrides it. Check the deploy log for "1 function bundled (api)".
"# currency-tester" 
