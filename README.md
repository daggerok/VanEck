# VanEck

VanEck ETF holdings to Watchlist. A single-file client-side tool that reads the generated `./api/vaneck` static feed (the vaneck.com ETF fund finder, per-fund product pages and daily holdings — official NAV returns, expenses, yields, the complete daily holdings list and the whole-life daily NAV history — with SEC EDGAR N-PORT-P and Yahoo Finance only as fallbacks) into a searchable ETF / asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Shared UI contract

The common interaction and data-state rules are documented in [`docs/ui-contract.md`](./docs/ui-contract.md) and the catalog table requirements in [`docs/catalog-ui-requirements.md`](./docs/catalog-ui-requirements.md). New provider-specific behavior should preserve this contract. The provider-specific data plan is documented in [`docs/plan-vaneck.md`](./docs/plan-vaneck.md).

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| Amplify ETF Holdings to Watchlist | Amplify ETFs (Firestore data feed) | [daggerok/Amplify](https://github.com/daggerok/Amplify) · [published app](https://daggerok.github.io/Amplify/) |
| iShares Excel .xls to Watchlist | iShares (BlackRock) product workbooks | [daggerok/iShares](https://github.com/daggerok/iShares) · [published app](https://daggerok.github.io/iShares/) |
| SPDR ETF Holdings to Watchlist | SSGA / State Street public feeds | [daggerok/SPDR](https://github.com/daggerok/SPDR) · [published app](https://daggerok.github.io/SPDR/) |
| Fidelity ETF Holdings to Watchlist | SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) · [published app](https://daggerok.github.io/Fidelity/) |
| Invesco ETF Holdings to Watchlist | Invesco public downloads + Yahoo Finance | [daggerok/Invesco](https://github.com/daggerok/Invesco) · [published app](https://daggerok.github.io/Invesco/) |
| WisdomTree ETF Holdings to Watchlist | WisdomTree U.S. product table + SEC EDGAR N-PORT-P + Yahoo Finance | [daggerok/WisdomTree](https://github.com/daggerok/WisdomTree) · [published app](https://daggerok.github.io/WisdomTree/) |
| JPMorgan ETF Holdings to Watchlist | am.jpmorgan.com fund explorer + product-data / historical-data JSON (SEC EDGAR N-PORT-P + Yahoo Finance as fallbacks) | [daggerok/JPMorgan](https://github.com/daggerok/JPMorgan) · [published app](https://daggerok.github.io/JPMorgan/) |
| VanEck ETF Holdings to Watchlist | vaneck.com ETF finder + product pages / holdings CSV (SEC EDGAR N-PORT-P + Yahoo Finance as fallbacks) | [daggerok/VanEck](https://github.com/daggerok/VanEck) · [published app](https://daggerok.github.io/VanEck/) |

## Using Bun

```bash
bunx degit daggerok/VanEck#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/VanEck/>.

## Updating the static VanEck data

Run the updater with Bun:

```bash
bun test scripts/update-data.test.ts
./scripts/update-data.ts
```

Run `./scripts/update-data.ts -h` (or `--help`) to print every configuration variable with its default and usage examples.

The **Update VanEck ETF data** GitHub Actions workflow exposes the same settings as manual inputs. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US VanEck ETFs), ticker, asset class, inception, NAV, market price, premium/discount, net assets, month-end 30-day SEC yield, official month-end and quarter-end returns | `https://www.vaneck.com/us/en/etf-mutual-fund-finder/etfs/` (the JSON behind the [ETF finder](https://www.vaneck.com/us/en/etf-mutual-fund-finder/); `FINDER_URL` / `CATALOG_URL` override it) |
| Expense ratio, exchange, shares outstanding, holdings count, daily 12-month rolling dividend yield, daily 30-day SEC yield, official "At NAV" month-end + cumulative returns, latest dividend, distribution frequency code, **complete daily holdings** with CUSIP / ISIN identifiers | `https://www.vaneck.com/us/en/investments/{SLUG}/holdings/` (the HTML/JSON behind each fund page, e.g. [GDX](https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/holdings/) and [SMH](https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/holdings/)) |
| Daily history (NAV, market price, premium/discount for every business day since inception), dividend schedule, official quarter-end returns | VanEck product pages historical NAV tables + `https://www.vaneck.com/api/funds/{TICKER}/history` (where available) |
| Human download links recorded in `meta.json` (`source.holdingsDownload`, `source.pricesDownload`) | `https://www.vaneck.com/us/en/investments/{SLUG}/holdings/` → "Download Holdings" CSV/XLSX and "NAV & Premium/Discount History" CSV — the workbooks of the fund page |
| Catalog fallback (finder unreachable) | The previously published `api/vaneck/index.json` plus the share classes the VanEck ETF Trust lists in the SEC fund-ticker table |
| Holdings fallback (funds whose product page lists no positions) | SEC EDGAR Form **N-PORT-P** of the fund itself: `https://www.sec.gov/files/company_tickers_mf.json` maps the ticker to its registrant CIK + series id (VanEck ETFs belong to CIK 0001137360 and 0001013881), `browse-edgar` (`output=atom`, `type=NPORT-P`) returns that series' newest filing and `primary_doc.xml` carries the positions; `efts.sec.gov` full-text search stays as the last resort |
| Exchange tickers for N-PORT positions | `https://www.sec.gov/files/company_tickers.json` (issuer name → symbol), so filed positions still land in the Watchlist with a real ticker |
| History fallback (official history unavailable for a fund) | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=0&period2=…&interval=1d&events=div\|split`), rows in the sibling `Date, Close, Adj Close, Volume` layout; disabled with `SKIP_YAHOO` |

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` — the **official VanEck** "At NAV" month-end YTD and 1-year returns → *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` — VanEck's published annualized 3Y/5Y/10Y figures → *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` — the official **cumulative** 3Y/5Y/10Y figures; when a fund lacks that block the exact inverse `(1 + CAGR nY)^n − 1` is used → *TR 3Y/5Y/10Y*
- `siAnn` — since-inception annualized (VanEck; funds younger than one year see below) → *SI Ann.*
- `dividendYield` — the 12-month rolling dividend yield published by VanEck; when absent, the **indicated** yield (latest distribution × payments per year ÷ market price)
- `secYield` — the 30-day SEC yield VanEck publishes; `—` only when VanEck publishes none
- `monthEnd` / `quarterEnd` return blocks in `returns` keep the same shape as SPDR/Fidelity (`mo1`, `qtd`, YTD/1Y/3Y/5Y/10Y/SI plus `*Text` renderings)

Known value limitations (documented honestly, like the sibling feeds):

- **Holdings are the latest published snapshot only** — vaneck.com ships no historical holdings archive, so the feed has one sheet per fund, exactly like the SPDR and Invesco feeds.
- **Multi-year returns are annualized at the source.** VanEck publishes 3Y/5Y/10Y/SI as annualized figures and the cumulative ones in a separate block; both are read directly whenever they exist.
- **Funds launched in the current calendar year have no YTD / 1Y / SI Ann.** VanEck publishes no year-to-date or one-year figure for them, and its since-inception figure for funds under one year is *cumulative*.
- **Dividend Yield** is `—` for funds that have not paid a distribution yet; `meta.json` records which flavour was used (`yields.dividendYieldKind`), and the Overview tab shows it.
- **SEC Yield (30-day)** is missing only where VanEck publishes none; the row renders `—`.
- **Bond, money-market and derivative positions carry no exchange ticker** (`Ticker: "-"`). They are identified by CUSIP/ISIN (`Identifier`); the Watchlist deduplicates by `Ticker` when present and falls back to `Identifier` — the exact same convention as the SPDR, iShares and Invesco feeds.
- **Holdings taken from N-PORT-P** (fallback only) carry no ticker in the filing itself; the SEC company-ticker table restores the symbol for listed issuers.
- **History rows are official NAV / market price / premium-discount** rather than exchange closes; the Yahoo fallback keeps the sibling `Date, Close, Adj Close, Volume` layout.

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | all | Batch size: with a positive value the updater continues after the committed cursor in `api/vaneck/update-state.json`; empty or `0` (the default) is a **full pass** — every fund in the catalog is refreshed in one run, starting from the first ticker, and the cursor is reset when it completes. |
| `REQUEST_SLEEP` | `1` | Minimum delay in seconds between outgoing request starts, including retries. vaneck.com, the SEC and Yahoo throttle bursty clients; keep ≥ 1. |
| `CONCURRENCY` | `2` | Number of parallel fund update workers. Request starts are still globally spaced by `REQUEST_SLEEP`. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Gross expense ratio range in % (strict `min:max`). |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range (published 12-month rolling, or indicated when derived). |
| `SEC_YIELD` | `:` | 30-day SEC yield percentage range. |
| `PERFORMANCE_YTD` … `PERFORMANCE_10Y` | `:` | Annualized return ranges (YTD, 1Y, 3Y, 5Y, 10Y). |
| `TOTAL_RETURN_YTD` … `TOTAL_RETURN_10Y` | `:` | Cumulative return ranges. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, for example `GDX SMH MOAT ESPO`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page. |
| `HISTORY_RANGE` | `max` | Yahoo chart range for the fallback history rows (`max`, `10y`, `5y`, …); the official VanEck history always covers the fund's whole life. |
| `STORE_RAW_DOWNLOADS` | off | Store the source finder / holdings JSON payloads (and N-PORT XML) under `api/vaneck/raw`. |
| `MAX_RETRIES` | `2` | Retries after the initial request. Only network errors and HTTP 403/408/425/429/5xx are retried, with bounded exponential backoff. |
| `FINDER_URL` | fund finder JSON | Override the catalog JSON URL. |
| `EDGAR_FALLBACK` | on | Set `0` to skip the SEC EDGAR N-PORT-P fallback for funds whose product page lists no holdings. |
| `SEC_UA` | declared UA | Override the SEC User-Agent. SEC policy requires automated tools to declare a contact. |
| `SKIP_YAHOO` | off | Never call the Yahoo chart API, even when the official history is unavailable for a fund. |
| `SKIP_VANECK` | off | Keep the previously published catalog values, holdings and official returns; only the fallbacks run. |

`TICKERS` combines with AUM, TER, yield and return filters using AND logic; it does not override them. Funds not selected for a successful update keep their prior published metadata and data files.

### Full passes and resuming bounded runs

Running the updater with no arguments and no environment variables (`./scripts/update-data.ts`, exactly what the GitHub Actions workflow does) refreshes **every** VanEck ETF in the catalog in one pass: the saved cursor is ignored, funds are processed in alphabetical ticker order, and `api/vaneck/update-state.json` is reset (`cursor: null`) when the pass finishes.

A positive `MAX_FETCHES` is a batch size, not a permanent first-page limit. Bounded runs continue after the committed cursor and wrap around at the end, so repeated batches still walk the whole catalog.

### Strict range syntax

All range variables use `min:max` — both bounds are inclusive and optional, but the **colon is required**: `15:`, `:0.5`, `0.1:0.5`, `:`. A missing colon is an error (this strictness matches the sibling repos). Percent and dollar signs are optional.

### AUM ranges and presets

Bounds accept plain USD amounts or `K`/`M`/`B`/`T` suffixes (`10M:2B`). A whole value may be one of the size presets: `nano` (< $10M), `micro` ($10M–$300M), `small` ($300M–$2B), `mid` ($2B–$10B), `large` (> $10B).

### Return ranges

`PERFORMANCE_*` filters match annualized figures (CAGR for multi-year periods), `TOTAL_RETURN_*` filters match cumulative ones — the same pairing the sibling apps expose. Values come from the official VanEck NAV returns where published, otherwise from the daily NAV history with the published distributions reinvested.

### Examples

```bash
MAX_FETCHES=10 ./scripts/update-data.ts
TICKERS="GDX SMH MOAT" ./scripts/update-data.ts
AUM="1B:" TER=":0.5" ./scripts/update-data.ts
PERFORMANCE_1Y="15:" ./scripts/update-data.ts
STORE_RAW_DOWNLOADS=1 ./scripts/update-data.ts
SKIP_YAHOO=1 ./scripts/update-data.ts
```

## Uploading N-PORT files in the browser

The header toolbar includes the same integrated drag-and-drop upload as `daggerok/iShares` and `daggerok/Fidelity`, N-PORT flavored: drop or pick a **Form N-PORT-P `primary_doc.xml`** (a VanEck ETF Trust filing from EDGAR) and the app parses it entirely in your browser — no network — merging the fund (and overriding its holdings when the ticker is already in the feed) into the catalog, detail tabs and Watchlist. Uploads live for the current browser session only.

## Developer notes

- `scripts/update-data.ts` — Bun updater, zero runtime dependencies (`node:fs/promises` + `fetch` only): VanEck finder / holdings readers, a forgiving N-PORT-P XML reader (same hand-rolled spirit as SPDR's workbook reader and Fidelity's EDGAR layer), Yahoo chart reader, derived-metric helpers (`navTotalReturnDays`, `reinvestmentCoverageStart`, `priceReturns`, `annualizedToTotal`, `totalToAnnualized`, `indicatedYield`, `inferDistributionFrequency`, `deriveCatalogMetrics`), strict range parsers, bounded-run cursor, retries with 403/429 back-off, deterministic content-only writes.
- `scripts/update-data.test.ts` — `bun test` suite: range parsers, holdings parsing, N-PORT fixtures, chart fixtures, price-return derivation incl. young-fund nulls and the reinvestment coverage guard, quarter anchoring, catalog metric derivation, holding-name normalization, and URL builders.
- `scripts/check-index.ts` — Bun transpile check for the browser TypeScript (`app.tsx` + the `index.html` bootstrap), preventing a syntax error from leaving the published catalog on its loading screen.
- `scripts/ui-harness.ts` / `scripts/ui.test.ts` — headless acceptance suite for the UI contract (fake DOM + file-backed fetch over `api/vaneck/`): per-tab sort/filter persistence, 1-click search clear, exact selection scopes, race-free holdings loading, Watchlist dedupe and chunked rendering. Run with `bun test`.
- `api/vaneck/**` — the generated static feed: `index.json`, `funds/{TICKER}/meta.json`, paginated `holdings/` + `history/` pages, `update-state.json`.
- `index.html` + `app.tsx` — the single-page TypeScript UI (markup, styles and bootstrap in `index.html`, all logic in `app.tsx` compiled in the browser by Babel standalone), matching the sibling repositories' searchable catalog, persistent selection/blacklist, watchlist aggregation, detail tabs, exports and N-PORT upload workflow.
- The app keeps search and sort preferences in browser localStorage and reapplies them after reload. **Sort order is remembered per tab** (`vaneck-tab-sorts`) and is **never reset by any button or checkbox**: sort All ETFs by *YTD Return*, round-trip through Watchlist or a fund detail tab, toggle select-all, search, blacklist, export, switch the theme or press **Clear** — the YTD Return order is still there. A tab that was never sorted keeps its default order (Watchlist: Weight Sum desc, Overview: Section asc, sheets: source order); **Clear** clears only the selection and the searches. To return to the default catalog order, click the *Ticker* header (asc).
- **Search filters are remembered per tab** (`vaneck-tab-filters`, mirrored under `sheetFilter` in `vaneck-site-state`): the search input is scoped to the active tab, switching tabs restores that tab's query (tabs without a filter show their full dataset), and the right-edge **✕** button (`#search-clear-btn`) clears the active tab's filter with one click. The last active tab also survives reload. Malformed stored values are sanitized at boot and can never crash the app.
- **Selection scopes are exact**: the row Use checkbox toggles one ETF; the header Use checkbox acts only on the rows currently rendered by the catalog table (catalog + active search filter + blacklist); the **All ETFs** pill checkbox acts on every non-blacklisted ETF in the whole catalog from any tab, without navigating. Every selection change immediately updates the subtitle ticker badges, the active fund, the detail-tab counts and the Watchlist label.
- **Watchlist aggregation is race-free and bounded**: `meta.json` requests dedupe per ticker, each ticker has one serialized holdings-page loader shared by the detail pager and the background loader (no duplicated or skipped pages), whole-catalog loading runs with 6 bounded workers, and the tab shows `Watchlist (Loading…)` → `Watchlist (N+)` → the exact deduplicated count. Dedupe keys fall back Ticker → CUSIP → ISIN → Identifier → SEDOL/FIGI → Name with namespaced keys; blank/`-`/`N/A` placeholders and the all-zero `000000000` CUSIP count as missing, and bond, cash, derivative and zero-weight rows are never dropped. The table renders in 250-row chunks that grow on scroll, while Copy Tickers / CSV / TXT always export the complete filtered result. The full contract is documented in [`docs/ui-contract.md`](./docs/ui-contract.md).
- Verification before every publish: `bun install --frozen-lockfile`, `bun test` (updater suite + UI contract acceptance suite), `bunx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --types bun,node --skipLibCheck scripts/update-data.ts scripts/update-data.test.ts`, `bun ./scripts/check-index.ts` (browser TypeScript transpile check) and `git diff --check`.
- Updater controls belong to `workflow_dispatch` and are visible on the GitHub Actions **Run workflow** form. They are not controls in the published web application. The workflow is manual: merging updater changes does not run a data update automatically, and a successful run commits only `api/vaneck/**`.

## TypeScript

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone, following the `daggerok/youtube` no-src-files approach used by the sibling applications (no framework, bundler or build step).

## Brands table

| Бренд                        | Фонды | Где брать данные |
|------------------------------|---|---|
| **VanEck** (5) ✅ | GDX, SMH, MOAT, ESPO, BJK (+ весь каталог ~70 ETF: OIH, REMX, MORT, ITB…) | [GDX](https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/holdings/) · [SMH](https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/holdings/) · каталог: [vaneck.com ETF finder](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) — весь каталог VanEck ETF уже интегрирован в наше приложение [daggerok/VanEck](https://github.com/daggerok/VanEck) |
| **JPMorgan** (2) ✅ | JEPI, JEPQ (+ весь каталог ~78 ETF: JPST, BBJP, JIRE, JGLO, JQUA…) | [JEPI](https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332) · [JEPQ](https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-nasdaq-equity-premium-income-etf-etf-shares-46654q203) · каталог: [am.jpmorgan.com ETF fund explorer](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) — весь каталог JPMorgan ETF уже интегрирован в наше приложение [daggerok/JPMorgan](https://github.com/daggerok/JPMorgan) |
| **Invesco** (14) ✅ | QQQM, RSP, SPLV, SPHD, SPMO, SPHQ, SPGP, RPV, RPG, RWL, DBA, IDMO, IDHQ, IDLV (+ QQQ и весь каталог ~245 ETF) | [invesco.com `?ticker=`](https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=IDHQ) · каталог: [www.invesco.com/us/en/financial-products/etfs.html](https://www.invesco.com/us/en/financial-products/etfs.html) — весь каталог Invesco ETF уже интегрирован в наше приложение [daggerok/Invesco](https://github.com/daggerok/Invesco) |
| **SPDR / State Street** ✅ | SPYM, SPYG, SPYD, SDY, XLK, XLF… | [daggerok/SPDR](https://github.com/daggerok/SPDR) — весь каталог SSGA (179 фондов) |
| **iShares / BlackRock** ✅ | IVV, SGOV, DGRO, SOXX… | [daggerok/iShares](https://github.com/daggerok/iShares) — весь каталог, XLS-экспорт |
| **Amplify** ✅ | DIVO, IDVO, SILJ… | [daggerok/Amplify](https://github.com/daggerok/Amplify) — Firestore-фид данных |
| **Fidelity** ✅ | FTEC, FDVV, FDIS, FCOM + каталог Fidelity ETF | [daggerok/Fidelity](https://github.com/daggerok/Fidelity) — holdings из SEC EDGAR N-PORT |
| **WisdomTree** ✅ | DGRW + каталог WisdomTree ETF | [daggerok/WisdomTree](https://github.com/daggerok/WisdomTree) — таблица продуктов WisdomTree + SEC EDGAR N-PORT |

## Brands list

#	Бренд	Фонды из списка (кол-во)	Официальный сайт / страницы фондов
1	VanEck — 5 ✅	GDX, SMH, MOAT, ESPO, BJK	https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/holdings/ · …/semiconductor-etf-smh/holdings/ (паттерн …/investments/{slug}/holdings/) · каталог: https://www.vaneck.com/us/en/etf-mutual-fund-finder/ — весь каталог VanEck ETF (~70 фондов) уже интегрирован в наше приложение https://github.com/daggerok/VanEck
2	JPMorgan Asset Management — 2 ✅	JEPI, JEPQ	https://am.jpmorgan.com/us/en/asset-management/adv/products/jpmorgan-equity-premium-income-etf-etf-shares-46641q332 · …/jpmorgan-nasdaq-equity-premium-income-etf-etf-shares-46654q203 (паттерн …/products/{name-slug}-etf-shares-{cusip}) · каталог: https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf — весь каталог JPMorgan ETF (~78 фондов) уже интегрирован в наше приложение https://github.com/daggerok/JPMorgan
3	Invesco — 14 ✅	QQQM, RSP, SPLV, SPHD, SPMO, SPHQ, SPGP, RPV, RPG, RWL, DBA, IDMO, IDHQ, IDLV	https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker={TICKER} (паттерн ?ticker={TICKER}) · каталог: https://www.invesco.com/us/en/financial-products/etfs.html — весь каталог Invesco ETF (~245 фондов) уже интегрирован в наше приложение https://github.com/daggerok/Invesco
4	SPDR / State Street — 14 ✅	SPYM (бывш. SPLG), SPYG, SPYD, SDY, XTL + секторы XLK, XLF, XLV, XLY, XLU, XLC, XLI, XLP, XLE	https://us.spdrs.com/ · каталог: https://www.ssga.com/us/en/intermediary/etfs/fund-finder · секторы: https://www.selectsectorspdrs.com/ — весь каталог SSGA уже интегрирован в наше приложение https://github.com/daggerok/SPDR
5	iShares (BlackRock) — 12 ✅	IVV, SGOV, DGRO, SOXX, MTUM, DVY, HDV, IAUM, PICK (Global Metals & Mining), GARP (MSCI USA Quality GARP), SLVP (Global Silver Miners), RING (Global Gold Miners)	https://www.ishares.com/ — XLS-экспорт holdings со страниц фондов (уже интегрирован в наше приложение https://github.com/daggerok/iShares)
6	Fidelity — 5 ✅	FTEC, FDVV, FDIS, FCOM, FNILX*	https://www.fidelity.com/etfs · исследование: https://fundresearch.fidelity.com/ (*FNILX — взаимный фонд ZERO, не ETF) — holdings из SEC EDGAR N-PORT, уже интегрирован в наше приложение https://github.com/daggerok/Fidelity
7	Amplify — 3 ✅	DIVO, IDVO (CWP Intl Enhanced Dividend), SILJ (Junior Silver Miners, экс-ETFMG)	https://amplifyetfs.com/ — Firestore-фид данных (уже интегрирован в наше приложение https://github.com/daggerok/Amplify)
8	WisdomTree — 1 ✅	DGRW	https://www.wisdomtree.com/investments/etfs/dgrw — таблица продуктов WisdomTree + SEC EDGAR N-PORT (уже интегрирован в наше приложение https://github.com/daggerok/WisdomTree)
