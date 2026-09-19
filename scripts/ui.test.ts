/**
 * Acceptance tests for the VanEck ETF UI contract (index.html + app.tsx).
 *
 * These boot the real application script (transpiled exactly as Babel
 * standalone would do) inside a headless harness (scripts/ui-harness.ts)
 * that serves the actual generated feed from api/vaneck/. Expected
 * values are computed independently from the feed (oracle helpers in the
 * harness) — nothing is hardcoded from other providers.
 */
import { expect, test } from "bun:test";
import {
  AppHandle,
  MemoryStorage,
  catalogTickers,
  createApp,
  expectedWatchlist,
  feedJson,
  sleep,
  until,
} from "./ui-harness";

const SORTS_KEY = "vaneck-tab-sorts";
const FILTERS_KEY = "vaneck-tab-filters";
const SELECTED_KEY = "vaneck-selected-etfs";
const ACTIVE_FUND_KEY = "vaneck-active-fund";
const BLACKLIST_KEY = "vaneck-blacklisted-etfs";
const SITE_STATE_KEY = "vaneck-site-state";

// Bounds read from this repo's feed and app, never copied from another brand.
const WATCHLIST_CHUNK = 250; // app.tsx WATCHLIST_PAGE_SIZE
const FEED = feedJson("index.json");

/** Total published holding rows across every fund in api/vaneck/. */
function feedHoldingsRowCount(): number {
  return FEED.funds.reduce((sum: number, fund: any) => sum + Number(fund.holdings || 0), 0);
}


async function bootFresh(storage?: MemoryStorage): Promise<AppHandle> {
  const app = await createApp({ storage });
  await app.boot();
  return app;
}

// --- DOM helpers -------------------------------------------------------------

function sortButton(app: AppHandle, key: string) {
  const button = app
    .el("table-head")
    .querySelectorAll("button[data-sort]")
    .find((el) => el.dataset.sort === key);
  if (!button) throw new Error(`sort header not found: ${key}`);
  return button;
}

function clickSort(app: AppHandle, key: string) {
  sortButton(app, key).click();
}

function catalogRow(app: AppHandle, ticker: string) {
  const row = app.el("table-body").querySelector(`tr[data-ticker="${ticker}"]`);
  if (!row) throw new Error(`catalog row not found: ${ticker}`);
  return row;
}

function toggleRow(app: AppHandle, ticker: string) {
  catalogRow(app, ticker).click();
}

function headerCheckbox(app: AppHandle) {
  const cb = app.el("table-head").querySelector("#select-all-checkbox");
  if (!cb) throw new Error("header select-all checkbox not found");
  return cb;
}

function pillCheckbox(app: AppHandle) {
  const cb = app.el("tabs-bar").querySelector("#select-all-toggle");
  if (!cb) throw new Error("All ETFs pill checkbox not found");
  return cb;
}

function allTabButton(app: AppHandle) {
  const button = app.el("tabs-bar").querySelector('button[data-tab="All"]');
  if (!button) throw new Error("All ETFs tab button not found");
  return button;
}

function setChecked(el: { checked: boolean; dispatch: (t: string, i?: Record<string, unknown>) => void }, checked: boolean) {
  el.checked = checked;
  el.dispatch("change", { target: el });
}

function setSearch(app: AppHandle, query: string) {
  const input = app.el("search-input");
  input.value = query;
  input.dispatch("input", { target: input });
}

async function waitForTab(app: AppHandle, tabId: string) {
  await until(() => app.run<any>("state.activeTab") === tabId, 10000);
  // let async renders settle
  await sleep(60);
}

async function clickTab(app: AppHandle, tabId: string) {
  const button =
    app.el("selected-tabs-bar").querySelector(`button[data-tab="${tabId}"]`) ??
    app.el("tabs-bar").querySelector(`button[data-tab="${tabId}"]`);
  if (!button) throw new Error(`tab button not found: ${tabId}`);
  button.click();
  await waitForTab(app, tabId);
}

function selectedTickers(app: AppHandle): string[] {
  return app.run<string[]>("[...state.selected]").sort();
}

function watchlistTabLabel(app: AppHandle): string {
  const match = /Watchlist\s*\(([^)]*)\)/.exec(app.el("selected-tabs-bar").innerHTML);
  return match ? match[1] : "";
}

async function waitWatchlistCount(app: AppHandle, expected: number, timeoutMs = 120000) {
  await until(() => app.run<number>("getDedupedWatchlistRows().length") === expected, timeoutMs);
}

/** True once every selected ETF's holdings finished loading. */
async function waitForHoldingsSettled(app: AppHandle, timeoutMs = 300000) {
  await until(() => app.run<boolean>("isHoldingsLoading()") === false, timeoutMs);
}

