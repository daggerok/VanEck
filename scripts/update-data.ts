#!/usr/bin/env bun
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  console.log(`[ config ] ${brand} updater:\n${outputConfigEntries(config).map(([key, value]) => `            ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  const detail = [
    `port=${outputClean(data.portId ?? data.portfolioId)}`,
    `history=${outputClean(outputCount(data.history ?? data.historyCount))}`,
    `(official=${outputClean(data.officialHistoryCount)} yahoo=${outputClean(data.yahooHistoryCount)})`,
    `holdings=${outputClean(outputCount(data.holdings ?? data.holdingsCount))}`,
    `divs=${outputClean(outputCount(data.worksheets?.Distributions ?? data.distributions))}`,
    `netAssets=${outputMoney(data.netAssets ?? data.aum)}`,
    `total=${outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)}`,
    `div=${outputClean(outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield))}`,
    `sec=${outputClean(outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield))}`,
    `wp=${outputClean(data.workplaceRaw)}`,
  ].join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)} ${detail}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}

/// <reference types="bun" />
/**
 * @file VanEck static feed updater.
 *
 * Zero runtime dependencies: `node:fs/promises` + global `fetch` only, run with
 * Bun. Writes the deterministic `api/vaneck/**` tree the browser app reads.
 *
 * Source ladder (see README "Data sources" and docs/plan-vaneck.md):
 *   (a) official VanEck ETF Guide PDF ................ catalog universe
 *   (b) official per-fund page ...................... NAV, YTD, net assets,
 *                                                     expense ratio, inception
 *   (b2) verified Investment Finder table ........... declared frequency,
 *        (scripts/vaneck-finder.ts)                   SEC/distribution/12M
 *                                                     yields, YTD + tenor
 *                                                     fallbacks (tabs are
 *                                                     client-rendered)
 *   (c) official daily holdings download ............ full holdings (FIGI ids)
 *   (d) official NAV & premium/discount history ..... daily history
 *   (e) SEC EDGAR Form N-PORT-P (CIK 0001137360) .... holdings fallback
 *   (f) Yahoo Finance chart API ..................... distributions, and any
 *                                                     return the fund page omits
 *   (g) Nasdaq Trader symbol directory .............. listing exchange
 *   (h) browser N-PORT dropzone ..................... user-supplied override
 *
 * A run with no reachable network (or `OFFLINE_SEED=1`) replays the checked-in
 * snapshot in `scripts/vaneck-verified.ts` instead of failing, so the feed can
 * always be regenerated byte-identically.
 */
/// <reference types="bun" />
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUM_AS_OF_GUIDE,
  CATEGORY_GROUP,
  VAN_ECK_SEED,
  type VanEckSeedFund,
} from './vaneck-funds';
import { VANECK_SLUGS, slugForTicker } from './vaneck-slugs';
import {
  EQUITY_HOLDINGS_SNAPSHOTS,
  FUND_PAGE_SNAPSHOTS,
  HISTORY_SNAPSHOTS,
  SNAPSHOT_READ_AT,
} from './vaneck-verified';
import {
  FINDER_MONTH_END_AS_OF,
  FINDER_PRICES_AS_OF,
  FINDER_READ_AT,
  finderForTicker,
  normalizeFinderFrequency,
} from './vaneck-finder';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ROOT = path.join(REPO_ROOT, 'api', 'vaneck');

export const VANECK_SITE = 'https://www.vaneck.com';
export const VANECK_FINDER_URL = `${VANECK_SITE}/us/en/etf-mutual-fund-finder/`;
export const VANECK_ETF_GUIDE_URL = `${VANECK_SITE}/us/en/vaneck-etfs-fees.pdf`;
/** VanEck ETF Trust — the registrant that files Form N-PORT-P for the ETFs. */
export const VANECK_ETF_TRUST_CIK = '0001137360';

export function vaneckFundPageUrl(ticker: string): string {
  const clean = sanitizeTicker(ticker);
  const slug = slugForTicker(clean);
  if (slug) return `${VANECK_SITE}/us/en/investments/${slug}/`;
  // Fallback — kept so an unknown ticker never silently builds a wrong URL
  // (e.g. etf-einc → dynamic-high-income-etf-inc 404). Caller will see the 404.
  return `${VANECK_SITE}/us/en/investments/etf-${clean.toLowerCase()}/`;
}

export function vaneckFundPageUrlFromSlug(slug: string): string {
  return `${VANECK_SITE}/us/en/investments/${slug.replace(/^\/+|\/+$/g, '')}/`;
}

export function vaneckHoldingsUrl(fundPage: string): string {
  return `${stripTrailingSlash(fundPage)}/downloads/holdings/`;
}

export function vaneckHistoryUrl(fundPage: string): string {
  return `${stripTrailingSlash(fundPage)}/downloads/fundhistoprices/`;
}

/**
 * Pre-redesign holdings path, still live for the suspended Russia funds
 * (RSX/RSXJ): `/us/en/etf/equity/<t>/holdings/download/xlsx/`. Tried only
 * when the canonical `/downloads/holdings/` fetch fails.
 */
export function vaneckLegacyHoldingsUrl(ticker: string): string {
  return `${VANECK_SITE}/us/en/etf/equity/${ticker.toLowerCase()}/holdings/download/xlsx/`;
}

/** Deterministic fact-sheet PDF URL: `/us/en/investments/<slug>-fact-sheet.pdf`. Null when no verified slug exists — never invent a URL for an unknown ticker. */
export function vaneckFactSheetUrl(ticker: string): string | null {
  if (!slugForTicker(ticker)) return null;
  return `${stripTrailingSlash(vaneckFundPageUrl(ticker))}-fact-sheet.pdf`;
}

export const VANECK_ONLINE_PROSPECTUS_BASE = 'https://vaneck.onlineprospectus.net/vaneck';

/**
 * onlineprospectus.net viewer URL for one regulatory document kind:
 * `summary | prospectus | sai | annual | semi-annual`.
 */
export function vaneckProspectusUrl(ticker: string, kind: string): string {
  return `${VANECK_ONLINE_PROSPECTUS_BASE}/${ticker.toUpperCase()}/index.php?ctype=${kind}`;
}

export type VanEckFundDocuments = {
  factSheet: string | null;
  summaryProspectus: string;
  statutoryProspectus: string;
  sai: string;
  annualReport: string;
  semiAnnualReport: string;
};

/**
 * Deterministic document links for one fund. VanEck's URL schemes are stable
 * across the whole lineup (verified for GDX plus the ?tab=lit finder tab),
 * so these are built, not fetched.
 */
export function vaneckFundDocuments(ticker: string): VanEckFundDocuments {
  const t = ticker.toUpperCase();
  return {
    factSheet: vaneckFactSheetUrl(t),
    summaryProspectus: vaneckProspectusUrl(t, 'summary'),
    statutoryProspectus: vaneckProspectusUrl(t, 'prospectus'),
    sai: vaneckProspectusUrl(t, 'sai'),
    annualReport: vaneckProspectusUrl(t, 'annual'),
    semiAnnualReport: vaneckProspectusUrl(t, 'semi-annual'),
  };
}

export function vaneckEdgarFilingsUrl(cik: string = VANECK_ETF_TRUST_CIK): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=NPORT-P&dateb=&owner=include&count=40`;
}

export const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Live chart query for one ticker. `period2` is deliberately the current
 * instant: Yahoo needs an upper bound at or past today or it silently
 * downgrades `range=max` to monthly bars. This URL is used for fetching only —
 * it is never written to the feed, because a wall-clock value would make every
 * no-op rerun produce a git diff.
 */
export function yahooChartUrl(ticker: string, nowMs: number = Date.now()): string {
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=0&period2=${Math.floor(nowMs / 1000)}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
}

/**
 * Stable provenance form of the chart URL — no volatile query parameters — for
 * the per-fund `sources` block, so a no-op rerun stays byte-identical.
 */
export function yahooChartProvenanceUrl(ticker: string): string {
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}`;
}

