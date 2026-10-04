/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CONTROL_NAMES, HOLDINGS_HEADERS, SEC_UA_DEFAULT, VANECK_ETF_TRUST_CIK, VANECK_FINDER, VAN_ECK_SEED,
  annualizedFromCumulative, assertKnownTickers, chunkRows, compareDisplayDates, cumulativeFromAnnualized, decodeHtmlEntities,
  fetchWithRetry, filterScope, finderForTicker, formatAumDisplay, formatMoneyText, formatPercentText, formatVanEckDate,
  dividendYieldBasisOf, frequencyCode, fundPassesDataFilters, historyWindowStartEpoch, indicatedDividendYield, indicatedYieldAllowed,
  inferDistributionFrequency, installSystemCa, isCertError, loadSharedStrings, nasdaqExchangeDisplayName, normalizeFinderFrequency,
  normalizeNumberText, normalizeYahooExchangeName, numberOrNull, paceRequests, parseAumRange, parseHistoryRange, parseHtmlTables,
  parseMaxRetries, parseNasdaqSymdir, parseRange, parseVanEckFundPage, parseVanEckHistory, parseVanEckHistoryXlsx,
  parseVanEckHoldings, parseVanEckHoldingsXlsx, parseVanEckPerformance, parseXlsxSheet, parseYahooExchangeName, paymentsPerYear,
  premiumDiscount, readConfig, resetPacingLanes, resolveControls, runtimeControls, saneYield, sanitizeTicker, seedCatalogEntry,
  selectCandidates, setNetworkTimings, toIsoDate, vaneckEdgarFilingsUrl, vaneckFactSheetUrl, vaneckFundDocuments,
  vaneckFundPageUrl, vaneckHistoryUrl, vaneckHoldingsUrl, vaneckLegacyHoldingsUrl, withReturnsMeta, yahooChartProvenanceUrl,
  yahooChartUrl,
} from "./update-data";

// ---------------------------------------------------------------------------
// Shared setup: clean environment, pinned TZ, restored fetch / exit code / console / clock
// ---------------------------------------------------------------------------
const scriptsDir = new URL(".", import.meta.url).pathname;
const read = (relative: string): string => readFileSync(path.join(scriptsDir, "..", relative), "utf8");
const configFile = (): Record<string, string> => JSON.parse(read("scripts/update-data.config.json"));
const realFetch = globalThis.fetch;
const realExitCode = process.exitCode;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now;
const savedEnv = { ...process.env };
const tempDirs: string[] = [];
const isControlVar = (key: string): boolean =>
  (CONTROL_NAMES as readonly string[]).includes(key) || key.startsWith("VANECK_") || ["HISTORICAL_PAGE_SIZE", "NODE_USE_SYSTEM_CA", "ETF_UPDATER_SYSTEM_CA", "GITHUB_STEP_SUMMARY"].includes(key);

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (isControlVar(key)) delete process.env[key];
  process.env.TZ = "UTC";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  Date.now = realNow;
  process.exitCode = realExitCode ?? 0;
  Object.assign(console, realConsole);
  setNetworkTimings(45_000, 15_000);
  resetPacingLanes(1);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake clock: Date.now and setTimeout advance together, so paced waits are exact and instant. */
function fakeClock(): { waits: number[] } {
  let clock = 1_800_000_000_000;
  const waits: number[] = [];
  Date.now = () => clock;
  globalThis.setTimeout = ((callback: () => void, ms = 0) => { waits.push(ms); clock += ms; return realSetTimeout(callback, 0); }) as unknown as typeof setTimeout;
  return { waits };
}