function bodyRowHtml(app: AppHandle): string {
  return app.el("table-body").innerHTML;
}

function bodyRowCount(app: AppHandle): number {
  return (bodyRowHtml(app).match(/<tr\b/g) ?? []).length;
}

// =============================================================================
// 1. Sort persistence round-trip
// =============================================================================

test("1. per-tab sort survives tabs, checkboxes, buttons, Clear, and reload", async () => {
  const app = await bootFresh();

  // explicit non-default catalog sort
  clickSort(app, "ytd"); // 'YTD Return' numeric column -> starts descending
  expect(app.run<any>("state.sortKey")).toBe("ytd");
  expect(app.run<any>("state.sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("YTD Return ↓");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY)!)).toEqual({
    All: { key: "ytd", dir: "desc" },
  });

  // select a fund and round-trip through the Watchlist tab
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "watchlist");
  expect(app.run<any>("state.activeTab")).toBe("watchlist");

  // Watchlist gets its own sort; catalog memory must stay untouched
  clickSort(app, "fundCount"); // '# ETFs'
  expect(app.run<any>("state.sortKey")).toBe("fundCount");

  // All ETFs button returns to the catalog with the remembered sort
  allTabButton(app).click();
  await waitForTab(app, "All");
  expect(app.run<any>("state.sortKey")).toBe("ytd");
  expect(app.run<any>("state.sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("YTD Return ↓");

  // header Use checkbox + All ETFs pill checkbox must not reset sorting
  setChecked(headerCheckbox(app), true);
  setChecked(pillCheckbox(app), true);
  setChecked(pillCheckbox(app), false);
  setChecked(headerCheckbox(app), false);
  expect(app.run<any>("state.sortKey")).toBe("ytd");

  // search, Copy Tickers, theme toggle must not reset sorting
  setSearch(app, "bond");
  setSearch(app, "");
  app.el("copy-btn").click();
  app.el("theme-toggle").click();
  expect(app.run<any>("state.sortKey")).toBe("ytd");

  // Clear removes selection and search only — never the remembered sort
  app.el("reset-btn").click();
  expect(app.run<string[]>("[...state.selected]")).toEqual([]);
  expect(app.el("search-input").value).toBe("");
  expect(app.run<any>("state.sortKey")).toBe("ytd");
  expect(app.run<any>("state.sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("YTD Return ↓");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY)!)).toEqual({
    All: { key: "ytd", dir: "desc" },
    watchlist: { key: "fundCount", dir: "desc" },
  });

  // full reload restores both per-tab sorts
  const reloaded = await bootFresh(app.storage);
  expect(reloaded.run<any>("state.sortKey")).toBe("ytd");
  expect(reloaded.run<any>("state.sortDir")).toBe("desc");
  expect(reloaded.el("table-head").innerHTML).toContain("YTD Return ↓");
}, 120000);

test("1b. Watchlist remembers its own sort separately from the catalog", async () => {
  const app = await bootFresh();
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "watchlist");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY) || "{}").watchlist).toBeUndefined();

  clickSort(app, "symbol"); // Ticker: asc
  clickSort(app, "symbol"); // asc -> desc
  expect(app.run<any>("state.sortKey")).toBe("symbol");
  expect(app.run<any>("state.sortDir")).toBe("desc");

  allTabButton(app).click();
  await waitForTab(app, "All");
  expect(app.run<any>("state.sortKey")).toBe("rank"); // catalog was never explicitly sorted

  await clickTab(app, "watchlist");
  expect(app.run<any>("state.sortKey")).toBe("symbol");
  expect(app.run<any>("state.sortDir")).toBe("desc");
}, 120000);

// =============================================================================
// 2+3. Header select-all is scoped to the visible (filtered) rows
// =============================================================================

test("2. header Use check selects exactly the filtered ETFs", async () => {
  const app = await bootFresh();
  setSearch(app, "moat"); // matches the five Morningstar Moat funds in this feed
  const visible = app.run<string[]>("visibleCatalogRows().map((f) => f.ticker)").sort();
  expect(visible).toEqual(["MOAT", "MOTG", "MOTI", "MVAL", "SMOT"]);

  setChecked(headerCheckbox(app), true);
  expect(selectedTickers(app)).toEqual(visible);
}, 60000);

