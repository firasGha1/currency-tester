# Currency Tester

A small currency converter that pulls exchange rates from [boursorama.com](https://www.boursorama.com) every hour and shows them in a single-page web UI. It has no npm dependencies: only Node.js 18 or newer is required.

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

## Adding a currency

Edit the `CURRENCIES` array at the top of `server.js`. Each entry has:

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

| File           | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `server.js`    | HTTP server, Boursorama scraping, hourly refresh, cache.       |
| `index.html`   | Single-page UI (French), served at `/`.                        |
| `rates.json`   | Cache of the last successful fetch. Generated automatically.   |
| `package.json` | Project metadata and the `npm start` script.                   |

## Troubleshooting

- **"Aucun taux disponible pour le moment"**: the first fetch has not finished or failed, and there is no `rates.json` cache yet. Check the server console for the error and try **Actualiser maintenant**.
- **`HTTP 4xx/5xx for symbol "..."` or `non-JSON response`**: Boursorama changed or blocked the endpoint for that symbol. Add an alternative symbol to `toEur` or `fromEur` for that currency.
- **Port already in use**: start the server with a different `PORT` as shown above.
"# currency-tester" 