function stripTrailingSlash(url: string): string {
  return String(url || '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Text / number helpers (same semantics as the sibling updaters)
// ---------------------------------------------------------------------------

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u00ae\u2122]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expands scientific notation and strips provider punctuation: "2.97E8" -> "297000000". */
export function normalizeNumberText(raw: unknown): string {
  const text = cleanText(raw);
  if (!text) return '';
  const compact = text.replace(/[$,%\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  if (compact === '' || compact === '-' || compact === '--' || compact === '—') return '';
  if (/e/i.test(compact)) {
    const value = Number(compact);
    return Number.isFinite(value) ? String(value) : '';
  }
  return compact;
}

export function numberOrNull(value: unknown): number | null {
  const text = normalizeNumberText(value);
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  // SSGA-style denormal sentinels are provider noise, not measurements.
  if (parsed !== 0 && Math.abs(parsed) < 1e-290) return null;
  return parsed;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatAumDisplay(value: number): string {
  return `$${(value / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}

export function formatPercentText(value: number | null): string {
  return value === null ? '—' : `${round(value, 2).toFixed(2)}%`;
}

export function formatMoneyText(value: number | null): string {
  if (value === null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${round(value / 1e9, 2).toFixed(2)}B`;
  if (abs >= 1e6) return `$${round(value / 1e6, 2).toFixed(2)}M`;
  return `$${round(value, 2).toFixed(2)}`;
}

/** "09/18/2026" -> "Sep 18 2026" (the sibling feed display format). */
export function formatVanEckDate(raw: unknown): string {
  const text = cleanText(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!us) return text || '—';
  const [, mm, dd, yyyy] = us;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(mm) - 1];
  if (!month) return text;
  return `${month} ${String(Number(dd)).padStart(2, '0')} ${yyyy}`;
}

export function toIsoDate(raw: unknown): string {
  const text = cleanText(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return text;
}

/** Sorts "Sep 18 2026"-style dates chronologically without a locale round trip. */
export function compareDisplayDates(a: string, b: string): number {
  return Date.parse(`${a} UTC`) - Date.parse(`${b} UTC`);
}

// ---------------------------------------------------------------------------
// Configuration (identical env surface to the sibling updaters)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  category: string;
  secUa: string;
  skipYahoo: boolean;
  skipVanEck: boolean;
  edgarFallback: boolean;
  offlineSeed: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function envValue(env: Record<string, string | undefined>, name: string, aliases: string[] = []): string {
  const direct = env[name];
  if (direct !== undefined && direct !== '') return direct;
  for (const alias of aliases) {
    const value = env[alias];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function parseNonNegativeInt(raw: string, fallback: number): number {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function parseNonNegativeFloat(raw: string, fallback: number): number {
  const value = Number(String(raw).trim());
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseBoolean(raw: string, fallback = false): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(text);
}

export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const [rawMin, rawMax] = text.split(':', 2);
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^([\d.]+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) return Number(suffixMatch[1]) * (AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()] ?? 1);
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const [rawMin, rawMax] = text.split(':', 2);
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(envValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), 3),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), 1.5),
    maxFetches: parseNonNegativeInt(envValue(env, 'MAX_FETCHES'), 0),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), 250),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE', ['HISTORICAL_PAGE_SIZE']), 1000),
    storeRawDownloads: parseBoolean(envValue(env, 'STORE_RAW_DOWNLOADS')),
    maxRetries: parseNonNegativeInt(envValue(env, 'MAX_RETRIES'), 3),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: envValue(env, 'HISTORY_RANGE') || 'max',
    category: cleanText(envValue(env, 'CATEGORY')),
    secUa: envValue(env, 'SEC_UA') || 'VanEckWatchlist static feed research contact@example.com',
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO')),
    skipVanEck: parseBoolean(envValue(env, 'SKIP_VANECK')),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK')),
    offlineSeed: parseBoolean(envValue(env, 'OFFLINE_SEED')),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(envValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}

const USAGE = `
VanEck ETF static feed updater (zero dependencies, run with Bun).

  bun ./scripts/update-data.ts [-h|--help]

Environment variables (all optional):

  MAX_FETCHES          0     Funds to process. 0 = full pass. A positive value
                             resumes after the committed cursor in
                             api/vaneck/update-state.json.
  REQUEST_SLEEP        1.5   Minimum seconds between request starts.
  CONCURRENCY          3     Parallel fund workers (starts stay globally paced).
  MAX_RETRIES          3     Retries for network errors and 408/425/429/5xx.
  TICKERS              ""    Space/comma separated tickers. ANDed with the other
                             filters, never overriding them.
  AUM                  ""    "min:max" dollars, K/M/B/T suffixes, or a preset:
                             nano <$10M | micro $10M-$300M | small $300M-$2B |
                             mid $2B-$10B | large >=$10B
  TER                  ""    "min:max" expense ratio percent.
  DIVIDEND_YIELD       ""    "min:max" dividend yield percent.
  SEC_YIELD            ""    "min:max" SEC yield percent (server-rendered for a subset
                             of funds — e.g. EINC, DESK, OIH — otherwise null; a range then
                             matches only those with a published value).
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y   "min:max" official fund-page return percent.
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y  "min:max" derived total return percent.
  HOLDINGS_PAGE_SIZE   250   Rows per holdings page file.
  HISTORY_PAGE_SIZE    1000  Rows per history page file (alias
                             HISTORICAL_PAGE_SIZE).
  HISTORY_RANGE        max   "max" or an ISO date; the oldest history row kept.
  CATEGORY             ""    Keep only this provider asset-class heading.
  STORE_RAW_DOWNLOADS  0     1|true|yes|y|on writes api/vaneck/raw/**.
  SEC_UA               (set) Declared User-Agent for SEC EDGAR requests.
  EDGAR_FALLBACK       0     Use Form N-PORT-P when a fund has no holdings file.
  SKIP_YAHOO           0     Skip Yahoo Finance (distributions, derived returns).
  SKIP_VANECK          0     Skip vaneck.com entirely (keeps committed data).
  OFFLINE_SEED         0     Replay scripts/vaneck-verified.ts instead of
                             fetching. Used to regenerate the feed with no
                             network egress.

Range syntax is strict "min:max" with exactly one colon; "" and ":" mean no
restriction; a configured min must not exceed max.

Examples:

  TICKERS="GDX SMH OIH" bun ./scripts/update-data.ts
  MAX_FETCHES=10 bun ./scripts/update-data.ts
  AUM=large TER=:0.40 bun ./scripts/update-data.ts
  OFFLINE_SEED=1 bun ./scripts/update-data.ts
`;

// ---------------------------------------------------------------------------
// Politeness & fetching
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let pacing: Promise<void> = Promise.resolve();

async function paceRequests(config: UpdaterConfig): Promise<void> {
  const wait = pacing.then(async () => {
    const delay = config.requestSleep * 1000 - (Date.now() - lastRequestAt);
    if (delay > 0) await sleep(delay);
    lastRequestAt = Date.now();
  });
  pacing = wait.catch(() => undefined);
  return wait;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * VanEck sits behind a WAF that uses a `redirectVE=generic` cookie dance:
 *   /investments/<slug>/  → 302 to /investments/<slug>/overview/?redirectVE=generic
 *   + Set-Cookie: redirectVE=generic
 *   the next request must send Cookie: redirectVE=generic or it loops.
 * Bun's default `redirect:follow` does not preserve Set-Cookie across
 * hops, so it hits "redirected too many times" (20 hops) for every
 * fund. We handle VanEck manually with a tiny cookie jar.
 */
async function fetchVanEckWithManualRedirect(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  let currentUrl = url;
  let cookieJar = '';
  const baseHeaders = { ...((init.headers as Record<string, string>) ?? {}) };
  // Support `verbose: true` in the second arg like the error message suggests
  const verbose = (init as Record<string, unknown>).verbose === true;
  for (let redirects = 0; redirects < 10; redirects++) {
    const headers: Record<string, string> = { ...baseHeaders };
    if (cookieJar) headers['Cookie'] = cookieJar;
    // VanEck's downloads check Referer; without it some holdings URLs 302 to overview
    if (!headers['Referer'] && currentUrl.includes('/downloads/')) {
      headers['Referer'] = VANECK_SITE + '/us/en/investments/';
    }
    if (verbose) console.warn(`  · ${label}: fetch ${currentUrl}${cookieJar ? ` (Cookie: ${cookieJar.slice(0, 80)})` : ''}`);
    const res = await fetch(currentUrl, { ...init, headers, redirect: 'manual' as RequestRedirect });
    // Collect Set-Cookie (Bun/undici may expose getSetCookie())
    let setCookies: string[] = [];
    const anyHeaders = res.headers as unknown as Record<string, unknown>;
    if (typeof (anyHeaders as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
      setCookies = (anyHeaders as { getSetCookie: () => string[] }).getSetCookie();
    } else {
      const single = res.headers.get('set-cookie');
      if (single) {
        // Single header may contain multiple cookies comma-separated, but Expires
        // also contains commas. Split conservatively on ", " where next token looks like cookie name.
        // Fallback: treat whole thing as one cookie's first part.
        if (single.includes('Expires=')) {
          // VanEck only sets redirectVE, so simple split is fine
          setCookies = [single];
        } else {
          setCookies = single.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    }
    if (setCookies.length) {
      const parts = setCookies.map(c => c.split(';')[0].trim()).filter(Boolean);
      const joined = parts.join('; ');
      cookieJar = cookieJar ? `${cookieJar}; ${joined}` : joined;
      if (verbose) console.warn(`  · ${label}: Set-Cookie → ${joined}`);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      const nextUrl = new URL(loc, currentUrl).toString();
      if (verbose) console.warn(`  · ${label}: ${res.status} → ${nextUrl}`);
      // Detect the WAF loop: /overview/?redirectVE=generic ↔ /overview/?redirectVE=generic
      if (nextUrl === currentUrl && redirects >= 2) {
        throw new Error(`The response redirected too many times. ${label} -> ${nextUrl} (cookie=${cookieJar})`);
      }
      currentUrl = nextUrl;
      continue;
    }
    return res;
  }
  throw new Error(`The response redirected too many times. ${label} (manual redirect loop after 10 hops, last=${currentUrl}, cookie=${cookieJar})`);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: UpdaterConfig,
  label = url,
): Promise<Response> {
  const isVanEck = url.includes('vaneck.com');
  let attempt = 0;
  for (;;) {
    await paceRequests(config);
    try {
      const response = isVanEck
        ? await fetchVanEckWithManualRedirect(url, init, label)
        : await fetch(url, init);
      // VanEck sits behind a WAF that answers 403 while throttling, so a 403 is
      // retried like a 429 (bounded) rather than treated as "not found".
      if (response.ok || (!RETRY_STATUS.has(response.status) && response.status !== 403)) return response;
      if (attempt >= config.maxRetries) return response;
      console.warn(`  ! ${label}: HTTP ${response.status} (retry ${attempt + 1}/${config.maxRetries})`);
    } catch (error) {
      const msg = errorMessage(error);
      const isRedirectLoop = /redirect(ed)? too many times/i.test(msg);
      const isNetwork = isRedirectLoop || /fetch failed|network|ECONNRESET|ETIMEDOUT|Client network socket disconnected/i.test(msg);
      if (attempt >= config.maxRetries || (!isNetwork && !isRedirectLoop)) throw error;
      console.warn(`  ! ${label}: ${msg} (retry ${attempt + 1}/${config.maxRetries})`);
      if (isRedirectLoop && isVanEck && attempt < config.maxRetries) {
        // For VanEck a loop is usually a transient WAF hiccup; back off and retry the whole jar
        await sleep(8000 * (attempt + 1));
        attempt += 1;
        continue;
      }
      if (isRedirectLoop) throw error;
    }
    attempt += 1;
    await sleep(15000 * attempt);
  }
}

function browserHeaders(): Record<string, string> {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function yahooHeaders(): Record<string, string> {
  return { ...browserHeaders(), Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' };
}

async function fetchText(url: string, headers: Record<string, string>, config: UpdaterConfig, label = url): Promise<string> {
  const response = await fetchWithRetry(url, { headers }, config, label);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.text();
}

async function fetchBytes(url: string, headers: Record<string, string>, config: UpdaterConfig, label = url): Promise<Uint8Array> {
  const response = await fetchWithRetry(url, { headers }, config, label);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export type YahooDistribution = { date: string; amount: number };

/**
 * Extracts `chart.result[0].events.dividends` (a map keyed by unix
 * timestamp) from the Yahoo Finance chart API response, sorted most
 * recent first. Used only as a fallback when VanEck's own distribution
 * history (see `parseVanEckDistributions` below) is unavailable.
 */
export function parseYahooDividends(json: unknown): YahooDistribution[] {
  const dividends = (json as { chart?: { result?: Array<{ events?: { dividends?: Record<string, { amount: unknown; date: unknown }> } }> } })
    ?.chart?.result?.[0]?.events?.dividends;
  if (!dividends || typeof dividends !== 'object') return [];
  return Object.values(dividends)
    .map((row) => ({ amount: Number(row.amount), date: Number(row.date) }))
    .filter((row) => Number.isFinite(row.amount) && Number.isFinite(row.date))
    .sort((a, b) => b.date - a.date)
    .map((row) => {
      const when = new Date(row.date * 1000);
      const mdY = `${String(when.getUTCMonth() + 1).padStart(2, '0')}/${String(when.getUTCDate()).padStart(2, '0')}/${when.getUTCFullYear()}`;
      return { date: formatVanEckDate(mdY), amount: row.amount };
    });
}

async function fetchYahooChartJson(ticker: string, config: UpdaterConfig): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fetchText(yahooChartUrl(ticker), yahooHeaders(), config, `${ticker} Yahoo chart`));
  } catch (error) {
    console.warn(`  ! ${ticker}: Yahoo chart unavailable (${errorMessage(error)})`);
    return null;
  }
}

/** Listing-exchange code from a Yahoo Finance chart response (`meta.exchangeName`). */
export function parseYahooExchangeName(json: unknown): string | null {
  const meta = (json as { chart?: { result?: Array<{ meta?: { exchangeName?: unknown } }> } })?.chart?.result?.[0]?.meta;
  const raw = typeof meta?.exchangeName === 'string' ? meta.exchangeName.trim() : '';
  return raw || null;
}

/**
 * Normalises Yahoo's `meta.exchangeName` vocabulary onto display names.
 * Unknown codes pass through untouched so a new Yahoo value stays visible
 * instead of collapsing to an em dash.
 */
export function normalizeYahooExchangeName(raw: unknown): string | null {
  const code = String(raw ?? '').trim();
  if (!code) return null;
  const map: Record<string, string> = {
    NYSEArca: 'NYSE Arca',
    PCX: 'NYSE Arca',
    NYQ: 'NYSE',
    ASE: 'NYSE American',
    NMS: 'NASDAQ',
    NCM: 'NASDAQ',
    NGM: 'NASDAQ',
    BTS: 'Cboe BZX',
    BZX: 'Cboe BZX',
    BAT: 'Cboe BZX',
  };
  return map[code] ?? code;
}

/** Nasdaq Trader symbol-directory files: listing exchange for every US symbol. */
export const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
export const NASDAQ_OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

/**
 * Parses one Nasdaq Trader symbol-directory file
 * (`ACT Symbol|Security Name|Exchange|…`, last line is a file trailer) into
 * a ticker -> listing-exchange display name map.
 */
export function parseNasdaqSymdir(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const cells = line.split('|');
    const symbol = (cells[0] ?? '').trim();
    const exchange = (cells[2] ?? '').trim();
    if (!symbol || !exchange || /^(ACT Symbol|File Creation Time)/i.test(symbol)) continue;
    const display = nasdaqExchangeDisplayName(exchange);
    if (display) map.set(symbol.toUpperCase(), display);
  }
  return map;
}

/** Maps Nasdaq symdir `Exchange` codes onto display names. */
export function nasdaqExchangeDisplayName(code: string): string | null {
  const map: Record<string, string> = {
    Q: 'NASDAQ',
    N: 'NYSE',
    A: 'NYSE American',
    P: 'NYSE Arca',
    Z: 'Cboe BZX',
    B: 'Nasdaq BX',
    X: 'Nasdaq PSX',
    C: 'NYSE National',
    H: 'MIAX',
    Y: 'Cboe BYX',
    J: 'Cboe EDGA',
    K: 'Cboe EDGX',
    M: 'NYSE Chicago',
    W: 'Cboe C2',
    U: 'MEMX',
    L: 'LTSE',
    V: 'IEX',
    I: 'ISE',
  };
  return map[String(code ?? '').trim().toUpperCase()] ?? null;
}

let nasdaqExchangeCache: Map<string, string> | null = null;

/** Fetches both symdir files once per run; null when unreachable. */
async function fetchNasdaqExchanges(config: UpdaterConfig): Promise<Map<string, string> | null> {
  if (nasdaqExchangeCache) return nasdaqExchangeCache;
  try {
    const [listed, otherListed] = await Promise.all([
      fetchText(NASDAQ_LISTED_URL, { 'User-Agent': config.secUa, Accept: 'text/plain' }, config, 'Nasdaq nasdaqlisted.txt'),
      fetchText(NASDAQ_OTHER_LISTED_URL, { 'User-Agent': config.secUa, Accept: 'text/plain' }, config, 'Nasdaq otherlisted.txt'),
    ]);
    nasdaqExchangeCache = new Map([...parseNasdaqSymdir(otherListed), ...parseNasdaqSymdir(listed)]);
    // The Nasdaq-listed file wins on collision: a symbol's primary listing is
    // authoritative over the consolidated tape's duplicate row.
    return nasdaqExchangeCache;
  } catch (error) {
    console.warn(`  ! Nasdaq symbol directory unavailable (${errorMessage(error)}); exchange falls back to Yahoo`);
    return null;
  }
}

const VANECK_BLOCK_CONTENT_URL = `${VANECK_SITE}/Main`;

/**
 * VanEck's Performance and Distributions panels are hydrated client-side, but
 * from a plain unauthenticated JSON endpoint the widget's own custom element
 * calls — no browser needed, only the block's own `blockid`/`pageid`, which
 * `parseVanEckFundPage` reads straight off the page's `<ve-…block>` tags:
 *   /Main/<BlockName>/GetContent/?blockid=…&pageid=…&ticker=…
 * Verified live 2026-09-20 against SMH/ANGL/ETHV (a 2024-inception fund,
 * whose 5Y/10Y come back JSON `null` — never invented).
 */
function vanEckBlockContentUrl(blockName: string, blockId: string, pageId: string, ticker: string): string {
  const params = new URLSearchParams({
    blockid: blockId,
    pageid: pageId,
    ticker,
    reactlang: 'en',
    reactctr: 'us',
    epieditmode: 'false',
    latest: 'false',
    contextmode: 'Default',
  });
  return `${VANECK_BLOCK_CONTENT_URL}/${blockName}/GetContent/?${params.toString()}`;
}

export type ParsedPerformanceQuarter = {
  asOfDate: string | null;
  ytd: number | null;
  tr1y: number | null;
  tr3y: number | null;
  tr5y: number | null;
  tr10y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

export type ParsedPerformance = {
  asOfDate: string | null;
  tr1y: number | null;
  tr3y: number | null;
  tr5y: number | null;
  tr10y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  /** Quarter-end NAV row when the block publishes one, else null. */
  quarterEnd: ParsedPerformanceQuarter | null;
};

/** `null`/`undefined`/`''` stay `null` — VanEck marks a too-young tenor with JSON `null`, and `Number(null)` is 0, not null. */
function numberOrNullStrict(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the "Average Annual Total Returns" block (`PerformanceHistoryBlock`).
 * Both a NAV-basis and a Market-Price-basis row are published; the NAV row
 * is the one this feed's TR-N/CAGR-N/SI Ann. columns use, matching NAV as
 * the basis for every other return figure in the feed (YTD, premium/discount).
 */
function navPerformanceRow(rows: unknown): Record<string, unknown> | null {
  if (!Array.isArray(rows)) return null;
  const navRow = (rows as Array<Record<string, unknown>>).find((row) => row.Type === 'NAV');
  return navRow ?? null;
}

function performanceAsOfDate(data: Record<string, unknown> | undefined, key: string): string | null {
  const raw = data?.[key];
  return typeof raw === 'string' ? formatVanEckDate(raw) : null;
}

function tenorsFromNavRow(navRow: Record<string, unknown>): Omit<ParsedPerformanceQuarter, 'asOfDate' | 'ytd'> {
  return {
    tr1y: numberOrNullStrict(navRow.OneYear),
    tr3y: numberOrNullStrict(navRow.CumulativeThreeYear),
    tr5y: numberOrNullStrict(navRow.CumulativeFiveYear),
    tr10y: numberOrNullStrict(navRow.CumulativeTenYear),
    cagr3y: numberOrNullStrict(navRow.ThreeYear),
    cagr5y: numberOrNullStrict(navRow.FiveYear),
    cagr10y: numberOrNullStrict(navRow.TenYear),
    siAnn: numberOrNullStrict(navRow.Life),
  };
}

export function parseVanEckPerformance(json: unknown): ParsedPerformance | null {
  const data = (json as { data?: Record<string, unknown> })?.data;
  const navRow = navPerformanceRow(data?.MonthEndPerformances);
  if (!navRow) return null;
  const quarterNavRow = navPerformanceRow(
    (data?.QuarterEndPerformances ?? data?.QuarterlyPerformances) as unknown,
  );
  return {
    asOfDate: performanceAsOfDate(data, 'MonthEndAsOfDate'),
    ...tenorsFromNavRow(navRow),
    quarterEnd: quarterNavRow
      ? {
          asOfDate: performanceAsOfDate(data, 'QuarterEndAsOfDate'),
          ytd: numberOrNullStrict(quarterNavRow.Ytd ?? quarterNavRow.YTD),
          ...tenorsFromNavRow(quarterNavRow),
        }
      : null,
  };
}

async function fetchVanEckPerformance(
  ticker: string,
  pageId: string,
  blockId: string,
  config: UpdaterConfig,
): Promise<ParsedPerformance | null> {
  try {
    const url = vanEckBlockContentUrl('PerformanceHistoryBlock', blockId, pageId, ticker);
    const json = JSON.parse(await fetchText(url, { ...browserHeaders(), Accept: 'application/json' }, config, `${ticker} performance`));
    return parseVanEckPerformance(json);
  } catch (error) {
    console.warn(`  ! ${ticker}: performance history unavailable (${errorMessage(error)})`);
    return null;
  }
}

export type VanEckDistribution = { exDate: string; payableDate: string; dividend: number };

/**
 * Parses the "Distribution History" block (`NavDistributionsBlock`) —
 * VanEck's own official distribution history, sorted most recent first.
 * README previously claimed vaneck.com has no per-fund distributions
 * download; it does, just via this JSON endpoint rather than a file.
 */
export function parseVanEckDistributions(json: unknown): VanEckDistribution[] {
  const rows = (json as { data?: { NavDistributions?: Array<Record<string, unknown>> } })?.data?.NavDistributions;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      exDate: typeof row.ExDate === 'string' ? row.ExDate : '',
      payableDate: typeof row.PayableDate === 'string' ? row.PayableDate : '',
      dividend: numberOrNullStrict(String(row.DividendIncome ?? '').replace(/[^-\d.]/g, '')),
    }))
    .filter((row): row is VanEckDistribution => row.exDate !== '' && row.dividend !== null)
    .map((row) => ({ ...row, exDate: formatVanEckDate(row.exDate), payableDate: row.payableDate ? formatVanEckDate(row.payableDate) : '—' }))
    .sort((a, b) => (Date.parse(`${toIsoDate(b.exDate)} UTC`) || 0) - (Date.parse(`${toIsoDate(a.exDate)} UTC`) || 0));
}

async function fetchVanEckDistributions(
  ticker: string,
  pageId: string,
  blockId: string,
  config: UpdaterConfig,
): Promise<VanEckDistribution[] | null> {
  try {
    const url = vanEckBlockContentUrl('NavDistributionsBlock', blockId, pageId, ticker);
    const json = JSON.parse(await fetchText(url, { ...browserHeaders(), Accept: 'application/json' }, config, `${ticker} distributions`));
    return parseVanEckDistributions(json);
  } catch (error) {
    console.warn(`  ! ${ticker}: VanEck distributions unavailable (${errorMessage(error)})`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// VanEck HTML table parsing
// ---------------------------------------------------------------------------

/** Unescapes the entities VanEck's download pages emit. */
export function decodeHtmlEntities(text: string): string {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(fragment: string): string {
  return cleanText(decodeHtmlEntities(fragment.replace(/<[^>]*>/g, ' ')));
}

export type HtmlTable = string[][];

/**
 * Reads every `<table>` in a document into rows of cell text. VanEck's
 * `/downloads/…` pages are plain server-rendered HTML tables, so this is the
 * whole reader — no DOM, no dependency.
 */
export function parseHtmlTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  for (const tableMatch of html.matchAll(tableRe)) {
    const rows: HtmlTable = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const rowMatch of tableMatch[1].matchAll(rowRe)) {
      const cells: string[] = [];
      const cellRe = /<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi;
      for (const cellMatch of rowMatch[1].matchAll(cellRe)) cells.push(stripTags(cellMatch[2]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

/** Locates the header row by the columns a VanEck sheet is known to carry. */
export function findHeaderRowIndex(rows: HtmlTable, requiredColumns: string[]): number {
  const wanted = requiredColumns.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (let i = 0; i < rows.length; i++) {
    const keys = rows[i].map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (wanted.every((w) => keys.some((k) => k.includes(w)))) return i;
  }
  return -1;
}

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
export const HISTORY_HEADERS = ['Date', 'NAV', 'Close', 'Volume', 'Premium/Discount', 'Total Net Assets', 'Index Level'];

export type ParsedHoldings = {
  asOfDate: string;
  headers: string[];
  rows: string[][];
};

const MISSING_CELL = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'none', 'null']);

function cleanCell(raw: string): string {
  const text = cleanText(raw);
  return MISSING_CELL.has(text.toLowerCase()) ? '' : text;
}

// ---------------------------------------------------------------------------
// VanEck XLSX download parsing
//
// The holdings and NAV-history "downloads" endpoints do not serve HTML —
// they serve a real .xlsx (OOXML SpreadsheetML) workbook. This is a minimal
// ZIP reader (STORE + DEFLATE via node:zlib) plus just enough of the
// SpreadsheetML schema to read the first worksheet into rows of cell text,
// with no dependency. VanEck's own sheet XML namespaces every element
// (`<x:row>`, `<x:c>`, `<x:v>`), unlike a bare `<row>`, so every tag pattern
// here tolerates an optional `prefix:`.
// ---------------------------------------------------------------------------

function findEndOfCentralDirectory(bytes: Uint8Array): { offset: number; entries: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return { offset: i, entries: view.getUint16(i + 10, true) };
  }
  throw new Error('ZIP: end of central directory not found');
}

export function readZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const eocd = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, Uint8Array>();
  let offset = view.getUint32(eocd.offset + 16, true);
  for (let index = 0; index < eocd.entries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error(`ZIP: bad central directory entry at ${offset}`);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, new Uint8Array(inflateRawSync(Buffer.from(data))));
    else throw new Error(`ZIP: unsupported compression method ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(xml: string): string {
  return decodeHtmlEntities(xml.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1'));
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const items = xml.match(/<(?:\w+:)?si[\s>][\s\S]*?<\/(?:\w+:)?si>|<(?:\w+:)?si\/>/g) || [];
  for (const item of items) {
    const parts = item.match(/<(?:\w+:)?t[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || [];
    strings.push(xmlText(parts.map((part) => part.replace(/^<(?:\w+:)?t[^>]*>/, '').replace(/<\/(?:\w+:)?t>$/, '')).join('')));
  }
  return strings;
}

/** Column letters to zero-based index ("C7" -> 2). */
function columnIndex(reference: string): number {
  const letters = reference.replace(/\d+/g, '');
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Parses the first worksheet of an XLSX file into rows of raw cell strings. */
export function parseXlsxSheet(bytes: Uint8Array, sharedStrings: string[]): HtmlTable {
  const entries = readZipEntries(bytes);
  const names = [...entries.keys()];
  const sheetName =
    names.find((name) => /^xl\/worksheets\/sheet1\.xml$/.test(name)) ||
    names.find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) ||
    names.find((name) => /^xl\/worksheets\/.+\.xml$/.test(name));
  if (!sheetName) throw new Error('XLSX: worksheet not found');
  const xml = new TextDecoder().decode(entries.get(sheetName)!);
  const rows: string[][] = [];
  const rowMatches = xml.match(/<(?:\w+:)?row[\s>][\s\S]*?<\/(?:\w+:)?row>|<(?:\w+:)?row\/>/g) || [];
  for (const rowXml of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowXml.match(/<(?:\w+:)?c[^>]*\/>|<(?:\w+:)?c[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g) || [];
    for (const cellXml of cellMatches) {
      const reference = /r="([A-Z]+\d+)"/.exec(cellXml)?.[1] || '';
      const target = reference ? columnIndex(reference) : cells.length;
      const type = /t="([^"]+)"/.exec(cellXml)?.[1] || 'n';
      const value = /<(?:\w+:)?v[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cellXml)?.[1];
      const inlineMatches = cellXml.match(/<(?:\w+:)?is>[\s\S]*?<\/(?:\w+:)?is>/g) || [];
      let text = '';
      if (value !== undefined) {
        text = type === 's' ? (sharedStrings[Number(value)] ?? '') : xmlText(value);
      } else if (inlineMatches.length) {
        const inline = inlineMatches[0] ?? '';
        const parts = inline.match(/<(?:\w+:)?t[^>]*>[\s\S]*?<\/(?:\w+:)?t>/g) || [];
        text = xmlText(parts.map((part) => part.replace(/^<(?:\w+:)?t[^>]*>/, '').replace(/<\/(?:\w+:)?t>$/, '')).join(''));
      }
      while (cells.length < target) cells.push('');
      cells[target] = text.trim();
    }
    rows.push(cells);
  }
  return rows;
}

export function loadSharedStrings(bytes: Uint8Array): string[] {
  const xml = readZipEntries(bytes).get('xl/sharedStrings.xml');
  if (!xml) return [];
  return parseSharedStrings(new TextDecoder().decode(xml));
}

/**
 * Parses the daily holdings download.
 *
 * VanEck ships two shapes and both must resolve onto the shared column
 * contract:
 *   equity  Number | Ticker | Holding Name | Identifier (FIGI) | Shares
 *           | Asset Class | Market Value (US$) | Notional Value | % of Net Assets
 *   fixed   Number | Holding Name | Maturity | Identifier (FIGI) | Coupon
 *           | Asset Class | Par Value/ Contracts | Market Value | Notional Value
 *           | % of Net Assets | Country | Currency
 * Note the fixed-income sheet has **no Ticker column at all** — the FIGI is the
 * only identifier, which is exactly why the Watchlist dedupe chain must fall
 * through to it.
 */
export function parseVanEckHoldings(sheet: HtmlTable): ParsedHoldings {
  const asOfMatch = /Daily Holdings \(%\)\s*([\d/]{8,10})/i.exec(decodeHtmlEntities(sheet[0]?.[0] ?? ''));
  const asOfDate = asOfMatch ? formatVanEckDate(asOfMatch[1]) : '—';
  const headerIndex = findHeaderRowIndex(sheet, ['Holding Name', '% of Net Assets']);
  if (headerIndex >= 0) {
    const header = sheet[headerIndex];
    const isFixedIncome = header.some((h) => /maturity/i.test(h));
    const headers = isFixedIncome
      ? ['Name', 'Maturity', 'Identifier', 'Coupon', 'Asset Category', 'Par Value', 'Market Value', 'Weight', 'Country', 'Currency']
      : ['Name', 'Ticker', 'Identifier', 'Shares Held', 'Asset Category', 'Market Value', 'Notional Value', 'Weight'];
    const rows: string[][] = [];
    for (let i = headerIndex + 1; i < sheet.length; i++) {
      const row = sheet[i];
      if (!row.length) continue;
      // The trailing legal-disclosure row is not a position.
      if (/not recommendations to buy or to sell/i.test(row.join(' '))) continue;
      // Both sides must be normalized the same way: "% of Net Assets" becomes
      // "ofnetassets" (the "%" is stripped), so an un-normalized lookup key
      // silently fails and every weight comes back empty.
      const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const byName = (name: string): string => {
        const wanted = normalizeHeader(name);
        const index = header.findIndex((h) => normalizeHeader(h).includes(wanted));
        return index >= 0 ? cleanCell(row[index] ?? '') : '';
      };
      const weightRaw = byName('ofnetassets');
      const weight = weightRaw ? `${normalizeNumberText(weightRaw)}%` : '';
      if (isFixedIncome) {
        rows.push([
          byName('holdingname'),
          byName('maturity') ? formatVanEckDate(byName('maturity')) : '',
          byName('identifier'),
          byName('coupon'),
          byName('assetclass'),
          byName('parvalue'),
          byName('marketvalue'),
          weight,
          byName('country'),
          byName('currency'),
        ]);
      } else {
        rows.push([
          byName('holdingname'),
          byName('ticker'),
          byName('identifier'),
          byName('shares'),
          byName('assetclass'),
          byName('marketvalue'),
          byName('notionalvalue'),
          weight,
        ]);
      }
    }
    return { asOfDate, headers, rows: rows.filter((r) => r.some((c) => c !== '')) };
  }
  return { asOfDate, headers: HOLDINGS_HEADERS, rows: [] };
}

/** Reads the first worksheet of a VanEck holdings/history XLSX download into rows of cell text. */
export function parseVanEckHoldingsXlsx(bytes: Uint8Array): ParsedHoldings {
  return parseVanEckHoldings(parseXlsxSheet(bytes, loadSharedStrings(bytes)));
}

export type ParsedHistory = { headers: string[]; rows: string[][] };

/**
 * Parses the NAV & premium/discount history download:
 *   Date | NAV | Change | % Change | Last Trade | Volume | Premium/Discount
 *   | % Premium/Discount | AUM | Index Level
 * Weekend rows repeat the previous NAV with an empty Volume cell; they are kept
 * because VanEck publishes them and dropping rows would misstate the count.
 */
export function parseVanEckHistory(sheet: HtmlTable): ParsedHistory {
  const headerIndex = findHeaderRowIndex(sheet, ['Date', 'NAV', 'Last Trade']);
  if (headerIndex >= 0) {
    const header = sheet[headerIndex];
    const index = (name: string): number =>
      header.findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '').includes(name));
    const rows: string[][] = [];
    for (let i = headerIndex + 1; i < sheet.length; i++) {
      const row = sheet[i];
      const date = cleanCell(row[index('date')] ?? '');
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue;
      rows.push([
        formatVanEckDate(date),
        cleanCell(row[index('nav')] ?? ''),
        cleanCell(row[index('lasttrade')] ?? ''),
        cleanCell(row[index('volume')] ?? ''),
        cleanCell(row[index('premiumdiscount')] ?? ''),
        cleanCell(row[index('aum')] ?? ''),
        cleanCell(row[index('indexlevel')] ?? ''),
      ]);
    }
    if (rows.length) return { headers: HISTORY_HEADERS, rows };
  }
  return { headers: HISTORY_HEADERS, rows: [] };
}

/** Reads the first worksheet of a VanEck NAV/premium-discount history XLSX download into rows of cell text. */
export function parseVanEckHistoryXlsx(bytes: Uint8Array): ParsedHistory {
  return parseVanEckHistory(parseXlsxSheet(bytes, loadSharedStrings(bytes)));
}

export type ParsedFundPage = {
  fundPage: string;
  fundName: string;
  breadcrumb: string;
  nav: number | null;
  navAsOf: string | null;
  ytdReturn: number | null;
  ytdAsOf: string | null;
  /** "Performance since inception" stat shown instead of YTD for days-old funds. */
  siReturn: number | null;
  siAsOf: string | null;
  totalNetAssets: number | null;
  totalNetAssetsAsOf: string | null;
  grossExpenseRatio: number | null;
  netExpenseRatio: number | null;
  totalExpenseRatio: number | null;
  inceptionDate: string | null;
  secYield: number | null;
  exchange: string | null;
  cusip: string | null;
  isin: string | null;
  /** Benchmark index named by the page Overview copy, e.g. GDX -> MVGDXTR. */
  indexTicker: string | null;
  indexName: string | null;
  sharesOutstanding: number | null;
  pageId: string | null;
  performanceBlockId: string | null;
  distributionsBlockId: string | null;
};

/**
 * Reads the server-rendered fund header. Only these fields are present without
 * JavaScript; the Performance / Distributions / Fees panels on the same page are
 * fetched client-side and are therefore NOT a source for this feed (see README
 * "Known value limitations").
 */
export function parseVanEckFundPage(html: string, fundPage: string): ParsedFundPage {
  // Some fund pages carry a JSON-LD FAQ schema (<script type="application/ld+json">)
  // whose copy happens to say "NAV" (or another stat label) before the real
  // header stat does in document order — e.g. GDXJ's FAQ answers "What is the
  // NAV indicator symbol?" ahead of the actual NAV block. `<script>`/`<style>`
  // contents are never visible page text, so drop them whole before searching.
  const withoutScripts = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // NAV and the two expense-ratio stats each carry a hidden
  // `subscription-tooltip-content` disclaimer (`style="display:none;"`)
  // sitting between the stat's label and its value in DOM order. Stripped
  // naively, that disclaimer's text lands inside the 260-char window `near()`
  // reads after the label, so the value itself is never reached — the fund
  // page fetch "succeeds" but nav/grossExpenseRatio/netExpenseRatio come back
  // null for every fund. Drop these hidden blocks before de-tagging.
  const withoutTooltips = withoutScripts.replace(/<div class="subscription-tooltip-content"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g, '');
  const text = decodeHtmlEntities(withoutTooltips);
  const plain = text.replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ');
  const near = (label: RegExp): string => {
    const match = label.exec(plain);
    if (!match) return '';
    return cleanText(plain.slice(match.index + match[0].length, match.index + match[0].length + 260));
  };
  const asOf = (blob: string): string | null => {
    const found = /as of ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(blob);
    if (!found) return null;
    const parsed = new Date(`${found[1]} UTC`);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatVanEckDate(
      `${String(parsed.getUTCMonth() + 1).padStart(2, '0')}/${String(parsed.getUTCDate()).padStart(2, '0')}/${parsed.getUTCFullYear()}`,
    );
  };
  const percent = (blob: string): number | null => {
    const found = /(-?\d+(?:\.\d+)?)\s*%/.exec(blob);
    return found ? Number(found[1]) : null;
  };
  const compactMoney = (blob: string): number | null => {
    const found = /\$\s?([\d,]+(?:\.\d+)?)\s*([BM])?/.exec(blob);
    if (!found) return null;
    const base = Number(found[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) return null;
    const suffix = (found[2] || '').toUpperCase();
    return suffix === 'B' ? base * 1e9 : suffix === 'M' ? base * 1e6 : base;
  };
  const navBlob = near(/\bNAV\b/);
  const ytdBlob = near(/YTD RETURNS/i);
  const siBlob = near(/PERFORMANCE SINCE INCEPTION/i);
  const aumBlob = near(/Total Net Assets/i);
  const grossBlob = near(/Gross Expense Ratio/i);
  const netBlob = near(/Net Expense Ratio/i);
  const totalBlob = near(/Total Expense Ratio/i);
  const inceptionBlob = near(/Inception Date/i);
  const secYieldBlob = near(/30-Day SEC Yield/i);
  const exchangeBlob = near(/\bExchange\b/i);
  const cusipBlob = near(/\bCUSIP\b/i);
  const isinBlob = near(/\bISIN\b/i);
  const sharesBlob = near(/Shares Outstanding/i);
  const nameMatch = /<h1[^>]*>\s*(?:<[^>]*>\s*)*([A-Z0-9]+)\s+([^<]+)/i.exec(text);
  const crumbMatch = /Equity ETFs|Income ETFs|Real Assets[^<]*ETFs|ETFs\//.exec(plain);
  const inceptionMatch = /(\d{2}\/\d{2}\/\d{4})/.exec(inceptionBlob);
  const cusipMatch = /([0-9A-Z]{8,9})/.exec(cleanText(cusipBlob).slice(0, 40));
  const isinMatch = /(US[0-9A-Z]{10})/i.exec(cleanText(isinBlob).slice(0, 40));
  const sharesMatch = /([\d,]+)/.exec(cleanText(sharesBlob).slice(0, 50));
  const exchangeMatch = /(NYSE Arca|NYSE American|NASDAQ|Cboe BZX|BATS|Arca)/i.exec(cleanText(exchangeBlob).slice(0, 60));
  // Overview copy names the benchmark index ("…before fees and expenses. The
  // <Name> Index (<TICKER>)…"); the fact sheet does too. The parenthesised
  // all-caps token right after the word "Index" is the index ticker.
  const indexMatch = /([A-Z][A-Za-z0-9 .&'-]{3,80}?)\s+Index\s+\(([A-Z0-9]{3,12})\)/.exec(plain);
  // The Average Annual Total Returns table and the Distribution History table
  // are both loaded client-side, but from a plain, unauthenticated JSON
  // endpoint (`/Main/<BlockName>/GetContent/?blockid=…&pageid=…&ticker=…`) —
  // no browser JS execution is needed, only the block's own id, which is a
  // real DOM attribute on the untouched (pre-script-stripped) page.
  const pageIdMatch = /data-pageid="(\d+)"/.exec(html);
  const performanceBlockMatch = /<ve-performancehistoryblock\b[^>]*data-blockid="(\d+)"/i.exec(html);
  const distributionsBlockMatch = /<ve-navdistributionsblock\b[^>]*data-blockid="(\d+)"/i.exec(html);
  return {
    fundPage,
    fundName: nameMatch ? cleanText(`${nameMatch[2]}`) : '',
    breadcrumb: crumbMatch ? cleanText(crumbMatch[0]) : '',
    nav: percent(navBlob) === null ? compactMoney(navBlob) : numberOrNull((/\$\s?([\d,.]+)/.exec(navBlob) || [])[1]),
    navAsOf: asOf(navBlob),
    ytdReturn: percent(ytdBlob),
    ytdAsOf: asOf(ytdBlob),
    siReturn: percent(siBlob),
    siAsOf: asOf(siBlob),
    totalNetAssets: compactMoney(aumBlob),
    totalNetAssetsAsOf: asOf(aumBlob),
    grossExpenseRatio: percent(grossBlob),
    netExpenseRatio: percent(netBlob),
    totalExpenseRatio: percent(totalBlob),
    inceptionDate: inceptionMatch ? formatVanEckDate(inceptionMatch[1]) : null,
    secYield: percent(secYieldBlob),
    exchange: exchangeMatch ? cleanText(exchangeMatch[1]) : null,
    cusip: cusipMatch ? cusipMatch[1].toUpperCase() : null,
    isin: isinMatch ? isinMatch[1].toUpperCase() : null,
    indexTicker: indexMatch ? indexMatch[2].toUpperCase() : null,
    indexName: indexMatch ? `${cleanText(indexMatch[1])} Index` : null,
    sharesOutstanding: sharesMatch ? Number(sharesMatch[1].replace(/,/g, '')) : null,
    pageId: pageIdMatch ? pageIdMatch[1] : null,
    performanceBlockId: performanceBlockMatch ? performanceBlockMatch[1] : null,
    distributionsBlockId: distributionsBlockMatch ? distributionsBlockMatch[1] : null,
  };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** TR nY = (1 + CAGR nY)^n − 1, the same rule the siblings use. */
export function cumulativeFromAnnualized(cagrPercent: number | null, years: number): number | null {
  if (cagrPercent === null) return null;
  return round(((1 + cagrPercent / 100) ** years - 1) * 100, 2);
}

export function annualizedFromCumulative(totalPercent: number | null, years: number): number | null {
  if (totalPercent === null) return null;
  const growth = 1 + totalPercent / 100;
  if (growth <= 0) return null;
  return round((growth ** (1 / years) - 1) * 100, 2);
}

/**
 * Distribution cadence from the fund's own payment rows.
 * VanEck publishes no discrete frequency label in anything the static updater
 * can read, so the code is derived from observed ex-date gaps — the same
 * approach as Fidelity/Invesco's inferDistributionFrequency().
 */
export function inferDistributionFrequency(exDates: string[]): string {
  const stamps = exDates
    .map((raw) => Date.parse(`${toIsoDate(raw)} UTC`))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  if (stamps.length < 3) return 'Unknown';
  // Use the most recent gaps rather than a fixed calendar window. A strict
  // 365-day lookback can never see three semi-annual payments — three payments
  // on a 6-month cadence span about 365 days, so the oldest always falls just
  // outside the window and the cadence reads as "Unknown". Six gaps is enough
  // to cover a year of monthly payments and still catch a recent cadence change.
  const gaps: number[] = [];
  for (let i = 0; i < stamps.length - 1 && gaps.length < 6; i++) {
    gaps.push((stamps[i] - stamps[i + 1]) / (24 * 3600 * 1000));
  }
  if (gaps.length < 2) return 'Unknown';
  const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median >= 20 && median <= 40) return 'Monthly';
  if (median >= 70 && median <= 110) return 'Quarterly';
  if (median >= 150 && median <= 215) return 'Semiannually';
  if (median >= 330 && median <= 400) return 'Annually';
  return 'Irregular';
}

/** Indicated yield = latest distribution x payments per year / NAV. */
export function indicatedDividendYield(
  latestDividend: number | null,
  paymentsPerYear: number | null,
  nav: number | null,
): number | null {
  if (latestDividend === null || !paymentsPerYear || !nav) return null;
  return round(((latestDividend * paymentsPerYear) / nav) * 100, 2);
}

export function premiumDiscount(close: number | null, nav: number | null): number | null {
  if (close === null || nav === null || nav === 0) return null;
  return round(((close - nav) / nav) * 100, 2);
}

const FREQUENCY_TO_CODE: Record<string, string> = {
  monthly: '01 - Monthly',
  quarterly: '04 - Quarterly',
  semiannually: '06 - Semi-annually',
  semiannual: '06 - Semi-annually',
  annually: '12 - Annually',
  annual: '12 - Annually',
  none: '00 - None',
  unknown: '00 - Unknown',
  irregular: '99 - Irregular',
};

/** The coded, sortable Frequency label. Mirrors the client-side formatter. */
export function frequencyCode(label: unknown): string {
  const text = cleanText(label).toLowerCase().replace(/[-\s]+/g, '');
  if (!text) return '00 - —';
  return FREQUENCY_TO_CODE[text] ?? cleanText(label);
}

export function paymentsPerYear(frequency: string): number | null {
  const map: Record<string, number> = { Monthly: 12, Quarterly: 4, Semiannually: 2, Annually: 1 };
  const key = String(frequency ?? '').replace(/[-\s]+/g, '').toLowerCase();
  const byKey: Record<string, number> = { monthly: 12, quarterly: 4, semiannually: 2, semiannual: 2, annually: 1, annual: 1 };
  return map[frequency] ?? byKey[key] ?? null;
}

/**
 * Guards the indicated yield: annualising a stale distribution invents a
 * yield the fund no longer pays (BUZZ's latest payout is Dec 2024, yet the
 * finder prints `--`). The indicated yield is only computed when the latest
 * ex-date is within `maxAgeDays` of the NAV as-of date; otherwise the fund
 * genuinely yields nothing reportable and the value stays null.
 */
export function indicatedYieldAllowed(
  latestExDate: string | null,
  asOfDate: string | null,
  maxAgeDays = 400,
): boolean {
  if (!latestExDate || !asOfDate) return false;
  const ex = Date.parse(`${toIsoDate(latestExDate)} UTC`);
  const asOf = Date.parse(`${toIsoDate(asOfDate)} UTC`);
  if (!Number.isFinite(ex) || !Number.isFinite(asOf)) return false;
  return asOf - ex <= maxAgeDays * 86400000;
}

// ---------------------------------------------------------------------------
// Deterministic writing
// ---------------------------------------------------------------------------

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 1)}\n`;
}

/** Writes only when the serialized bytes actually differ (P13: empty diff). */
async function writeIfChanged(file: string, contents: string): Promise<'written' | 'unchanged'> {
  if (existsSync(file)) {
    const existing = await readFile(file, 'utf8');
    if (existing === contents) return 'unchanged';
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
  return 'written';
}

export function chunkRows<T>(rows: T[], pageSize: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += pageSize) pages.push(rows.slice(i, i + pageSize));
  return pages.length ? pages : [];
}

type PageManifest = {
  totalRows: number;
  pageSize: number;
  pageCount: number;
  pages: string[];
  asOfDate: string;
  source: string;
};

// ---------------------------------------------------------------------------
// Feed assembly
// ---------------------------------------------------------------------------

export type CatalogEntry = Record<string, unknown>;

export function seedCatalogEntry(seed: VanEckSeedFund): CatalogEntry {
  const aum = seed.aumMillions === null ? null : seed.aumMillions * 1e6;
  const ter = seed.terNet ?? seed.terGross;
  return {
    ticker: seed.ticker,
    name: `VanEck ${seed.name}`.replace(/^VanEck VanEck /, 'VanEck '),
    category: CATEGORY_GROUP[seed.category] ?? seed.category,
    fundPage: vaneckFundPageUrl(seed.ticker),
    dataFile: `./funds/${seed.ticker}/meta.json`,
    cusip: null,
    isin: null,
    ter: ter === null ? '—' : `${ter.toFixed(2)}%`,
    terValue: ter,
    nav: '—',
    navValue: null,
    aum: aum === null ? '—' : formatAumDisplay(aum),
    aumValue: aum === null ? null : round(aum, 2),
    asOfDate: aum === null ? '—' : formatVanEckDate(AUM_AS_OF_GUIDE),
    inceptionDate: '—',
    exchange: '—',
    closePrice: '—',
    closePriceValue: null,
    premiumDiscount: '—',
    premiumDiscountValue: null,
    distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: {
      monthEnd: { asOfDate: '—' },
      quarterEnd: { asOfDate: '—' },
    },
    metrics: {
      ytd: null,
      tr1y: null,
      tr3y: null,
      tr5y: null,
      tr10y: null,
      cagr3y: null,
      cagr5y: null,
      cagr10y: null,
      siAnn: null,
      dividendYield: null,
      dividendYieldText: '—',
      distributionYield: null,
      distributionYieldText: '—',
      yield12M: null,
      yield12MText: '—',
      secYield: null,
      secYieldText: '—',
      returnsBasis: 'not yet refreshed from vaneck.com',
    },
    distributionFrequency: 'Unknown',
    providerCategory: seed.category,
    terGross: seed.terGross === null ? '—' : `${seed.terGross.toFixed(2)}%`,
    terGrossValue: seed.terGross,
    netAssetsAsOf: formatVanEckDate(AUM_AS_OF_GUIDE),
    holdings: 0,
    history: 0,
  };
}

/** Merges a verified fund-page snapshot onto a catalog entry. */
export function applyFundPageSnapshot(entry: CatalogEntry, snapshot: Record<string, unknown>): CatalogEntry {
  const merged: CatalogEntry = { ...entry };
  const s = snapshot as unknown as ParsedFundPage;
  if (s.fundName) merged.name = s.fundName;
  if (s.fundPage) merged.fundPage = s.fundPage;
  if (s.nav !== null && s.nav !== undefined) {
    merged.nav = `$${Number(s.nav).toFixed(2)}`;
    merged.navValue = s.nav;
  }
  if (s.navAsOf) merged.asOfDate = formatVanEckDate(s.navAsOf);
  if (s.totalNetAssets !== null && s.totalNetAssets !== undefined) {
    merged.totalNetAssets = s.totalNetAssets;
    merged.aum = formatMoneyText(s.totalNetAssets as number);
    merged.aumValue = round(s.totalNetAssets as number, 2);
    merged.netAssetsAsOf = s.totalNetAssetsAsOf ? formatVanEckDate(s.totalNetAssetsAsOf) : '—';
  }
  const ter = (s.netExpenseRatio ?? s.grossExpenseRatio ?? s.totalExpenseRatio) as number | null;
  if (ter !== null && ter !== undefined) {
    merged.ter = `${ter.toFixed(2)}%`;
    merged.terValue = ter;
  }
  if (s.grossExpenseRatio !== null && s.grossExpenseRatio !== undefined) {
    merged.terGross = `${(s.grossExpenseRatio as number).toFixed(2)}%`;
    merged.terGrossValue = s.grossExpenseRatio;
  }
  if (s.inceptionDate) merged.inceptionDate = formatVanEckDate(s.inceptionDate);
  if ((s as Record<string, unknown>).secYield !== undefined && s.secYield !== null) {
    const v = s.secYield as number;
    merged.secYield = `${v.toFixed(2)}%`;
    merged.secYieldValue = v;
    const metrics = (merged.metrics as Record<string, unknown>) ?? {};
    merged.metrics = { ...metrics, secYield: v, secYieldText: `${v.toFixed(2)}%` };
  }
  if (s.exchange) merged.exchange = s.exchange;
  if (s.cusip) merged.cusip = s.cusip;
  if (s.isin) merged.isin = s.isin;
  if (s.sharesOutstanding !== null && s.sharesOutstanding !== undefined) {
    merged.sharesOutstanding = s.sharesOutstanding;
    merged.sharesOutstandingText = String(s.sharesOutstanding);
  }
  if (s.ytdReturn !== null && s.ytdReturn !== undefined) {
    merged.returns = {
      monthEnd: { asOfDate: s.ytdAsOf ? formatVanEckDate(s.ytdAsOf) : '—', ytd: s.ytdReturn, ytdText: `${(s.ytdReturn as number).toFixed(2)}%` },
      quarterEnd: { asOfDate: '—' },
    };
    merged.metrics = {
      ...((merged.metrics as Record<string, unknown>) ?? {}),
      ytd: s.ytdReturn,
      returnsBasis: 'official VanEck fund-page YTD return',
    };
  }
  // Days-old funds (VEEM) publish "Performance since inception" instead of a
  // YTD stat. It maps onto siAnn only — never mislabelled as YTD.
  if ((s.ytdReturn === null || s.ytdReturn === undefined) && s.siReturn !== null && s.siReturn !== undefined) {
    merged.metrics = {
      ...((merged.metrics as Record<string, unknown>) ?? {}),
      siAnn: s.siReturn,
      returnsBasis: 'official VanEck fund-page performance since inception',
    };
    const prevReturns = (merged.returns as unknown as Record<string, Record<string, unknown>>) ?? {};
    merged.returns = {
      monthEnd: { ...(prevReturns.monthEnd ?? { asOfDate: '—' }), sinceInception: s.siReturn },
      quarterEnd: { ...(prevReturns.quarterEnd ?? { asOfDate: '—' }) },
    } as unknown as CatalogEntry['returns'];
  }
  if (s.indexTicker) {
    (merged as Record<string, unknown>).indexTicker = s.indexTicker;
    (merged as Record<string, unknown>).indexName = s.indexName ?? null;
  }
  return merged;
}

/** Merges the latest history row (close price + premium/discount + AUM). */
export function applyLatestHistoryRow(entry: CatalogEntry, row: string[] | undefined): CatalogEntry {
  if (!row) return entry;
  const merged: CatalogEntry = { ...entry };
  const [, nav, close, , premDisc, aum] = row;
  const closeValue = numberOrNull(close);
  const navValue = numberOrNull(nav);
  const aumValue = numberOrNull(aum);
  if (closeValue !== null) {
    merged.closePrice = `$${closeValue.toFixed(2)}`;
    merged.closePriceValue = closeValue;
  }
  const pd = numberOrNull(premDisc) ?? premiumDiscount(closeValue, navValue);
  if (pd !== null) {
    merged.premiumDiscount = `${pd.toFixed(2)}%`;
    merged.premiumDiscountValue = pd;
  }
  if (aumValue !== null) {
    merged.aum = formatMoneyText(aumValue);
    merged.aumValue = round(aumValue, 2);
  }
  merged.asOfDate = row[0];
  return merged;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type RunStats = { updated: number; unchanged: number; skipped: number; failed: number };

async function readCursor(): Promise<string | null> {
  const file = path.join(API_ROOT, 'update-state.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return typeof parsed.cursor === 'string' && parsed.cursor ? parsed.cursor : null;
  } catch {
    return null;
  }
}

export function selectCandidates(
  funds: VanEckSeedFund[],
  config: UpdaterConfig,
  cursor: string | null,
): VanEckSeedFund[] {
  let list = funds.slice().sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (config.category) {
    const wanted = config.category.toLowerCase();
    list = list.filter(
      (fund) =>
        fund.category.toLowerCase() === wanted ||
        (CATEGORY_GROUP[fund.category] ?? '').toLowerCase() === wanted,
    );
  }
  if (config.tickers.length) {
    const wanted = new Set(config.tickers);
    // ANDed with the catalog filters, never replacing them.
    list = list.filter((fund) => wanted.has(fund.ticker));
  }
  if (config.aumRange) {
    list = list.filter((fund) => {
      if (fund.aumMillions === null) return false;
      const value = fund.aumMillions * 1e6;
      if (config.aumRange!.min !== undefined && value < config.aumRange!.min) return false;
      if (config.aumRange!.max !== undefined && value >= config.aumRange!.max) return false;
      return true;
    });
  }
  if (config.terRange) {
    list = list.filter((fund) => {
      const ter = fund.terNet ?? fund.terGross;
      if (ter === null) return false;
      if (config.terRange!.min !== undefined && ter < config.terRange!.min) return false;
      if (config.terRange!.max !== undefined && ter > config.terRange!.max) return false;
      return true;
    });
  }
  if (cursor) {
    const index = list.findIndex((fund) => fund.ticker === cursor);
    if (index >= 0 && index < list.length - 1) list = list.slice(index + 1);
  }
  if (config.maxFetches > 0) list = list.slice(0, config.maxFetches);
  return list;
}

async function writeFundPages(
  ticker: string,
  kind: 'holdings' | 'history',
  manifest: Omit<PageManifest, 'pages' | 'pageCount'>,
  pages: Array<Array<Record<string, string>>>,
): Promise<PageManifest> {
  const dir = path.join(API_ROOT, 'funds', ticker, kind);
  const pageFiles: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const name = `${pad3(i + 1)}.json`;
    // Page paths are relative to the fund folder with no "./" prefix, matching
    // the sibling feeds and the app's own path join.
    pageFiles.push(`${kind}/${name}`);
    const rows = pages[i];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    // Guard against a row/header shape mismatch: every row must carry exactly
    // the published headers, so a misaligned mapping fails here, not in the UI.
    for (const row of rows) {
      const keys = Object.keys(row);
      if (keys.length !== headers.length || keys.some((key) => !headers.includes(key))) {
        throw new Error(`${ticker}/${kind}/${name}: row shape does not match headers ${JSON.stringify(headers)}`);
      }
    }
    await writeIfChanged(
      path.join(dir, name),
      serialize({ ticker, page: i + 1, pageSize: manifest.pageSize, totalRows: manifest.totalRows, headers, rows }),
    );
  }
  return { ...manifest, pageCount: pages.length, pages: pageFiles };
}

function toKeyedRows(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    headers.forEach((header, index) => {
      out[header] = row[index] ?? '';
    });
    return out;
  });
}

function snapshotHoldingsFor(ticker: string): ParsedHoldings | null {
  const snapshot = EQUITY_HOLDINGS_SNAPSHOTS[ticker];
  if (!snapshot) return null;
  // VanEck's equity sheet, in the provider's own column order:
  //   Number | Ticker | Holding Name | Identifier (FIGI) | Shares | Asset Class
  //   | Market Value (US$) | Notional Value | % of Net Assets
  // mapped onto the shared position contract. The Number column is a display
  // ordinal and is dropped; Notional Value is "--" for every equity position.
  const headers = ['Name', 'Ticker', 'Identifier', 'Shares Held', 'Asset Category', 'Market Value', 'Notional Value', 'Weight'];
  return {
    asOfDate: formatVanEckDate(snapshot.asOf),
    headers,
    // Routed through the same cleanCell() normalizer the live-HTML parser uses,
    // so both code paths emit identical cells for the same published value
    // ("--" and friends collapse to "" in either case, and the client's
    // placeholder rules then resolve the row by its published name).
    rows: snapshot.rows.map(([rowTicker, name, figi, shares, assetClass, marketValue, weight]) => [
      cleanCell(name),
      cleanCell(rowTicker),
      cleanCell(figi),
      cleanCell(shares),
      cleanCell(assetClass),
      cleanCell(marketValue),
      '', // Notional Value is "--" for every equity position VanEck publishes
      cleanCell(`${normalizeNumberText(weight)}%`),
    ]),
  };
}

function snapshotHistoryFor(ticker: string): ParsedHistory | null {
  const snapshot = HISTORY_SNAPSHOTS[ticker];
  if (!snapshot) return null;
  return {
    headers: HISTORY_HEADERS,
    rows: snapshot.rows.map(([date, nav, , , lastTrade, volume, premDisc, , aum, indexLevel]) => [
      formatVanEckDate(date),
      String(nav),
      String(lastTrade),
      volume,
      String(premDisc),
      String(aum),
      String(indexLevel),
    ]),
  };
}

export async function updateFund(
  seed: VanEckSeedFund,
  config: UpdaterConfig,
  stats: RunStats,
): Promise<CatalogEntry> {
  let entry = seedCatalogEntry(seed);
  const ticker = seed.ticker;
  const source: Record<string, string> = {
    provider: 'Van Eck Associates Corporation (VanEck US ETFs)',
    fundPage: entry.fundPage as string,
    holdingsDownload: vaneckHoldingsUrl(entry.fundPage as string),
    navDownload: vaneckHistoryUrl(entry.fundPage as string),
    catalog: VANECK_ETF_GUIDE_URL,
    nportRegistrant: `SEC EDGAR Form N-PORT-P, VanEck ETF Trust CIK ${VANECK_ETF_TRUST_CIK}`,
    yahooChart: yahooChartProvenanceUrl(ticker),
  };

  // --- fund page -----------------------------------------------------------
  let pageSnapshot = FUND_PAGE_SNAPSHOTS[ticker] ?? null;
  if (!config.skipVanEck && !config.offlineSeed) {
    try {
      const html = await fetchText(vaneckFundPageUrl(ticker), browserHeaders(), config, `${ticker} fund page`);
      pageSnapshot = parseVanEckFundPage(html, vaneckFundPageUrl(ticker));
    } catch (error) {
      console.warn(`  ! ${ticker}: fund page unavailable (${errorMessage(error)}); keeping catalog values`);
      stats.failed += 1;
    }
  }
  if (pageSnapshot) {
    entry = applyFundPageSnapshot(entry, pageSnapshot);
    source.fundPage = pageSnapshot.fundPage;
    source.holdingsDownload = vaneckHoldingsUrl(pageSnapshot.fundPage);
    source.navDownload = vaneckHistoryUrl(pageSnapshot.fundPage);
  }

  // --- holdings ------------------------------------------------------------
  let holdings: ParsedHoldings | null = null;
  if (!config.skipVanEck && !config.offlineSeed) {
    try {
      holdings = parseVanEckHoldingsXlsx(await fetchBytes(source.holdingsDownload, browserHeaders(), config, `${ticker} holdings`));
    } catch (error) {
      // The suspended Russia funds never moved to `/downloads/holdings/`;
      // retry once against the legacy pre-redesign path before giving up.
      try {
        const legacyUrl = vaneckLegacyHoldingsUrl(ticker);
        holdings = parseVanEckHoldingsXlsx(await fetchBytes(legacyUrl, browserHeaders(), config, `${ticker} holdings (legacy)`));
        source.holdingsDownload = legacyUrl;
      } catch (legacyError) {
        console.warn(`  ! ${ticker}: holdings unavailable (${errorMessage(error)}; legacy: ${errorMessage(legacyError)})`);
      }
    }
  }
  if (!holdings) holdings = snapshotHoldingsFor(ticker);
  const holdingsPages = holdings ? chunkRows(toKeyedRows(holdings.headers, holdings.rows), config.holdingsPageSize) : [];
  const holdingsManifest = holdings
    ? await writeFundPages(ticker, 'holdings', {
        totalRows: holdings.rows.length,
        pageSize: config.holdingsPageSize,
        asOfDate: holdings.asOfDate,
        source: `VanEck daily holdings download (${source.holdingsDownload})`,
      }, holdingsPages)
    : null;

  // --- history -------------------------------------------------------------
  let history: ParsedHistory | null = null;
  if (!config.skipVanEck && !config.offlineSeed) {
    try {
      history = parseVanEckHistoryXlsx(await fetchBytes(source.navDownload, browserHeaders(), config, `${ticker} NAV history`));
    } catch (error) {
      console.warn(`  ! ${ticker}: NAV history unavailable (${errorMessage(error)})`);
    }
  }
  if (!history) history = snapshotHistoryFor(ticker);
  if (history && config.historyRange && config.historyRange !== 'max') {
    const cutoff = Date.parse(`${config.historyRange} UTC`);
    if (Number.isFinite(cutoff)) {
      history = { ...history, rows: history.rows.filter((row) => Date.parse(`${toIsoDate(row[0])} UTC`) >= cutoff) };
    }
  }
  const historyPages = history ? chunkRows(toKeyedRows(history.headers, history.rows), config.historyPageSize) : [];
  const historyManifest = history
    ? await writeFundPages(ticker, 'history', {
        totalRows: history.rows.length,
        pageSize: config.historyPageSize,
        asOfDate: history.rows.length ? history.rows[0][0] : '—',
        source: `VanEck NAV & premium/discount history download (${source.navDownload})`,
      }, historyPages)
    : null;

  if (history && history.rows.length) entry = applyLatestHistoryRow(entry, history.rows[0]);
  entry.holdings = holdings ? holdings.rows.length : 0;
  entry.history = history ? history.rows.length : 0;

  // --- performance (Average Annual Total Returns) ---------------------------
  // Client-hydrated on the page, but from a plain JSON endpoint the widget
  // itself calls — see fetchVanEckPerformance().
  let performance: ParsedPerformance | null = null;
  if (!config.skipVanEck && !config.offlineSeed && pageSnapshot?.pageId && pageSnapshot?.performanceBlockId) {
    performance = await fetchVanEckPerformance(ticker, pageSnapshot.pageId, pageSnapshot.performanceBlockId, config);
  }
  const finder = finderForTicker(ticker);
  const metrics = entry.metrics as Record<string, unknown>;
  if (performance) {
    metrics.tr1y = performance.tr1y;
    metrics.tr3y = performance.tr3y;
    metrics.tr5y = performance.tr5y;
    metrics.tr10y = performance.tr10y;
    metrics.cagr3y = performance.cagr3y;
    metrics.cagr5y = performance.cagr5y;
    metrics.cagr10y = performance.cagr10y;
    // A fund too young for the Average Annual Total Returns block to report
    // an SI figure (it comes back JSON null) can still have one from the
    // fund page's own "Performance since inception" header stat, applied
    // earlier in applyFundPageSnapshot() — never clobber that with a null.
    metrics.siAnn = performance.siAnn ?? metrics.siAnn ?? null;
    metrics.returnsBasis = 'official VanEck Average Annual Total Returns (NAV)';
    const returnsMonthEnd = (entry.returns as Record<string, unknown>).monthEnd as Record<string, unknown>;
    returnsMonthEnd.yr1 = performance.tr1y;
    returnsMonthEnd.yr3 = performance.cagr3y;
    returnsMonthEnd.yr5 = performance.cagr5y;
    returnsMonthEnd.yr10 = performance.cagr10y;
    returnsMonthEnd.sinceInception = metrics.siAnn;
    // The fund-page YTD as-of (daily) wins over the block's month-end as-of:
    // only fill a blank (seed '—') stamp, never clobber a real one.
    if (returnsMonthEnd.asOfDate === '—' && performance.asOfDate) returnsMonthEnd.asOfDate = performance.asOfDate;
    if (performance.quarterEnd) {
      const q = performance.quarterEnd;
      const quarterEnd = (entry.returns as Record<string, unknown>).quarterEnd as Record<string, unknown>;
      quarterEnd.asOfDate = q.asOfDate ?? '—';
      if (q.ytd !== null && q.ytd !== undefined) {
        quarterEnd.ytd = q.ytd;
        quarterEnd.ytdText = `${q.ytd.toFixed(2)}%`;
      }
      quarterEnd.yr1 = q.tr1y;
      quarterEnd.yr3 = q.cagr3y;
      quarterEnd.yr5 = q.cagr5y;
      quarterEnd.yr10 = q.cagr10y;
      quarterEnd.sinceInception = q.siAnn;
      metrics.returnsBasis += ' + quarter-end NAV row';
    }
  }
  // Russia funds in liquidation: the performance block is gone with the old
  // page, so the finder-verified annualised tenors are the source of record.
  // Cumulative tenors stay null — VanEck never published them.
  if ((ticker === 'RSX' || ticker === 'RSXJ') && (metrics.tr1y === null || metrics.tr1y === undefined) && finder?.monthEndTenors) {
    const t = finder.monthEndTenors;
    metrics.tr1y = t.y1;
    metrics.tr3y = null;
    metrics.tr5y = null;
    metrics.tr10y = null;
    metrics.cagr3y = t.y3;
    metrics.cagr5y = t.y5;
    metrics.cagr10y = t.y10;
    metrics.siAnn = t.life;
    metrics.returnsBasis =
      `official VanEck Investment Finder month-end returns (NAV, as of ${formatVanEckDate(FINDER_MONTH_END_AS_OF)}); fund in liquidation — cumulative tenors not published`;
    const monthEnd = (entry.returns as Record<string, unknown>).monthEnd as Record<string, unknown>;
    monthEnd.yr1 = t.y1;
    monthEnd.yr3 = t.y3;
    monthEnd.yr5 = t.y5;
    monthEnd.yr10 = t.y10;
    monthEnd.sinceInception = t.life;
    if (monthEnd.asOfDate === '—') monthEnd.asOfDate = formatVanEckDate(FINDER_MONTH_END_AS_OF);
  }
  // The fund-page header shows a 30-Day SEC Yield instead of a YTD return for
  // bond funds whose price feed lags (CBON, EMLC, VBNB): backfill YTD from the
  // finder-verified month-end table rather than leaving a hole.
  if ((metrics.ytd === null || metrics.ytd === undefined) && finder?.monthEndYtd !== null && finder?.monthEndYtd !== undefined) {
    metrics.ytd = finder.monthEndYtd;
    const monthEnd = (entry.returns as Record<string, unknown>).monthEnd as Record<string, unknown>;
    monthEnd.ytd = finder.monthEndYtd;
    monthEnd.ytdText = `${finder.monthEndYtd.toFixed(2)}%`;
    if (monthEnd.asOfDate === '—') monthEnd.asOfDate = formatVanEckDate(FINDER_MONTH_END_AS_OF);
    metrics.returnsBasis = `${metrics.returnsBasis || 'official VanEck Average Annual Total Returns (NAV)'} + Investment Finder month-end YTD (NAV)`;
  }
  // 30-Day SEC Yield: the server-rendered fund-page stat wins when present;
  // otherwise the finder-verified value (bond-fund headers often carry it,
  // equity pages never do).
  const pageSecYield = metrics.secYield;
  if ((pageSecYield === null || pageSecYield === undefined) && finder?.secYield !== null && finder?.secYield !== undefined) {
    metrics.secYield = finder.secYield;
    metrics.secYieldText = `${finder.secYield.toFixed(2)}%`;
  }
  const secYieldFromFinder =
    (pageSecYield === null || pageSecYield === undefined) && metrics.secYield !== null && metrics.secYield !== undefined;

  // --- distributions ---------------------------------------------------------
  // VanEck's own Distribution History block (see fetchVanEckDistributions) is
  // the primary source; Yahoo Finance is the fallback when it's unavailable
  // (e.g. the fund page fetch itself failed, so no blockid was ever read).
  let vanEckDistributions: VanEckDistribution[] | null = null;
  if (!config.skipVanEck && !config.offlineSeed && pageSnapshot?.pageId && pageSnapshot?.distributionsBlockId) {
    vanEckDistributions = await fetchVanEckDistributions(ticker, pageSnapshot.pageId, pageSnapshot.distributionsBlockId, config);
  }
  const exDates = vanEckDistributions?.map((d) => d.exDate) ?? null;
  const latestNative = vanEckDistributions && vanEckDistributions.length ? vanEckDistributions[0] : null;
  // One Yahoo chart fetch serves both the distributions fallback and the
  // exchange-name fallback below.
  const yahooChartJson = !config.skipYahoo && !config.offlineSeed ? await fetchYahooChartJson(ticker, config) : null;
  const yahooFallback = !vanEckDistributions && yahooChartJson ? parseYahooDividends(yahooChartJson) : null;
  const latestYahoo = yahooFallback && yahooFallback.length ? yahooFallback[0] : null;
  // Declared cadence first: the fund's own distribution schedule beats any
  // inference from payout gaps (inference only where the finder prints `--`).
  const finderFrequency = finder ? normalizeFinderFrequency(finder.frequency) : 'Unknown';
  const frequencySource = exDates ?? (yahooFallback ? yahooFallback.map((d) => d.date) : null);
  const frequencyLabel =
    finderFrequency !== 'Unknown'
      ? finderFrequency
      : frequencySource && frequencySource.length
        ? inferDistributionFrequency(frequencySource)
        : 'Unknown';
  const payments = paymentsPerYear(frequencyLabel);
  const latestExDate = latestNative?.exDate ?? latestYahoo?.date ?? null;
  const latestAmount = latestNative?.dividend ?? latestYahoo?.amount ?? null;
  const navForYield = entry.navValue ?? entry.closePriceValue;
  // Official finder Distribution Yield first; the indicated yield only where
  // the finder prints `--` AND the latest payout is fresh enough to annualise.
  const officialDistributionYield = finder?.distributionYield ?? null;
  const indicatedAllowed = indicatedYieldAllowed(latestExDate, entry.asOfDate as string | null);
  const indicatedYield = latestAmount !== null && indicatedAllowed ? indicatedDividendYield(latestAmount, payments, navForYield) : null;
  const dividendYield = officialDistributionYield ?? indicatedYield;
  metrics.distributionYield = officialDistributionYield;
  metrics.distributionYieldText = formatPercentText(officialDistributionYield);
  metrics.yield12M = finder?.yield12M ?? null;
  metrics.yield12MText = formatPercentText(finder?.yield12M ?? null);

  // --- exchange --------------------------------------------------------------
  // Ladder: fund page (rarely present) -> Nasdaq symdir -> Yahoo chart meta.
  let exchangeSource = '—';
  if (entry.exchange === '—' || !entry.exchange) {
    const nasdaq = !config.offlineSeed ? await fetchNasdaqExchanges(config) : null;
    const symdirExchange = nasdaq?.get(ticker.toUpperCase()) ?? null;
    const yahooExchange = yahooChartJson ? normalizeYahooExchangeName(parseYahooExchangeName(yahooChartJson)) : null;
    if (symdirExchange) {
      entry.exchange = symdirExchange;
      exchangeSource = 'Nasdaq Trader symbol directory';
    } else if (yahooExchange) {
      entry.exchange = yahooExchange;
      exchangeSource = 'Yahoo Finance chart meta.exchangeName';
    }
  } else {
    exchangeSource = 'official VanEck fund page';
  }
  entry.distributionFrequency = frequencyCode(frequencyLabel);
  entry.distributions = {
    frequency: frequencyLabel,
    exDate: latestExDate ?? '—',
    dividend: latestAmount !== null ? `$${latestAmount.toFixed(4)}` : '—',
  };
  metrics.dividendYield = dividendYield;
  metrics.dividendYieldText = formatPercentText(dividendYield);
  const distributionsSource = vanEckDistributions
    ? 'VanEck Distribution History (official)'
    : yahooFallback
      ? 'Yahoo Finance chart feed (fallback: VanEck distributions unavailable)'
      : '—';
  const distributionsHeaders = ['Ex-Date', 'Payable Date', 'Dividend'];
  const distributionsRows: Record<string, string>[] = vanEckDistributions
    ? vanEckDistributions.map((d) => ({ 'Ex-Date': d.exDate, 'Payable Date': d.payableDate, Dividend: `$${d.dividend.toFixed(4)}` }))
    : yahooFallback
      ? yahooFallback.map((d) => ({ 'Ex-Date': d.date, 'Payable Date': '—', Dividend: `$${d.amount.toFixed(4)}` }))
      : [];

  // --- meta.json -----------------------------------------------------------
  const meta = {
    ...entry,
    categoryPath: `${entry.category} > ${seed.category}`,
    source: {
      ...source,
      holdingsSource: holdingsManifest?.source ?? '—',
      historySource: historyManifest?.source ?? '—',
      exchangeSource,
      finderVerifiedAt: FINDER_READ_AT,
    },
    identifiers: {
      cusip: entry.cusip ?? null,
      isin: entry.isin ?? null,
      figi: 'published per holding, not per fund',
      indexTicker: (entry as Record<string, unknown>).indexTicker ?? null,
      indexName: (entry as Record<string, unknown>).indexName ?? null,
    },
    documents: vaneckFundDocuments(ticker),
    expenseRatio: { display: entry.ter, value: entry.terValue, gross: entry.terGross, grossValue: entry.terGrossValue },
    nav: { display: entry.nav, value: entry.navValue, asOfDate: entry.asOfDate },
    marketPrice: { display: entry.closePrice, value: entry.closePriceValue, asOfDate: entry.asOfDate },
    premiumDiscount: { display: entry.premiumDiscount, value: entry.premiumDiscountValue },
    aum: { display: entry.aum, value: entry.aumValue, asOfDate: entry.netAssetsAsOf, source: VANECK_ETF_GUIDE_URL },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldKind:
        officialDistributionYield !== null && officialDistributionYield !== undefined
          ? `official VanEck Investment Finder Distribution Yield (as of ${formatVanEckDate(FINDER_PRICES_AS_OF)})`
          : indicatedYield !== null
            ? `indicated (latest distribution x payments per year / NAV), from ${distributionsSource}`
            : 'no current yield: VanEck prints `--` and no recent distribution can be annualised',
      indicatedYield,
      indicatedYieldText: formatPercentText(indicatedYield),
      distributionYield: metrics.distributionYield,
      distributionYieldText: metrics.distributionYieldText,
      yield12M: metrics.yield12M,
      yield12MText: metrics.yield12MText,
      distributionRate: null,
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind:
        metrics.secYield === null || metrics.secYield === undefined
          ? 'not published by VanEck for this fund (finder prints `--`)'
          : secYieldFromFinder
            ? `official VanEck Investment Finder 30-Day SEC Yield (as of ${formatVanEckDate(FINDER_PRICES_AS_OF)})`
            : 'official VanEck fund page, server-rendered for this fund',
    },
    returns: {
      derivedFrom: metrics.returnsBasis,
      monthEnd: (entry.returns as Record<string, unknown>).monthEnd,
      quarterEnd: (entry.returns as Record<string, unknown>).quarterEnd,
    },
    distributions: { frequency: frequencyLabel, paymentsPerYear: payments, headers: distributionsHeaders, rows: distributionsRows, source: distributionsSource },
    holdings: holdingsManifest ?? { pages: [], pageSize: config.holdingsPageSize, totalRows: 0, asOfDate: '—', source: '—' },
    history: historyManifest ?? { pages: [], pageSize: config.historyPageSize, totalRows: 0, asOf: '—', source: '—' },
    snapshotReadAt: SNAPSHOT_READ_AT,
  };
  const metaResult = await writeIfChanged(path.join(API_ROOT, 'funds', ticker, 'meta.json'), serialize(meta));
  if (metaResult === 'written') stats.updated += 1;
  else stats.unchanged += 1;

  if (config.storeRawDownloads && holdings) {
    await writeIfChanged(
      path.join(API_ROOT, 'raw', `${ticker}-holdings.json`),
      serialize({ url: source.holdingsDownload, asOfDate: holdings.asOfDate, headers: holdings.headers, rows: holdings.rows }),
    );
  }
  return entry;
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  if (env.ARGS?.includes('--help') || env.ARGS?.includes('-h') || process.argv.slice(2).some((a) => a === '-h' || a === '--help')) {
    console.log(USAGE);
    return;
  }
  const config = readConfig(env);
  outputPrintConfig('VanEck', config);
  const stats: RunStats = { updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  const cursor = config.maxFetches > 0 ? await readCursor() : null;
  const candidates = selectCandidates(VAN_ECK_SEED, config, cursor);

  outputPrintFilter(candidates.length, VAN_ECK_SEED.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, candidates.length);
  if (cursor) console.log(`Resuming after cursor ${cursor}.`);

  const byTicker = new Map<string, CatalogEntry>();
  const queue = candidates.slice();
  const total = candidates.length;
  let processed = 0;
  const workers = Array.from({ length: Math.max(1, config.concurrency) }, async () => {
    for (;;) {
      const seed = queue.shift();
      if (!seed) return;
      const before = await output.before(seed.ticker);
      try {
        const entry = await updateFund(seed, config, stats);
        byTicker.set(seed.ticker, entry);
        processed += 1;
        await output.result(seed.ticker, before);
      } catch (error) {
        processed += 1;
        await output.result(seed.ticker, before, 'failed', errorMessage(error));
        stats.failed += 1;
      }
    }
  });
  await Promise.all(workers);

  // Catalog: previously published entries are preserved so a bounded or failed
  // run never empties the site (P14/13.5).
  const indexFile = path.join(API_ROOT, 'index.json');
  let previous: Record<string, CatalogEntry> = {};
  let previousGeneratedAt = '';
  if (existsSync(indexFile)) {
    try {
      const parsed = JSON.parse(await readFile(indexFile, 'utf8'));
      previousGeneratedAt = String(parsed.generatedAt || '');
      for (const fund of parsed.funds || []) previous[fund.ticker] = fund;
    } catch {
      previous = {};
    }
  }
  for (const seed of VAN_ECK_SEED) {
    if (!previous[seed.ticker]) previous[seed.ticker] = seedCatalogEntry(seed);
  }
  for (const [ticker, entry] of byTicker) previous[ticker] = entry;

  const funds = Object.values(previous).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + Number(fund.holdings || 0), 0),
    history: funds.reduce((sum, fund) => sum + Number(fund.history || 0), 0),
  };
  const index = {
    // Filled in below: the stamp only moves when the feed content actually did,
    // so a rerun against unchanged upstream data produces an empty git diff.
    generatedAt: previousGeneratedAt || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Van Eck Associates Corporation (VanEck US ETFs)',
      market: 'us',
      site: VANECK_SITE,
      catalog: VANECK_ETF_GUIDE_URL,
      catalogNote: `Official VanEck ETF Guide (AUM as of ${AUM_AS_OF_GUIDE}); the Investment Finder tables are client-rendered and cannot be read without a browser.`,
      fundPages: `${VANECK_SITE}/us/en/investments/<slug>/`,
      holdings: `${VANECK_SITE}/us/en/investments/<slug>/downloads/holdings/`,
      history: `${VANECK_SITE}/us/en/investments/<slug>/downloads/fundhistoprices/`,
      nportRegistrant: `SEC EDGAR Form N-PORT-P, VanEck ETF Trust CIK ${VANECK_ETF_TRUST_CIK}`,
      distributions: 'VanEck Distribution History block, Yahoo Finance public chart API as fallback',
      finderTabs:
        `Investment Finder Prices & Yields (${FINDER_PRICES_AS_OF}) and month-end Performance (${FINDER_MONTH_END_AS_OF}) tabs, verified ${FINDER_READ_AT} (see scripts/vaneck-finder.ts)`,
      exchange: 'Nasdaq Trader symbol directory, Yahoo Finance chart meta as fallback',
    },
    counts,
    funds,
  };
  const indexResult = await writeIfChanged(indexFile, serialize(index));
  if (indexResult === 'written' && previousGeneratedAt) {
    // The bytes moved, so the feed genuinely changed: advance the stamp. When
    // nothing moved we kept the previous one, which is what makes a no-op run
    // produce an empty `git diff`.
    await writeFile(indexFile, serialize({ ...index, generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }), 'utf8');
  }

  if (config.maxFetches > 0 && candidates.length) {
    await writeIfChanged(
      path.join(API_ROOT, 'update-state.json'),
      serialize({ cursor: candidates[candidates.length - 1].ticker, savedAt: new Date().toISOString() }),
    );
  } else if (config.maxFetches === 0 && existsSync(path.join(API_ROOT, 'update-state.json'))) {
    await rm(path.join(API_ROOT, 'update-state.json'));
  }

  console.log(
    `Done. updated=${stats.updated} unchanged=${stats.unchanged} failed=${stats.failed} · funds=${counts.funds} holdings=${counts.holdings} history=${counts.history}`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