test("2b. filtered bulk selection immediately opens the selected-fund panel", async () => {
  const app = await bootFresh();
  setSearch(app, "muni"); // the user-facing regression: select all visible matches
  const visible = app.run<string[]>("visibleCatalogRows().map((f) => f.ticker)").sort();
  // the six Municipal Bond funds plus TRUC, whose name contains "muni"
  // inside "Communication" — substring search over the published fields
  expect(visible).toEqual(["HYD", "ITM", "MLN", "SHYD", "SMB", "TRUC", "XMPT"]);

  setChecked(headerCheckbox(app), true);

  // Bulk selection must establish an active fund just like a row click. The
  // panel must be populated in the same render, not only after a hard reload.
  expect(app.run<any>("state.activeFundTicker")).toBe(visible[0]);
  expect(app.el("selected-tabs-panel").classList.contains("is-visible")).toBe(true);
  expect(app.el("selected-tabs-bar").innerHTML).toContain(`${visible[0]} Overview`);
}, 60000);

test("3. header Use uncheck removes only visible tickers; hidden selections survive", async () => {
  const app = await bootFresh();

  // a selection that will be hidden by the filter
  toggleRow(app, "OIH");
  await sleep(20);

  setSearch(app, "moat");
  const visible = app.run<string[]>("visibleCatalogRows().map((f) => f.ticker)").sort();
  expect(visible).not.toContain("OIH");

  setChecked(headerCheckbox(app), true);
  expect(selectedTickers(app)).toEqual([...visible, "OIH"].sort());
  // checked state: every visible row selected -> header box is checked
  expect(headerCheckbox(app).checked).toBe(true);

  setChecked(headerCheckbox(app), false);
  expect(selectedTickers(app)).toEqual(["OIH"]); // hidden selection survives
  expect(app.el("table-head").innerHTML.includes("YTD Return")).toBe(true);
}, 60000);

// =============================================================================
// 4. All ETFs pill checkbox: whole catalog, filter/tab independent, no nav
// =============================================================================

test("4. All ETFs pill selects the whole non-blacklisted catalog without navigating", async () => {
  const app = await bootFresh();
  const all = catalogTickers();
  app.run<any>("blacklistTickers(['OIH'])");
  await until(() => app.run<string[]>("[...state.blacklist]").length === 1);

  // from the Watchlist tab, with a filter active
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  setSearch(app, "bond");
  await clickTab(app, "watchlist");
  setChecked(pillCheckbox(app), true);

  expect(app.run<any>("state.activeTab")).toBe("watchlist"); // no navigation
  const selected = selectedTickers(app);
  expect(selected).not.toContain("OIH");
  expect(selected.length).toBe(all.length - 1);
  expect(selected).toEqual(all.filter((t) => t !== "OIH").sort());

  // checked state reflects the whole catalog, not the filtered view
  expect(pillCheckbox(app).checked).toBe(true);

  // unchecking clears the catalog selection and still does not navigate
  setChecked(pillCheckbox(app), false);
  expect(app.run<any>("state.activeTab")).toBe("All"); // watchlist tab no longer valid -> All
  expect(selectedTickers(app)).toEqual([]);

  // the pill also works from a fund detail tab
  setSearch(app, "");
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("GDX Overview"));
  await clickTab(app, "detail:holdings");
  setChecked(pillCheckbox(app), true);
  expect(app.run<any>("state.activeTab")).toBe("detail:holdings"); // still no navigation
  expect(selectedTickers(app).length).toBe(all.length - 1);
}, 300000);

// =============================================================================
// 5. Watchlist reacts to selection: Loading… then exact count
// =============================================================================