// ---------------------------------------------------------------------------
// Minimal in-memory ZIP (STORE) writer: XLSX samples without a dependency or a fixture file
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function buildZip(files: Map<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true); localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true); localView.setUint32(22, data.length, true); localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true); centralView.setUint32(20, data.length, true); centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true); centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); eocdView.setUint16(8, files.size, true); eocdView.setUint16(10, files.size, true);
  eocdView.setUint32(12, centralSize, true); eocdView.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let position = 0;
  for (const chunk of [...locals, ...centrals, eocd]) { out.set(chunk, position); position += chunk.length; }
  return out;
}
const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** `namespaced` mirrors VanEck's real downloads (`<x:row>`/`<x:c>`/`<x:v>`); the parser must read both shapes. */
function sheetXml(rows: string[][], namespaced: boolean): string {
  const p = namespaced ? "x:" : "";
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => `<${p}c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" t="inlineStr"><${p}is><${p}t>${escapeXml(value)}</${p}t></${p}is></${p}c>`).join("");
    return `<${p}row r="${rowIndex + 1}">${cells}</${p}row>`;
  }).join("");
  const root = namespaced ? `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` : `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
  return `<?xml version="1.0" encoding="UTF-8"?>${root}<${p}sheetData>${body}</${p}sheetData>${namespaced ? "</x:worksheet>" : "</worksheet>"}`;
}
function buildXlsx(rows: string[][], namespaced = true): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return buildZip(new Map<string, Uint8Array>([
    ["xl/workbook.xml", encoder.encode('<?xml version="1.0"?><workbook/>')],
    ["xl/worksheets/sheet1.xml", encoder.encode(sheetXml(rows, namespaced))],
  ]));
}

// ---------------------------------------------------------------------------
// Small inline samples
// ---------------------------------------------------------------------------
const EQUITY_HOLDINGS_ROWS = [
  ["Daily Holdings (%)  09/17/2026"],
  [],
  ["Number", "Ticker", "Holding Name", "Identifier (FIGI)", "Shares", "Asset Class", "Market Value (US$)", "Notional Value", "% of Net Assets"],
  ["1", "NEM", "Newmont Corp", "BBG000BPWXK1", "24,875,719", "Stock", "$3,094,290,686.41", "--", "10.89"],
  ["2", "NST AU", "Northern Star Resources Ltd", "BBG00X7YS2P3", "9,000,000", "Stock", "$100,000,000.00", "--", "0.35"],
  ["3", "-USD CASH-", "", "", "0", "Cash", "$57,000,000.00", "--", "0.20"],
  ["4", "--", "Other/Cash", "--", "--", "Cash", "$31,792,656.80", "--", "0.11"],
  ["This information is not recommendations to buy or to sell any security."],
];
const FIXED_INCOME_HOLDINGS_ROWS = [
  ["Daily Holdings (%)  09/17/2026"],
  [],
  ["Number", "Holding Name", "Maturity", "Identifier (FIGI)", "Coupon", "Asset Class", "Par Value/ Contracts", "Market Value", "Notional Value", "% of Net Assets", "Country", "Currency"],
  ["1", "Celanese US Holdings Inc", "04/01/2027", "BBG00K1ABC23", "6.05", "Corporate", "$1,000,000", "$1,020,000", "--", "1.42", "United States", "USD"],
  ["2", "Celanese US Holdings Inc", "07/15/2029", "BBG00K1XYZ89", "5.75", "Corporate", "$800,000", "$790,000", "--", "1.10", "United States", "USD"],
  ["This information is not recommendations to buy or to sell any security."],
];
const HISTORY_ROWS = [
  ["VanEck Gold Miners ETF - GDX"],
  ["Date", "NAV", "Change", "% Change", "Last Trade", "Volume", "Premium/Discount", "% Premium/Discount", "AUM", "Index Level"],
  ["09/18/2026", "95.67", "0.42", "0.44", "95.48", "5,000,000", "-0.19", "-0.20", "28,418,567,995.87", "1,234.56"],
  ["09/17/2026", "95.25", "-1.10", "-1.14", "95.30", "4,800,000", "0.05", "0.05", "28,300,000,000.00", "1,229.10"],
];
const GDX_PAGE = `<h1>GDX VanEck Gold Miners ETF</h1>
  <div>NAV</div><div>$95.67</div><div>as of September 18, 2026</div>
  <div>YTD RETURNS</div><div>11.22%</div><div>as of September 18, 2026</div>
  <div>Total Net Assets</div><div>$28.42B</div><div>as of September 18, 2026</div>
  <div>Gross Expense Ratio</div><div>0.51%</div><div>Net Expense Ratio</div><div>0.51%</div>
  <div>Inception Date</div><div>05/16/2006</div>`;
const VEEM_PAGE = `<h1>VEEM VanEck MSCI EM Analyst Sentiment ETF</h1>
  <div>NAV</div><div>$24.62</div><div>as of September 18, 2026</div>
  <div>Performance since inception</div><div>-1.48%</div><div>as of September 18, 2026</div>
  <div>Total Net Assets</div><div>$3.69M</div><div>as of September 18, 2026</div>
  <div>Total Expense Ratio</div><div>0.30%</div><div>Inception Date</div><div>09/09/2026</div>
  <p>VanEck MSCI EM Analyst Sentiment ETF (VEEM) seeks to track the price and yield performance of the MSCI Emerging Markets Analyst Sentiment Select Index (NU763973).</p>`;

// ===========================================================================
describe("controls", () => {
  test("precedence: file < advanced < nonblank input < env; blank input inherits, advanced and explicit-empty env clear", () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: "GDX" }, { CONCURRENCY: 3, TICKERS: "SMH" }, { CONCURRENCY: "4", TICKERS: "" }, { CONCURRENCY: "5" });
    expect([c.CONCURRENCY, c.TICKERS]).toEqual(["5", "SMH"]);
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: "4" }).CONCURRENCY).toBe("4");
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: "" }).CONCURRENCY).toBe("2");
    expect(resolveControls({ TICKERS: "GDX" }, { TICKERS: "" }, { TICKERS: "" }).TICKERS).toBe("");
    expect(resolveControls({ TICKERS: "GDX" }, {}, { TICKERS: "SMH" }, { TICKERS: "" }).TICKERS).toBe("");
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: "false" }).SKIP_YAHOO).toBe("false");
  });

  test("HISTORICAL_PAGE_SIZE alias is kept and loses to HISTORY_PAGE_SIZE", () => {
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: "500" }).HISTORY_PAGE_SIZE).toBe("500");
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: "500", HISTORY_PAGE_SIZE: "600" }).HISTORY_PAGE_SIZE).toBe("600");
  });

  test("strict validation: bad ranges, HISTORY_RANGE, MAX_RETRIES < 1, unknown keys, non-scalars, CR/LF/NUL", () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: "x\nEVIL=yes" }, { SEC_UA: "x\rfoo" }, { SEC_UA: "x\0bad" }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 },
      { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: "-1" }, { VERBOSE: "maybe" }, { USE_SYSTEM_CA: "maybe" }, { AUM: "1:2:3" },
      { TER: "0.5" }, { HISTORY_RANGE: "forever" }, { HISTORY_RANGE: "0y" }, { PERFORMANCE_1Y: "5:1" }, { TICKERS: ["GDX"] }, { TICKERS: { a: 1 } }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
      if (value && !Array.isArray(value)) expect(() => resolveControls({}, value)).toThrow();
    }
    expect(() => resolveControls({}, {}, { TICKERS: "GDX\nSMH" })).toThrow();
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: "0" })).toThrow();
    expect(() => parseMaxRetries("0")).toThrow();
    expect([parseMaxRetries("1"), parseMaxRetries(""), parseHistoryRange(""), parseHistoryRange("5Y")]).toEqual([1, 3, "max", "5y"]);
    expect(() => parseHistoryRange("2026-01-01")).toThrow();
    expect(() => parseRange("0.35", "TER")).toThrow(/min:max/);
  });

  test("config file: keys equal CONTROL_NAMES and --help, values are strings, the scheduled path equals the defaults", async () => {
    expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(configFile())) expect(typeof value).toBe("string");
    expect(resolveControls(configFile(), {}, {}, {})).toEqual(configFile());
    const child = Bun.spawn([process.execPath, path.join(scriptsDir, "update-data.ts"), "--help"], {
      cwd: tmpdir(), stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) {
      const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(YTD|1Y|3Y|5Y|10Y)$/);
      expect(help).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
    }
    const config = readConfig(resolveControls(configFile()));
    expect([config.maxFetches, config.requestSleep, config.concurrency, config.maxRetries, config.historyRange, config.tickers]).toEqual([0, 2, 2, 3, "max", []]);
    expect([config.edgarFallback, config.storeRawDownloads, config.skipYahoo, config.skipVanEck, config.aumRange]).toEqual([true, false, false, false, undefined]);
    expect((await runtimeControls({ TICKERS: "GDX" })).TICKERS).toBe("GDX");
    const c = readConfig({ EDGAR_FALLBACK: "", CONCURRENCY: "", REQUEST_SLEEP: "" });
    expect([c.edgarFallback, c.concurrency, c.requestSleep]).toEqual([true, Number(configFile().CONCURRENCY), Number(configFile().REQUEST_SLEEP)]);
  });

  test("SEC_UA defaults to the daggerok contact and a protected value wins", () => {
    expect(configFile().SEC_UA).toBe("daggerok ETF feed daggerok@gmail.com");
    expect([readConfig({}).secUa, readConfig(resolveControls(configFile())).secUa]).toEqual([SEC_UA_DEFAULT, SEC_UA_DEFAULT]);
    expect(resolveControls(configFile(), { SEC_UA: "adv" }, { SEC_UA: "in" }, { SEC_UA: "protected" }).SEC_UA).toBe("protected");
  });

  test("AUM bounds, yield and return filters; a bounded range excludes funds without a value (null, never 0)", () => {
    expect(() => parseAumRange("10X:")).toThrow(/not a number/);
    expect(() => parseAumRange("1..5B:")).toThrow();
    expect([parseAumRange("1.5B:"), parseAumRange("$500M:2B"), parseAumRange("")]).toEqual([{ min: 1.5e9, max: undefined }, { min: 5e8, max: 2e9 }, undefined]);
    expect(parseAumRange("large")).toBeDefined();
    const cfg = (extra: Record<string, string> = {}) => readConfig({ ...resolveControls(configFile()), ...extra });
    const metrics = { ytd: 5, tr1y: 12, tr3y: 40, tr5y: null, cagr3y: 11, cagr5y: null, dividendYield: 2.5, secYield: null };
    expect(fundPassesDataFilters(metrics, cfg())).toBe(true);
    expect([cfg({ DIVIDEND_YIELD: "3:" }), cfg({ PERFORMANCE_1Y: "20:" }), cfg({ PERFORMANCE_3Y: ":10" })].map((c) => fundPassesDataFilters(metrics, c))).toEqual([false, false, false]);
    expect([cfg({ DIVIDEND_YIELD: "2:3" }), cfg({ PERFORMANCE_1Y: "10:" }), cfg({ TOTAL_RETURN_3Y: ":50" })].map((c) => fundPassesDataFilters(metrics, c))).toEqual([true, true, true]);
    expect([cfg({ SEC_YIELD: "0:" }), cfg({ PERFORMANCE_5Y: ":100" }), cfg({ TOTAL_RETURN_5Y: "-100:" })].map((c) => fundPassesDataFilters(metrics, c))).toEqual([false, false, false]);
  });

  test("unknown TICKERS are an error; the MAX_FETCHES cursor is scoped to the filter set and wraps", () => {
    expect(() => assertKnownTickers(["GDX", "NOPE"], VAN_ECK_SEED)).toThrow(/NOPE/);
    expect(() => assertKnownTickers(["GDX"], VAN_ECK_SEED)).not.toThrow();
    const cfg = (extra: Record<string, string> = {}) => readConfig({ ...resolveControls(configFile()), ...extra });
    expect(filterScope(cfg())).not.toBe(filterScope(cfg({ TICKERS: "GDX SMH" })));
    expect(filterScope(cfg({ TICKERS: "SMH GDX" }))).toBe(filterScope(cfg({ TICKERS: "GDX SMH" })));
    const all = selectCandidates(VAN_ECK_SEED, cfg({ MAX_FETCHES: "3" }), null).map((f) => f.ticker);
    const next = selectCandidates(VAN_ECK_SEED, cfg({ MAX_FETCHES: "3" }), all[2]).map((f) => f.ticker);
    expect(next[0]).not.toBe(all[0]);
    const sorted = VAN_ECK_SEED.map((f) => f.ticker).sort((a, b) => a.localeCompare(b));
    expect(selectCandidates(VAN_ECK_SEED, cfg({ MAX_FETCHES: "3" }), sorted[sorted.length - 1]).map((f) => f.ticker)).toEqual(all);
  });

  test("USE_SYSTEM_CA: auto by default, case-insensitive, restart only on certificate errors", async () => {
    expect(configFile().USE_SYSTEM_CA).toBe("auto");
    for (const v of ["auto", "TRUE", "False"]) expect(resolveControls({}, {}, {}, { USE_SYSTEM_CA: v }).USE_SYSTEM_CA).toBe(v.toLowerCase());
    expect(isCertError({ code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" })).toBe(true);
    expect(isCertError(Object.assign(new Error("fetch failed"), { cause: new Error("unable to get local issuer certificate") }))).toBe(true);
    expect([isCertError({ code: "ECONNRESET" }), isCertError(new Error("HTTP 403"))]).toEqual([false, false]);
    console.error = () => {};
    let calls = 0;
    const reexec = (() => { calls += 1; return undefined as never; }) as () => never;
    installSystemCa("false", reexec, false);
    installSystemCa("auto", reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    installSystemCa("true", reexec, false);
    expect(calls).toBe(1);
    globalThis.fetch = (async () => { throw new Error("self-signed certificate in certificate chain"); }) as unknown as typeof fetch;
    installSystemCa("auto", reexec, false);
    await fetch("https://x.test");
    expect(calls).toBe(2);
    globalThis.fetch = (async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); }) as unknown as typeof fetch;
    installSystemCa("auto", reexec, false);
    await expect(fetch("https://x.test")).rejects.toThrow("reset");
    expect(calls).toBe(2);
  });
});

// ===========================================================================
describe("parsing", () => {
  test("source URLs follow the verified vaneck.com layout; the EDGAR fallback targets the ETF Trust", () => {
    expect(vaneckFundPageUrl("GDX")).toBe("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/");
    expect(vaneckFundPageUrl("smh")).toBe("https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/");
    expect(vaneckFundPageUrl("ZZZZ")).toBe("https://www.vaneck.com/us/en/investments/etf-zzzz/");
    expect(vaneckHoldingsUrl("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/")).toBe("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/downloads/holdings/");
    expect(vaneckHistoryUrl("https://www.vaneck.com/us/en/investments/equity/gdx/overview")).toBe("https://www.vaneck.com/us/en/investments/equity/gdx/overview/downloads/fundhistoprices/");
    expect(vaneckLegacyHoldingsUrl("rsxj")).toBe("https://www.vaneck.com/us/en/etf/equity/rsxj/holdings/download/xlsx/");
    expect(vaneckFactSheetUrl("GDX")).toBe("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx-fact-sheet.pdf");
    expect(vaneckFactSheetUrl("ZZZZ")).toBeNull();
    expect(vaneckFundDocuments("AFK").statutoryProspectus).toContain("/AFK/index.php?ctype=prospectus");
    expect(VANECK_ETF_TRUST_CIK).toBe("0001137360");
    expect(vaneckEdgarFilingsUrl()).toContain("CIK=0001137360");
    expect(vaneckEdgarFilingsUrl("0000768847")).toContain("CIK=0000768847");
  });

  test("the recorded chart provenance URL carries no wall-clock value, the live one does", () => {
    expect(yahooChartUrl("GDX", 1_789_848_311_000)).toContain("period2=1789848311");
    expect(yahooChartProvenanceUrl("GDX")).toBe("https://query1.finance.yahoo.com/v8/finance/chart/GDX");
  });

  test("text, number and date normalization: placeholders are null, never NaN or 0", () => {
    expect([sanitizeTicker("  gdx "), sanitizeTicker(null)]).toEqual(["GDX", ""]);
    expect(normalizeNumberText("$3,094,290,686.41")).toBe("3094290686.41");
    expect([numberOrNull("$95.67"), numberOrNull("10.89%"), numberOrNull("--"), numberOrNull("—"), numberOrNull(""), numberOrNull("n/a"), numberOrNull(null)]).toEqual([95.67, 10.89, null, null, null, null, null]);
    expect(decodeHtmlEntities("VanEck&nbsp;&amp;&nbsp;Co &lt;ETF&gt; &#39;x&#39; &quot;y&quot;")).toBe("VanEck & Co <ETF> 'x' \"y\"");
    expect([formatVanEckDate("09/18/2026"), formatVanEckDate(""), formatVanEckDate("--")]).toEqual(["Sep 18 2026", "—", "--"]);
    expect([toIsoDate("9/8/2026"), toIsoDate("Sep 18 2026")]).toEqual(["2026-09-08", "Sep 18 2026"]);
    expect(compareDisplayDates("Sep 18 2026", "Sep 17 2026")).toBeGreaterThan(0);
    expect(compareDisplayDates("Sep 18 2026", "Sep 18 2026")).toBe(0);
    expect([formatAumDisplay(22_753_000_000), formatAumDisplay(1_234_567), formatPercentText(0), formatPercentText(null), formatMoneyText(null)]).toEqual(["$22,753.00 M", "$1.23 M", "0.00%", "—", "—"]);
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 25)).toEqual([]);
  });

  test("HTML tables are returned in document order", () => {
    const tables = parseHtmlTables(`<table><tr><th>Date</th><th>NAV</th></tr><tr><td>09/18/2026</td><td>95.67</td></tr></table><table><tr><td>Number</td><td>Ticker</td></tr><tr><td>1</td><td>NEM</td></tr></table>`);
    expect(tables).toHaveLength(2);
    expect([tables[0][0], tables[1][1]]).toEqual([["Date", "NAV"], ["1", "NEM"]]);
  });

  test("equity holdings: contract column order, local suffixes and cash rows kept, disclosure row dropped, no sheet is no rows", () => {
    const parsed = parseVanEckHoldings(EQUITY_HOLDINGS_ROWS);
    expect(parsed.asOfDate).toBe("Sep 17 2026");
    expect(parsed.headers).toEqual(["Name", "Ticker", "Identifier", "Shares Held", "Asset Category", "Market Value", "Notional Value", "Weight"]);
    expect(parsed.rows).toHaveLength(4);
    for (const row of parsed.rows) expect(row.length).toBe(parsed.headers.length);
    const at = (row: number, header: string) => parsed.rows[row][parsed.headers.indexOf(header)];
    expect([at(0, "Name"), at(0, "Ticker"), at(0, "Identifier"), at(0, "Weight"), at(0, "Notional Value")]).toEqual(["Newmont Corp", "NEM", "BBG000BPWXK1", "10.89%", ""]);
    expect([at(1, "Ticker"), at(2, "Ticker"), at(3, "Name"), at(3, "Ticker"), at(3, "Weight")]).toEqual(["NST AU", "-USD CASH-", "Other/Cash", "", "0.11%"]);
    expect(parsed.rows.some((r) => r.join(" ").includes("not recommendations"))).toBe(false);
    const empty = parseVanEckHoldings([["Nothing here"]]);
    expect([empty.rows, empty.headers]).toEqual([[], HOLDINGS_HEADERS]);
  });

  test("fixed-income holdings: Maturity switches the column set, the FIGI keeps duplicate issuers apart", () => {
    const parsed = parseVanEckHoldings(FIXED_INCOME_HOLDINGS_ROWS);
    expect(parsed.headers).toEqual(["Name", "Maturity", "Identifier", "Coupon", "Asset Category", "Par Value", "Market Value", "Weight", "Country", "Currency"]);
    expect(parsed.rows).toHaveLength(2);
    const at = (row: number, header: string) => parsed.rows[row][parsed.headers.indexOf(header)];
    expect([at(0, "Identifier"), at(1, "Identifier")]).toEqual(["BBG00K1ABC23", "BBG00K1XYZ89"]);
    expect(at(0, "Name")).toBe(at(1, "Name"));
    expect([at(0, "Maturity"), at(0, "Coupon"), at(0, "Country"), at(0, "Currency")]).toEqual(["Apr 01 2027", "6.05", "United States", "USD"]);
  });

  test("NAV history keeps the descending provider order and derives premium/discount from NAV and Last Trade", () => {
    const parsed = parseVanEckHistory(HISTORY_ROWS);
    expect(parsed.rows.map((r) => r[0])).toEqual(["Sep 18 2026", "Sep 17 2026"]);
    const nav = Number(parsed.rows[0][parsed.headers.indexOf("NAV")].replace(/[^-\d.]/g, ""));
    const close = Number(parsed.rows[0][parsed.headers.indexOf("Close")].replace(/[^-\d.]/g, ""));
    expect(premiumDiscount(close, nav)).toBeCloseTo(-0.1986, 2);
    expect(parsed.rows[0][parsed.headers.indexOf("Total Net Assets")]).toBe("28,418,567,995.87");
    expect(parseVanEckHistory([["No table"]]).rows).toEqual([]);
  });

  test("XLSX bytes: namespaced and bare worksheets are read, end to end for holdings and history", () => {
    for (const namespaced of [true, false]) {
      const bytes = buildXlsx(EQUITY_HOLDINGS_ROWS, namespaced);
      const rows = parseXlsxSheet(bytes, loadSharedStrings(bytes));
      expect([rows[2], rows[3][2]]).toEqual([EQUITY_HOLDINGS_ROWS[2], "Newmont Corp"]);
    }
    const equity = parseVanEckHoldingsXlsx(buildXlsx(EQUITY_HOLDINGS_ROWS));
    expect([equity.asOfDate, equity.rows.length, equity.rows[0][equity.headers.indexOf("Weight")]]).toEqual(["Sep 17 2026", 4, "10.89%"]);
    const bonds = parseVanEckHoldingsXlsx(buildXlsx(FIXED_INCOME_HOLDINGS_ROWS));
    expect([bonds.headers.includes("Ticker"), bonds.rows.length]).toEqual([false, 2]);
    expect(parseVanEckHistoryXlsx(buildXlsx(HISTORY_ROWS)).rows[0][0]).toBe("Sep 18 2026");
  });

  test("fund page: gross and net or a single total expense ratio, SI-only young funds, unreadable pages give nulls", () => {
    const gdx = parseVanEckFundPage(GDX_PAGE, "https://www.vaneck.com/us/en/investments/equity/gdx/overview/");
    expect([gdx.nav, gdx.ytdReturn, gdx.totalNetAssets, gdx.inceptionDate, gdx.grossExpenseRatio, gdx.netExpenseRatio]).toEqual([95.67, 11.22, 28_420_000_000, "May 16 2006", 0.51, 0.51]);
    expect([gdx.navAsOf, gdx.ytdAsOf, gdx.totalNetAssetsAsOf]).toEqual(["Sep 18 2026", "Sep 18 2026", "Sep 18 2026"]);
    const smh = parseVanEckFundPage(`<h1>SMH VanEck Semiconductor ETF</h1><div>NAV</div><div>$572.84</div><div>YTD RETURNS</div><div>59.07%</div><div>Total Expense Ratio</div><div>0.35%</div><div>Inception Date</div><div>12/20/2011</div>`, "x");
    expect([smh.nav, smh.ytdReturn, smh.totalExpenseRatio, smh.grossExpenseRatio]).toEqual([572.84, 59.07, 0.35, null]);
    const veem = parseVanEckFundPage(VEEM_PAGE, "x");
    expect([veem.ytdReturn, veem.siReturn, veem.siAsOf, veem.indexTicker, veem.indexName]).toEqual([null, -1.48, "Sep 18 2026", "NU763973", "MSCI Emerging Markets Analyst Sentiment Select Index"]);
    const blank = parseVanEckFundPage("<html><body>Loading…</body></html>", "x");
    for (const key of ["nav", "ytdReturn", "totalNetAssets", "grossExpenseRatio", "netExpenseRatio", "inceptionDate", "siReturn", "siAsOf", "indexTicker", "indexName"]) expect((blank as any)[key]).toBeNull();
  });

  test("performance block: month-end and quarter-end NAV rows, month-end only, or no NAV row at all", () => {
    const monthRow = { Type: "NAV", OneYear: 57.82, CumulativeThreeYear: 251.33, CumulativeFiveYear: 224.1, CumulativeTenYear: 326.5, ThreeYear: 51.58, FiveYear: 26.48, TenYear: 15.59, Life: 5.41 };
    const parsed = parseVanEckPerformance({ data: {
      MonthEndPerformances: [monthRow], MonthEndAsOfDate: "08/31/2026",
      QuarterEndPerformances: [{ Type: "NAV", OneYear: 45.77, ThreeYear: 37.44, Life: 4.06 }, { Type: "Market Price", OneYear: 45.93 }], QuarterEndAsOfDate: "06/30/2026",
    } });
    expect([parsed?.tr1y, parsed?.asOfDate, parsed?.quarterEnd?.asOfDate, parsed?.quarterEnd?.tr1y, parsed?.quarterEnd?.cagr3y, parsed?.quarterEnd?.siAnn]).toEqual([57.82, "Aug 31 2026", "Jun 30 2026", 45.77, 37.44, 4.06]);
    expect(parseVanEckPerformance({ data: { MonthEndPerformances: [monthRow], MonthEndAsOfDate: "08/31/2026" } })?.quarterEnd).toBeNull();
    expect(parseVanEckPerformance({ data: { MonthEndPerformances: [{ Type: "Market Price", OneYear: 1 }] } })).toBeNull();
    expect(parseVanEckPerformance({})).toBeNull();
  });

  test("exchange resolution: Nasdaq symdir codes and Yahoo names map onto the same display names", () => {
    expect(["P", "N", "A", "Q", "Z", "?"].map(nasdaqExchangeDisplayName)).toEqual(["NYSE Arca", "NYSE", "NYSE American", "NASDAQ", "Cboe BZX", null]);
    const map = parseNasdaqSymdir(["ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol", "GDX|VanEck Gold Miners ETF|P|GDX|Y|100|N|GDX", "HODL|VanEck Bitcoin ETF|Z|HODL|Y|100|N|HODL", "File Creation Time: 09182026 20:00|"].join("\r\n"));
    expect([map.get("GDX"), map.get("HODL"), map.has("ACT Symbol"), map.size]).toEqual(["NYSE Arca", "Cboe BZX", false, 2]);
    expect(["NYSEArca", "BTS", "NMS", "NYQ", "NSD", "", null].map(normalizeYahooExchangeName)).toEqual(["NYSE Arca", "Cboe BZX", "NASDAQ", "NYSE", "NSD", null, null]);
    expect([parseYahooExchangeName({ chart: { result: [{ meta: { exchangeName: "NYSEArca" } }] } }), parseYahooExchangeName({})]).toEqual(["NYSEArca", null]);
  });

  test("Investment Finder table: one row per seed fund, verbatim yields with -- as null, impossible cells dropped", () => {
    expect(VAN_ECK_SEED.length).toBe(91);
    expect(Object.keys(VANECK_FINDER).length).toBe(91);
    for (const seed of VAN_ECK_SEED) expect(finderForTicker(seed.ticker)).toBeDefined();
    expect(finderForTicker("ZZZZ")).toBeUndefined();
    expect(finderForTicker("GDX")).toMatchObject({ frequency: "Annual", secYield: 0.41, distributionYield: 0.66, yield12M: 0.97 });
    expect([finderForTicker("BUZZ")?.secYield, finderForTicker("BUZZ")?.distributionYield, finderForTicker("ETHV")?.frequency]).toEqual([-0.46, null, "--"]);
    expect([finderForTicker("EMBX")?.yield12M, finderForTicker("EMBX")?.distributionYield]).toEqual([null, 6.24]);
    expect([finderForTicker("CBON")?.monthEndYtd, finderForTicker("GDX")?.monthEndYtd]).toEqual([5.43, undefined]);
    expect([finderForTicker("RSX")?.liquidationStub, finderForTicker("RSX")?.monthEndTenors?.y1, finderForTicker("VEEM")?.monthEndTenors]).toEqual([true, 3.04, undefined]);
  });
});

// ===========================================================================
describe("metrics", () => {
  test("cumulative and annualized returns are exact inverses, null stays null, premium/discount needs both prices", () => {
    const cumulative = cumulativeFromAnnualized(10, 3);
    expect(cumulative).toBeCloseTo(33.1, 1);
    expect(annualizedFromCumulative(cumulative, 3)).toBeCloseTo(10, 2);
    expect([cumulativeFromAnnualized(null, 3), annualizedFromCumulative(null, 3), cumulativeFromAnnualized(10, 0), annualizedFromCumulative(-100, 3)]).toEqual([null, null, 0, null]);
    expect([premiumDiscount(95.48, 95.67), premiumDiscount(null, 95.67), premiumDiscount(95.48, null), premiumDiscount(95.48, 0)]).toEqual([-0.2, null, null, null]);
  });

  test("distribution frequency: inferred from ex-dates, coded for sorting, payments per year, no invented yield", () => {
    expect(inferDistributionFrequency(["2026-01-05", "2026-02-04", "2026-03-05", "2026-04-06"])).toBe("Monthly");
    expect(inferDistributionFrequency(["2025-09-22", "2025-12-22", "2026-03-23", "2026-06-22"])).toBe("Quarterly");
    expect([inferDistributionFrequency([]), inferDistributionFrequency(["2026-01-05"])]).toEqual(["Unknown", "Unknown"]);
    expect(inferDistributionFrequency(["2025-06-20", "2025-12-22", "2026-06-22"])).toBe("Semiannually");
    expect(inferDistributionFrequency(["2024-01-05", "2025-08-10", "2026-03-02"])).toBe("Irregular");
    expect(["Monthly", "Semiannually", "Irregular", "None", "Unknown", "", null].map(frequencyCode)).toEqual(["01 - Monthly", "06 - Semi-annually", "99 - Irregular", "00 - None", "00 - Unknown", "00 - None", "00 - None"]);
    expect(["Monthly", "Quarterly", "Annual", "Semi-Annual", "Irregular", "Unknown", "Other", "--"].map(paymentsPerYear)).toEqual([12, 4, 1, 2, null, null, null, null]);
    expect(["Annual", "Semi-Annual", "Other", "--", "", null].map(normalizeFinderFrequency)).toEqual(["Annually", "Semiannually", "Other", "Unknown", "Unknown", "Unknown"]);
    expect([indicatedDividendYield(0.25, 4, 95.67), indicatedDividendYield(null, 4, 95.67), indicatedDividendYield(0.25, null, 95.67), indicatedDividendYield(0.25, 4, null), indicatedDividendYield(0.25, 0, 95.67)]).toEqual([1.05, null, null, null, null]);
  });

  test("a stale distribution or a liquidation payout is never published as a yield", () => {
    expect([indicatedYieldAllowed("Dec 23 2024", "Sep 18 2026"), indicatedYieldAllowed("Dec 22 2025", "Sep 18 2026"), indicatedYieldAllowed(null, "Sep 18 2026"), indicatedYieldAllowed("Jul 01 2026", null), indicatedYieldAllowed("—", "Sep 18 2026")]).toEqual([false, true, false, false, false]);
    expect(saneYield(indicatedDividendYield(0.8208, 4, 0.39))).toBeNull();
    expect([saneYield(3.5), saneYield(0), saneYield(null), saneYield(Number.NaN)]).toEqual([3.5, 0, null, null]);
  });

  test("returnsBasis and performanceAsOf end the metrics, performanceAsOf is the tenor date and never the NAV date, every row shares one key set", () => {
    const seed = seedCatalogEntry(VAN_ECK_SEED[0]);
    expect(Object.keys(seed.metrics as object).slice(-2)).toEqual(["returnsBasis", "performanceAsOf"]);
    expect(String((seed.metrics as any).returnsBasis).length).toBeGreaterThan(1);
    expect((seed.metrics as any).performanceAsOf).toBeNull();
    const entryWith = (monthEnd: Record<string, unknown>, ytd: number | null) => ({
      ...seed, asOfDate: "Sep 25 2026", returns: { monthEnd, quarterEnd: { asOfDate: "—" } },
      metrics: { ...(seed.metrics as object), ytd, tr1y: 3, returnsBasis: "official VanEck Average Annual Total Returns (NAV)" },
    });
    const withTenor = withReturnsMeta(entryWith({ asOfDate: "Sep 25 2026", tenorsAsOf: "Aug 31 2026" }, 2.3)).metrics as Record<string, unknown>;
    expect([withTenor.performanceAsOf, withTenor.ytdAsOf]).toEqual(["2026-08-31", "2026-09-25"]);
    const pageOnly = withReturnsMeta(entryWith({ asOfDate: "Sep 25 2026" }, null)).metrics as Record<string, unknown>;
    expect([pageOnly.performanceAsOf, pageOnly.ytdAsOf]).toEqual(["2026-09-25", null]);
    const blank = withReturnsMeta({ returns: { monthEnd: { asOfDate: "—" } }, metrics: { returnsBasis: "-" } }).metrics as Record<string, unknown>;
    expect([blank.performanceAsOf, blank.returnsBasis]).toEqual([null, "not yet refreshed from vaneck.com"]);
    const keys = (e: ReturnType<typeof entryWith>) => Object.keys(withReturnsMeta(e).metrics as object).sort().join();
    expect(keys(entryWith({ asOfDate: "—" }, null))).toBe(keys(entryWith({ asOfDate: "Sep 25 2026", tenorsAsOf: "Aug 31 2026" }, 1)));
  });

  test("dividendYieldBasis: one code per yield source, null exactly when the yield is null, same key set on every row", () => {
    const seed = seedCatalogEntry(VAN_ECK_SEED[0]);
    const row = (m: Record<string, unknown>) => withReturnsMeta({ ...seed, metrics: { ...(seed.metrics as object), ...m } }).metrics as Record<string, unknown>;
    expect(row({}).dividendYieldBasis).toBeNull();
    expect(row({ dividendYield: 3.1, distributionYield: 3.1, dividendYieldBasis: "official-distribution-rate" }).dividendYieldBasis).toBe("official-distribution-rate");
    expect(row({ dividendYield: 1.05, distributionYield: null, dividendYieldBasis: "indicated" }).dividendYieldBasis).toBe("indicated");
    // a row published before the key existed is classified from its own numbers
    expect(row({ dividendYield: 3.1, distributionYield: 3.1 }).dividendYieldBasis).toBe("official-distribution-rate");
    expect(row({ dividendYield: 1.05, distributionYield: null }).dividendYieldBasis).toBe("indicated");
    // a stale code never survives a null yield; an unknown code is reclassified
    expect(row({ dividendYield: null, dividendYieldBasis: "indicated" }).dividendYieldBasis).toBeNull();
    expect(dividendYieldBasisOf({ dividendYield: 2, distributionYield: null, dividendYieldBasis: "bogus" })).toBe("indicated");
    const keys = (m: Record<string, unknown>) => Object.keys(row(m)).sort().join();
    expect(keys({})).toBe(keys({ dividendYield: 3.1, distributionYield: 3.1 }));
    expect(Object.keys(seed.metrics as object)).toContain("dividendYieldBasis");
  });

  test("HISTORY_RANGE window start is explicit, max starts at 0", () => {
    const now = 1_789_848_311;
    expect([historyWindowStartEpoch("max", now), historyWindowStartEpoch("5y", now)]).toEqual([0, Math.floor(now - 5 * 365.25 * 86_400)]);
  });
});

// ===========================================================================
// Sandbox: the real script is copied into a temp dir so main() writes under <tmp>/api/vaneck
// ===========================================================================
const FUNDS = ["EINC", "GDX", "SMH"];
const ts = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 1000;
const chartPayload = JSON.stringify({ chart: { result: [{
  meta: { exchangeName: "NYSEArca", regularMarketPrice: 95.5 },
  timestamp: [ts("2026-09-17"), ts("2026-09-18")],
  indicators: { quote: [{ close: [95.3, 95.48] }] },
  events: { dividends: { a: { amount: 0.25, date: ts("2026-06-22") }, b: { amount: 0.25, date: ts("2026-03-23") }, c: { amount: 0.25, date: ts("2025-12-22") } } },
}] } });
const pageFor = (ticker: string): string => (ticker === "VEEM" ? VEEM_PAGE : GDX_PAGE.replace("GDX VanEck Gold Miners ETF", `${ticker} VanEck ETF`));

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), "vaneck-test-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "scripts"));
  const api = path.join(dir, "api", "vaneck");
  mkdirSync(api, { recursive: true });
  for (const name of ["update-data.ts", "update-data.config.json"]) copyFileSync(path.join(scriptsDir, name), path.join(dir, "scripts", name));
  const urls: string[] = [];
  let down: string[] = [];
  let stallHoldings = false;
  let inFlight = 0, peak = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (down.some((part) => url.includes(part))) return new Response("gone", { status: 404 });
    const slug = /\/investments\/[a-z-]*-([a-z]+)\/(downloads\/(holdings|fundhistoprices)\/)?$/.exec(url);
    if (slug) {
      const ticker = slug[1].toUpperCase();
      inFlight += 1; peak = Math.max(peak, inFlight);
      try {
        await new Promise((resolve) => realSetTimeout(resolve, 30));
        if (!slug[2]) return new Response(pageFor(ticker));
        if (slug[3] === "holdings" && stallHoldings) {
          stallHoldings = false;
          const signal = init?.signal;
          return new Response(new ReadableStream({ start(controller) { signal?.addEventListener("abort", () => controller.error(signal.reason)); } }));
        }
        return new Response(slug[3] === "holdings" ? buildXlsx(EQUITY_HOLDINGS_ROWS) : buildXlsx(HISTORY_ROWS));
      } finally { inFlight -= 1; }
    }
    if (url.includes("/v8/finance/chart/")) return new Response(chartPayload);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const run = async (env: Record<string, string> = {}, opts: { timings?: [number, number] } = {}): Promise<unknown> => {
    const mod = await import(path.join(dir, "scripts", "update-data.ts"));
    if (opts.timings) mod.setNetworkTimings(...opts.timings);
    console.log = console.warn = console.error = () => {};
    try {
      await mod.main([], { REQUEST_SLEEP: "0", CONCURRENCY: "1", MAX_RETRIES: "1", EDGAR_FALLBACK: "false", USE_SYSTEM_CA: "false", TICKERS: FUNDS.join(" "), ...env });
      return null;
    } catch (error) {
      return error;
    } finally {
      Object.assign(console, realConsole);
    }
  };
  const readFile = (rel: string): string => readFileSync(path.join(api, rel), "utf8");
  const json = (rel: string) => JSON.parse(readFile(rel));
  const files = (): string[] => (readdirSync(api, { recursive: true }) as string[]).filter((f) => statSync(path.join(api, f)).isFile()).sort();
  const backdate = (): void => { for (const f of files()) utimesSync(path.join(api, f), 1_000_000_000, 1_000_000_000); };
  const touched = (): string[] => files().filter((f) => statSync(path.join(api, f)).mtimeMs !== 1_000_000_000_000);
  const row = (ticker: string) => json("index.json").funds.find((fund: any) => fund.ticker === ticker);
  return {
    api, urls, run, readFile, json, files, backdate, touched, row,
    setDown: (...parts: string[]) => { down = parts; },
    stallNextHoldings: () => { stallHoldings = true; },
    peak: () => peak,
  };
}

describe("pipeline", () => {
  test("a first run publishes the 91-fund catalog; every row has the same metrics keys and null (never 0) for unknown horizons", async () => {
    const box = sandbox();
    expect(await box.run()).toBeNull();
    const funds = box.json("index.json").funds;
    expect(funds).toHaveLength(91);
    const keys = Object.keys(funds[0].metrics).sort();
    for (const fund of funds) {
      expect(Object.keys(fund.metrics).sort()).toEqual(keys);
      expect(fund.metrics.returnsBasis).toBeTruthy();
    }
    expect(box.row("GDX")).toMatchObject({ dataFile: "./funds/GDX/meta.json", holdings: 4, history: 2 });
    expect(box.row("GDX").metrics.tr3y).toBeNull();
    for (const fund of funds) expect(fund.metrics.dividendYieldBasis).toBe(fund.metrics.dividendYield === null ? null : fund.metrics.distributionYield === fund.metrics.dividendYield ? "official-distribution-rate" : "indicated");
    expect(box.json("funds/GDX/meta.json").holdings.totalRows).toBe(4);
  });

  test("a young fund keeps null horizons next to its since-inception figure from the page", async () => {
    const box = sandbox();
    expect(await box.run({ TICKERS: "VEEM" })).toBeNull();
    const metrics = box.row("VEEM").metrics;
    for (const key of ["ytd", "tr1y", "tr3y", "tr5y", "tr10y", "cagr3y", "cagr5y", "cagr10y"]) expect(metrics[key]).toBeNull();
    expect(metrics.siAnn).toBe(-1.48);
  });

  test("a dataFile is null for a row without meta and set for a row with one", async () => {
    const box = sandbox();
    await box.run({ TICKERS: "GDX" });
    expect(box.row("GDX").dataFile).toBe("./funds/GDX/meta.json");
    expect(box.row("SMH").dataFile).toBeNull();
    expect(Object.keys(box.row("SMH").metrics).sort()).toEqual(Object.keys(box.row("GDX").metrics).sort());
  });

  test("a one-ticker run keeps every row and every file of the other funds", async () => {
    const box = sandbox();
    await box.run();
    const before = Object.fromEntries(FUNDS.filter((t) => t !== "EINC").map((t) => [t, box.readFile(`funds/${t}/meta.json`)]));
    const rows = FUNDS.map((t) => box.row(t));
    expect(await box.run({ TICKERS: "EINC" })).toBeNull();
    expect(box.json("index.json").funds).toHaveLength(91);
    for (const t of Object.keys(before)) expect(box.readFile(`funds/${t}/meta.json`)).toBe(before[t]);
    expect(FUNDS.filter((t) => t !== "EINC").map((t) => box.row(t))).toEqual(rows.filter((r) => r.ticker !== "EINC"));
  });

  test("a second identical run writes nothing", async () => {
    const box = sandbox();
    await box.run();
    box.backdate();
    const before = box.files().map((f) => box.readFile(f));
    expect(await box.run()).toBeNull();
    expect(box.touched()).toEqual([]);
    expect(box.files().map((f) => box.readFile(f))).toEqual(before);
  });

  test("a failed required source keeps the fund exactly as published, the run reports the failure", async () => {
    const box = sandbox();
    await box.run({ TICKERS: "GDX" });
    box.backdate();
    // the fund page is a required source: any failure keeps the previously published state (a 404 on a download would be an honest absence)
    box.setDown("gold-miners-etf-gdx");
    const error = await box.run({ TICKERS: "GDX" });
    expect(String(error)).toContain("every selected fund failed");
    expect(box.touched()).toEqual([]);
    expect(box.row("GDX")).toMatchObject({ dataFile: "./funds/GDX/meta.json", holdings: 4 });
  });

  test("MAX_FETCHES writes a scoped cursor and a TICKERS run leaves it alone", async () => {
    const box = sandbox();
    await box.run({ TICKERS: "", MAX_FETCHES: "1" });
    const first = box.json("update-state.json");
    expect(first.cursor).toBe(VAN_ECK_SEED.map((f) => f.ticker).sort((a, b) => a.localeCompare(b))[0]);
    await box.run({ TICKERS: "GDX", MAX_FETCHES: "0" });
    expect(box.json("update-state.json")).toEqual(first);
  });
});

// ===========================================================================
describe("network", () => {
  const cfg = () => readConfig({ ...resolveControls(configFile()), REQUEST_SLEEP: "0", MAX_RETRIES: "2" });

  test("a stalled request is aborted by the timeout and retried per MAX_RETRIES", async () => {
    setNetworkTimings(30, 1);
    let calls = 0;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      calls += 1;
      if (calls < 3) return new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)); });
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry("https://example.test/a", {}, cfg(), "stall");
    expect(await res.text()).toBe("ok");
    expect(calls).toBe(3);
  });

  test("retries are bounded by MAX_RETRIES, a 404 is not retried", async () => {
    setNetworkTimings(30, 1);
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("x", { status: 503 }); }) as unknown as typeof fetch;
    expect((await fetchWithRetry("https://example.test/b", {}, cfg(), "busy")).status).toBe(503);
    expect(calls).toBe(3);
    calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response("x", { status: 404 }); }) as unknown as typeof fetch;
    expect((await fetchWithRetry("https://example.test/c", {}, cfg(), "missing")).status).toBe(404);
    expect(calls).toBe(1);
  });

  test("a body that stalls after the headers is covered by the timeout and fetched again", async () => {
    const box = sandbox();
    box.stallNextHoldings();
    expect(await box.run({ TICKERS: "GDX" }, { timings: [150, 1] })).toBeNull();
    expect(box.urls.filter((url) => url.endsWith("/downloads/holdings/"))).toHaveLength(2);
    expect(box.row("GDX").holdings).toBe(4);
  });

  test("in-flight peak is 1 at CONCURRENCY=1 and N at CONCURRENCY=N", async () => {
    const one = sandbox();
    await one.run({ CONCURRENCY: "1" });
    expect(one.peak()).toBe(1);
    const three = sandbox();
    await three.run({ CONCURRENCY: "3" });
    expect(three.peak()).toBe(3);
  });

  test("request lanes pace independently: a lane waits one REQUEST_SLEEP between starts, separate lanes start together", async () => {
    const clock = fakeClock();
    const config = { ...cfg(), requestSleep: 1 };
    resetPacingLanes(2);
    await Promise.all([paceRequests(config), paceRequests(config), paceRequests(config)]);
    expect(clock.waits).toEqual([1000]);
    clock.waits.length = 0;
    resetPacingLanes(1);
    await Promise.all([paceRequests(config), paceRequests(config)]);
    expect(clock.waits).toEqual([1000]);
  });

  test("HISTORY_RANGE reaches the Yahoo request as explicit period1/period2", async () => {
    const now = 1_789_848_311;
    expect(yahooChartUrl("GDX", now * 1000)).toContain("period1=0&");
    const fiveYears = historyWindowStartEpoch("5y", now);
    expect(yahooChartUrl("GDX", now * 1000, "5y")).toContain(`period1=${fiveYears}&period2=${now}`);
    const box = sandbox();
    await box.run({ TICKERS: "GDX", HISTORY_RANGE: "5y" });
    const request = new URL(box.urls.find((url) => url.includes("/v8/finance/chart/GDX"))!);
    const [period1, period2] = [Number(request.searchParams.get("period1")), Number(request.searchParams.get("period2"))];
    expect(period1).toBeGreaterThan(0);
    expect(Math.round((period2 - period1) / 86_400 / 365.25)).toBe(5);
  });
});