test("5. selecting one ETF shows Watchlist Loading then the exact count", async () => {
  const app = await bootFresh();
  // slow the selected fund down so the loading state is observable
  app.stats.latency = (url) => (url.includes("/GDX/") ? 60 : 0);

  toggleRow(app, "GDX");

  // immediately: no misleading exact "Watchlist (0)"
  await sleep(10);
  const labelDuringLoad = watchlistTabLabel(app);
  expect(labelDuringLoad).not.toBe("0");

  const expected = expectedWatchlist(["GDX"]).size;
  await until(() => watchlistTabLabel(app) === String(expected), 120000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(expected);
}, 180000);

// =============================================================================
// 6. Race-free holdings loading for overlapping rapid selections
// =============================================================================

test("6. rapid overlapping selections load without duplicate or skipped pages", async () => {
  const app = await bootFresh();
  app.stats.latency = (url) => (url.includes("/GDX/") || url.includes("/SMH/") ? 40 : 0);

  toggleRow(app, "GDX");
  toggleRow(app, "SMH"); // second selection while the first is still in flight

  const oracle = expectedWatchlist(["GDX", "SMH"]);
  await waitWatchlistCount(app, oracle.size);

  // every holdings page fetched exactly once — no duplicates, no gaps
  for (const ticker of ["GDX", "SMH"]) {
    const pages: string[] = feedJson(`funds/${ticker}/meta.json`).holdings.pages;
    for (const page of pages) {
      expect(app.stats.counts.get(`./api/vaneck/funds/${ticker}/${page}`) ?? 0).toBe(1);
    }
    // meta.json requests are deduplicated per ticker while in flight
    expect(app.stats.counts.get(`./api/vaneck/funds/${ticker}/meta.json`) ?? 0).toBe(1);
  }

  // an overlapping security reports both funds and correct weight aggregates
  const overlap = [...oracle.values()].find((row) => row.funds.size === 2 && row.hasWeight);
  expect(overlap).toBeDefined();
  const appRow = app
    .run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()")
    .find((row) => row.key === overlap!.key);
  expect(appRow).toBeDefined();
  expect((appRow!.funds as unknown[]).length).toBe(2);
  expect(Number(appRow!.weightSum)).toBeCloseTo(overlap!.weightSum, 10);
  expect(Number(appRow!.maxWeight)).toBeCloseTo(overlap!.maxWeight, 10);
}, 240000);

// =============================================================================
// 7. Deselection updates everything immediately
// =============================================================================

test("7. deselecting an ETF updates subtitle, tabs and Watchlist immediately", async () => {
  const app = await bootFresh();
  toggleRow(app, "GDX");
  toggleRow(app, "SMH");
  const both = expectedWatchlist(["GDX", "SMH"]).size;
  await waitWatchlistCount(app, both);
  expect(watchlistTabLabel(app)).toBe(String(both));

  toggleRow(app, "SMH"); // deselect — everything below must be synchronous

  const onlyGdx = expectedWatchlist(["GDX"]).size;
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(onlyGdx);
  expect(watchlistTabLabel(app)).toBe(String(onlyGdx));
  expect(app.el("app-subtitle").innerHTML).toContain("1 selected");
  expect(app.el("app-subtitle").innerHTML).not.toContain('data-activate-fund="SMH"');
  expect(app.el("selected-tabs-bar").innerHTML).not.toContain("SMH Overview");
  expect(app.el("selected-tabs-bar").innerHTML).toContain("GDX Overview");
  expect(app.run<any>("state.activeFundTicker")).toBe("GDX");
}, 240000);

// =============================================================================
// 8. Select-all loads the complete catalog aggregate; DOM stays bounded
// =============================================================================

test("8. selecting all ETFs aggregates the whole feed and keeps the DOM bounded", async () => {
  const app = await bootFresh();
  const all = catalogTickers();
  setChecked(pillCheckbox(app), true);
  expect(selectedTickers(app).length).toBe(all.length);

  const oracle = expectedWatchlist(all);
  await waitForHoldingsSettled(app, 600000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);

  await clickTab(app, "watchlist");
  expect(watchlistTabLabel(app)).toBe(String(oracle.size));

  // rendered watchlist DOM must stay bounded (chunked), never all rows at once
  const renderedRows = bodyRowCount(app);
  expect(renderedRows).toBeGreaterThan(0);
  // Every fund in this feed fits inside one chunk, so the whole aggregate is
  // rendered and still bounded; the cap is the chunk size plus the header row.
  expect(renderedRows).toBeLessThanOrEqual(WATCHLIST_CHUNK + 1);
  // 121 published rows deduplicate to 117: the "-USD CASH-" balance and the
  // "--" / Other/Cash row each appear in all three funds with holdings.
  expect(feedHoldingsRowCount()).toBe(121);
  expect(oracle.size).toBe(117);
  expect(oracle.get("T:-USD CASH-")!.funds.size).toBe(3);
  expect(oracle.get("N:OTHER/CASH")!.funds.size).toBe(3);

  // This aggregate (117) is smaller than the 250-row chunk, so the whole set
  // renders in one pass and scrolling cannot grow it further. The contract is
  // that the rendered DOM stays bounded by the chunk size in either case.
  expect(renderedRows).toBe(oracle.size); // bodyRowCount counts body rows only
  const scroll = app.el("table-scroll");
  scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - 100;
  scroll.dispatch("scroll", { target: scroll });
  expect(bodyRowCount(app)).toBeLessThanOrEqual(WATCHLIST_CHUNK + 1);

  // copy/export still operate on the complete filtered result
  const copyCount = app.run<number>("getVisibleWatchlistRows().length");
  expect(copyCount).toBe(oracle.size);
}, 600000);

// =============================================================================
// 9. Reload restores selection, active fund, and background loading
// =============================================================================

test("9. reload restores selection, active fund and rebuilds the Watchlist", async () => {
  const app = await bootFresh();
  toggleRow(app, "GDX");
  toggleRow(app, "SMH");
  const both = expectedWatchlist(["GDX", "SMH"]).size;
  await waitWatchlistCount(app, both);
  expect(app.run<any>("state.activeFundTicker")).toBe("SMH");

  const reloaded = await bootFresh(app.storage);
  expect(selectedTickers(reloaded)).toEqual(["GDX", "SMH"]);
  expect(reloaded.run<any>("state.activeFundTicker")).toBe("SMH");

  // background loading completes without any checkbox interaction
  await waitWatchlistCount(reloaded, both);
  await clickTab(reloaded, "watchlist");
  expect(watchlistTabLabel(reloaded)).toBe(String(both));
  // active fund tabs were restored in the background
  expect(reloaded.el("selected-tabs-bar").innerHTML).toContain("SMH Overview");
}, 300000);

// =============================================================================
// 10. Detail sheets render real rows and page onward
// =============================================================================

test("10. Holdings, History, Overview and Distributions render real rows", async () => {
  const app = await bootFresh();
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("GDX Overview"));

  await clickTab(app, "detail:holdings");
  const firstPageRow = feedJson("funds/GDX/holdings/001.json").rows[0];
  await until(() => bodyRowHtml(app).includes(String(firstPageRow.Name)));

  // shared envelope cache: the detail pager and the background Watchlist
  // loader reuse the same requests — every holdings page fetched exactly once
  await waitForHoldingsSettled(app);
  for (const page of feedJson("funds/GDX/meta.json").holdings.pages) {
    expect(app.stats.counts.get(`./api/vaneck/funds/GDX/${page}`) ?? 0).toBe(1);
  }

  await clickTab(app, "detail:history");
  // history is NOT preloaded by the background Watchlist loader: the detail
  // pager loads page 1, and infinite scroll loads page 2.
  await until(() => app.run<number>("sheetState.get('GDX:history').nextPage") >= 1, 30000);
  const historyRow = feedJson("funds/GDX/history/001.json").rows[0];
  await until(() => bodyRowHtml(app).includes(String(historyRow.Date)));
  expect(app.stats.counts.get("./api/vaneck/funds/GDX/history/001.json") ?? 0).toBe(1);

  const scroll = app.el("table-scroll");
  scroll.scrollHeight = 20000;
  scroll.scrollTop = 20000 - scroll.clientHeight - 100;
  scroll.dispatch("scroll", { target: scroll });
  await until(() => app.run<number>("sheetState.get('GDX:history').nextPage") === 2, 30000);
  expect(app.stats.counts.get("./api/vaneck/funds/GDX/history/002.json") ?? 0).toBe(1);
  const secondHistoryRow = feedJson("funds/GDX/history/002.json").rows[0];
  await until(() => bodyRowHtml(app).includes(String(secondHistoryRow.Date)));

  await clickTab(app, "detail:overview");
  expect(bodyRowHtml(app)).toContain("Holdings Rows");
  expect(bodyRowHtml(app)).toContain("SEC Yield (30-day)");

  // VanEck publishes no distributions download, so the tab stays present and
  // shows its explanatory empty state instead of being removed (contract 9.1).
  await clickTab(app, "detail:distributions");
  const distributions = feedJson("funds/GDX/meta.json").distributions;
  expect(distributions.rows.length).toBe(0);
  await until(() => bodyRowHtml(app).toLowerCase().includes("no published distribution"));
}, 180000);

// =============================================================================
// 11. Missing/failing fund data produces an explanatory state
// =============================================================================

test("11. a fund whose files fail to load shows an explanatory state", async () => {
  const app = await bootFresh();
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("GDX Overview"));
  await clickTab(app, "detail:holdings");
  await until(() => bodyRowHtml(app).length > 100);
  expect(bodyRowHtml(app)).not.toContain("Could not load");

  // back to the catalog so rows can be toggled again
  allTabButton(app).click();
  await waitForTab(app, "All");

  // now the selected fund's files "disappear" — the previous table must go
  const priorName = String(feedJson("funds/GDX/holdings/001.json").rows[0].Name);
  app.stats.blocked.add("funds/SMH/");
  toggleRow(app, "SMH"); // becomes the active fund; its files fail to load
  toggleRow(app, "GDX"); // deselect GDX so SMH is the only remaining fund
  await until(() => app.run<any>("state.activeFundTicker") === "SMH");
  await clickTab(app, "detail:holdings"); // must show the failure state, not GDX's table
  await until(() => bodyRowHtml(app).toLowerCase().includes("could not load"), 10000);
  const body = bodyRowHtml(app);
  expect(body).not.toContain(priorName); // prior fund's table is gone
  expect(body.toLowerCase()).toContain("could not load");
}, 180000);

// =============================================================================
// 12. Identifier fallbacks: bonds, cash, zero weights kept; placeholders dropped
// =============================================================================

test("12. bond rows fall back to identifiers; cash and zero-weight rows are kept", async () => {
  const app = await bootFresh();
  // VanEck's published daily holdings contain the cases this contract exists
  // for:
  //   GDX/SMH/OIH  six "-USD CASH-" style balances whose Ticker is a currency
  //                label and which publish no FIGI at all (kept, not dropped);
  //   GDX/SMH/OIH  an "--" / "Other/Cash" row whose Ticker AND Identifier are
  //                both placeholders, so it must fall through to the published
  //                Name rather than collapse into one garbage key;
  //   GDX          non-US listings carrying a local exchange suffix
  //                ("NST AU", "2259 HK", "PE&OLES* MF") — valid keys, not noise;
  //   SMH          a NEGATIVE weight cash balance (-0.02%) that must survive.
  // The fixed-income sheet (ANGL) has no Ticker column at all, so its FIGI-only
  // rows are covered by the parser unit tests in scripts/update-data.test.ts.
  const tickers = ["GDX", "SMH", "OIH"];
  for (const ticker of tickers) toggleRow(app, ticker);
  const oracle = expectedWatchlist(tickers);
  await waitForHoldingsSettled(app, 300000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);

  const rows = app.run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()");
  const shown = new Set(rows.map((r) => String(r.symbol)));
  for (const sample of oracle.values()) expect(shown.has(sample.shown)).toBe(true);

  // "--" placeholders never become a key: the Other/Cash row is keyed by name
  expect([...oracle.keys()].some((k) => k === "T:--" || k === "D:--")).toBe(false);
  const otherCash = oracle.get("N:OTHER/CASH");
  expect(otherCash).toBeDefined();
  expect(otherCash!.funds.size).toBe(3); // same name in all three funds
  expect(shown.has("Other/Cash")).toBe(true);

  // currency cash balances are retained under their published label
  const usdCash = oracle.get("T:-USD CASH-");
  expect(usdCash).toBeDefined();
  expect(usdCash!.funds.size).toBe(3);
  expect(shown.has("-USD CASH-")).toBe(true);
  // SMH publishes it as a NEGATIVE balance (-0.02%); dropping that row would
  // give 0.30%, keeping it gives 0.28%.
  expect(usdCash!.weightSum).toBeCloseTo(0.28, 10);

  // non-US local tickers with an exchange suffix stay distinct rows
  expect(oracle.has("T:NST AU")).toBe(true);
  expect(oracle.has("T:2259 HK")).toBe(true);
  expect(shown.has("NST AU")).toBe(true);

  // a fund holding with no FIGI (XPRO in OIH) still keys on its ticker
  expect(oracle.has("T:XPRO")).toBe(true);

  // the key resolver honors the documented contract (incl. numeric local tickers)
  expect(app.run<any>("JSON.stringify(positionDedupeKey({ Ticker: '005930', Name: 'SK HYNIX' }))")).toBe(
    JSON.stringify({ key: "T:005930", shown: "005930" }),
  );
  expect(app.run<any>("JSON.stringify(positionDedupeKey({ Ticker: '-', Identifier: '000000000', Name: 'US TREASURY NOTE' }))")).toBe(
    JSON.stringify({ key: "N:US TREASURY NOTE", shown: "US TREASURY NOTE" }),
  );
  // a FIGI must never be mistaken for an ISIN, and resolves on its own tier
  expect(app.run<any>("JSON.stringify(positionDedupeKey({ Ticker: '-', Identifier: 'BBG00X7YS2P3', Name: 'NISSAN MOTOR CO LTD' }))")).toBe(
    JSON.stringify({ key: "D:BBG00X7YS2P3", shown: "BBG00X7YS2P3" }),
  );
  expect(app.run<any>("JSON.stringify(positionDedupeKey({ Ticker: '—', Identifier: 'N/A', Name: 'SWAP' }))")).toBe(
    JSON.stringify({ key: "N:SWAP", shown: "SWAP" }),
  );
}, 300000);

// =============================================================================
// 13. Sticky columns
// =============================================================================

test("13. sticky classes are on catalog Use/Ticker and Watchlist Ticker cells", async () => {
  const app = await bootFresh();
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));

  const head = app.el("table-head").innerHTML;
  expect(head).toContain("catalog-sticky-col catalog-sticky-use");
  expect(head).toContain("catalog-sticky-col catalog-sticky-ticker");
  const body = bodyRowHtml(app);
  expect(body).toContain("catalog-sticky-col catalog-sticky-use");
  expect(body).toContain("catalog-sticky-col catalog-sticky-ticker");

  await clickTab(app, "watchlist");
  const wHead = app.el("table-head").innerHTML;
  const wBody = bodyRowHtml(app);
  expect(wHead).toContain("watchlist-sticky-col watchlist-sticky-ticker");
  expect(wBody).toContain("watchlist-sticky-col watchlist-sticky-ticker");
}, 180000);

// =============================================================================
// 14. Malformed localStorage cannot crash boot
// =============================================================================

test("14. malformed localStorage is sanitized and boot still succeeds", async () => {
  const storage = new MemoryStorage();
  storage.setItem(SORTS_KEY, "{this is not json");
  storage.setItem(FILTERS_KEY, "{this is not json");
  storage.setItem(SITE_STATE_KEY, '{"sheetFilter": 42, "activeTab": 7}');
  storage.setItem(SELECTED_KEY, "{broken");
  storage.setItem(BLACKLIST_KEY, "not-an-array");
  storage.setItem(ACTIVE_FUND_KEY, "  ###not a ticker### ");

  const app = await bootFresh(storage);
  expect(app.run<number>("state.funds.length")).toBeGreaterThan(50);
  expect(app.run<string[]>("[...state.selected]")).toEqual([]);
  expect(app.run<string[]>("[...state.blacklist]")).toEqual([]);
  expect(app.run<any>("state.activeFundTicker")).toBeNull();
  expect(app.run<any>("Object.keys(state.sortByTab).length")).toBe(0);
  expect(app.run<any>("Object.keys(state.queryByTab).length")).toBe(0);
  expect(app.run<any>("state.sortKey")).toBe("rank");

  // structurally valid but semantically invalid entries are dropped too
  storage.setItem(SORTS_KEY, JSON.stringify({
    All: { key: "", dir: "asc" },
    watchlist: { key: "symbol", dir: "sideways" },
    "detail:holdings": { key: "Weight", dir: "desc" },
  }));
  storage.setItem(FILTERS_KEY, JSON.stringify({
    All: 123,
    watchlist: "",
    "detail:overview": "returns",
  }));
  const second = await bootFresh(storage);
  expect(second.run<any>("Object.keys(state.sortByTab).length")).toBe(1); // only detail:holdings survives
  expect(second.run<any>("state.sortByTab['detail:holdings']")).toEqual({ key: "Weight", dir: "desc" });
  expect(second.run<any>("Object.keys(state.queryByTab).length")).toBe(1); // only detail:overview survives
  expect(second.run<any>("state.queryByTab['detail:overview']")).toBe("returns");
}, 120000);

// =============================================================================
// 15. Manifest consistency
// =============================================================================

test("15. index.json / meta.json / page manifests stay consistent", () => {
  const index = feedJson("index.json");
  expect(Array.isArray(index.funds)).toBe(true);
  expect(index.funds.length).toBeGreaterThan(0);
  expect(index.counts.funds).toBe(index.funds.length);

  let holdingsTotal = 0;
  let historyTotal = 0;
  for (const fund of index.funds) {
    const meta = feedJson(`funds/${fund.ticker}/meta.json`);
    for (const kind of ["holdings", "history"] as const) {
      const manifest = meta[kind] ?? {};
      const pages: string[] = manifest.pages ?? [];
      expect(manifest.totalRows ?? 0).toBe(fund[kind] ?? 0);
      let rows = 0;
      for (const page of pages) {
        const payload = feedJson(`funds/${fund.ticker}/${page.replace(/^\.?\//, "")}`);
        expect(Array.isArray(payload.headers)).toBe(true);
        expect(Array.isArray(payload.rows)).toBe(true);
        rows += payload.rows.length;
      }
      expect(rows).toBe(manifest.totalRows ?? 0);
      if (kind === "holdings") holdingsTotal += manifest.totalRows ?? 0;
      else historyTotal += manifest.totalRows ?? 0;
    }
  }
  expect(index.counts.holdings).toBe(holdingsTotal);
  expect(index.counts.history).toBe(historyTotal);
}, 120000);

// =============================================================================
// 16. Per-tab filter persistence across views
// =============================================================================

test("16. per-tab filter persistence: each tab keeps its own search query independently", async () => {
  const app = await bootFresh();

  // 1. On "All ETFs", search for "yield enhanced" (matches 3 ETFs)
  // "gold" matches GDX, GDXJ and OUNZ; GDX is the one with published holdings,
  // so the detail tabs below still have real rows to filter.
  setSearch(app, "gold");
  expect(app.run<number>("visibleCatalogRows().length")).toBe(3);
  expect(app.el("ticker-count").textContent).toBe("3 ETFs");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "gold",
  });

  // select GDX so detail tabs and Watchlist appear
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("GDX Overview"));

  // 2. Overview tab: search must NOT carry over "yield enhanced"
  await clickTab(app, "detail:overview");
  expect(app.el("search-input").value).toBe("");
  expect(bodyRowHtml(app)).toContain("Holdings Rows");
  expect(bodyRowHtml(app)).not.toContain("No overview metrics match");

  // 3. Set a specific filter on Overview (the Returns section)
  setSearch(app, "returns");
  expect(app.el("search-input").value).toBe("returns");
  expect(bodyRowHtml(app)).toContain("YTD (ME)");
  expect(bodyRowHtml(app)).not.toContain("Fund Name");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "gold",
    "detail:overview": "returns",
  });
  // site-state mirror stays in sync
  expect(JSON.parse(app.storage.getItem(SITE_STATE_KEY)!).sheetFilter).toEqual({
    All: "gold",
    "detail:overview": "returns",
  });

  // 4. Switch to Holdings tab: search is empty, shows full holdings
  await clickTab(app, "detail:holdings");
  expect(app.el("search-input").value).toBe("");
  await until(() => bodyRowHtml(app).length > 100);
  expect(bodyRowHtml(app)).not.toContain("No rows match your search");

  // type a filter on Holdings tab (GDX holds exactly one Newmont row)
  setSearch(app, "newmont");
  expect(app.el("search-input").value).toBe("newmont");
  expect(bodyRowCount(app)).toBe(1);

  // 5. Switch back to All ETFs: restores "yield enhanced"
  allTabButton(app).click();
  await waitForTab(app, "All");
  expect(app.el("search-input").value).toBe("gold");
  expect(app.el("ticker-count").textContent).toBe("3 ETFs");

  // 6. Switch back to Overview: restores "returns"
  await clickTab(app, "detail:overview");
  expect(app.el("search-input").value).toBe("returns");

  // 7. Switch to Watchlist: search is initially empty, then filter by fund badge
  await clickTab(app, "watchlist");
  expect(app.el("search-input").value).toBe("");
  setSearch(app, "GDX");
  expect(app.el("search-input").value).toBe("GDX");
  await until(() => app.run<number>("getDedupedWatchlistRows().length") > 0, 120000);

  // 8. Full reload: the active view (Watchlist) restores its filter, and all
  //    per-tab filters survive in storage
  const reloaded = await bootFresh(app.storage);
  expect(reloaded.run<any>("state.activeTab")).toBe("watchlist");
  expect(reloaded.el("search-input").value).toBe("GDX");
  expect(JSON.parse(reloaded.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "gold",
    "detail:overview": "returns",
    "detail:holdings": "newmont",
    watchlist: "GDX",
  });

  // 9. The inline one-click clear only removes the active tab's query
  const searchClear = reloaded.el("search-clear-btn");
  expect(searchClear.classList.contains("hidden")).toBe(false);
  searchClear.click();
  expect(reloaded.el("search-input").value).toBe("");
  expect(searchClear.classList.contains("hidden")).toBe(true);
  expect(JSON.parse(reloaded.storage.getItem(FILTERS_KEY)!)).toEqual({
    All: "gold",
    "detail:overview": "returns",
    "detail:holdings": "newmont",
  });

  // #reset-btn still clears selection and every tab filter
  reloaded.el("reset-btn").click();
  expect(reloaded.el("search-input").value).toBe("");
  expect(reloaded.storage.getItem(FILTERS_KEY)).toBeNull();
  expect(reloaded.run<string[]>("[...state.selected]")).toEqual([]);
  expect(reloaded.el("ticker-count").textContent).toBe("88 ETFs");
}, 300000);

// =============================================================================
// 17. One-click clear button
// =============================================================================

test("17. #search-clear-btn visibility, active-tab clearing, and immediate re-render", async () => {
  const app = await bootFresh();
  const input = app.el("search-input");
  const clearBtn = app.el("search-clear-btn");

  expect(clearBtn.classList.contains("hidden")).toBe(true);
  setSearch(app, "bond"); // matches 9 ETFs in this feed
  expect(clearBtn.classList.contains("hidden")).toBe(false);
  expect(app.run<number>("visibleCatalogRows().length")).toBe(9);
  expect(app.el("ticker-count").textContent).toBe("9 ETFs");

  clearBtn.click();
  expect(input.value).toBe("");
  expect(clearBtn.classList.contains("hidden")).toBe(true);
  expect(app.el("ticker-count").textContent).toBe("88 ETFs");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY) ?? "null") ?? {}).toEqual({});

  // typing again makes the button visible again
  setSearch(app, "china");
  expect(clearBtn.classList.contains("hidden")).toBe(false);

  // tab switch updates visibility to the destination tab's stored query
  await clickTab(app, "All");
  setSearch(app, "");
  toggleRow(app, "GDX");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "watchlist");
  expect(clearBtn.classList.contains("hidden")).toBe(true);
}, 180000);
