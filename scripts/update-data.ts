#!/usr/bin/env bun
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
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
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
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
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
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
 *        (VANECK_FINDER in scripts/update-data.ts)                 SEC/distribution/12M
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
 * snapshot in `data/vaneck-verified.ts` instead of failing, so the feed can
 * always be regenerated byte-identically.
 */
import { mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EQUITY_HOLDINGS_SNAPSHOTS,
  FUND_PAGE_SNAPSHOTS,
  HISTORY_SNAPSHOTS,
  SNAPSHOT_READ_AT,
} from '../data/vaneck-verified';

// ---------------------------------------------------------------------------
// VanEck fund universe seed (inlined from the former scripts/vaneck-funds.ts)
// ---------------------------------------------------------------------------

/**
 * VanEck fund universe seed.
 *
 * Same role as `scripts/fidelity-funds.ts` in daggerok/Fidelity and the
 * `FUNDS_SEED` table in daggerok/Vanguard: a checked-in, reviewable list of the
 * funds the updater walks, so a refresh never silently changes the universe and
 * so the provider's own category vocabulary is preserved verbatim.
 *
 * Source of the catalog rows: the official **VanEck ETF Guide**
 * <https://www.vaneck.com/us/en/vaneck-etfs-fees.pdf>, which publishes one row
 * per ETF with the fund name, ticker, gross/net expense ratio and AUM under the
 * provider's own asset-class heading. That document is the only VanEck catalog
 * artefact that is machine-readable without a JavaScript runtime — the
 * Investment Finder tabs (`/us/en/etf-mutual-fund-finder/`) render their tables
 * client-side and answer "No funds match the current filter selection" to a
 * plain GET.
 *
 * Verified live on 2026-09-19 against that PDF:
 *   - the guide lists 88 ETFs; the Investment Finder's own counter reads
 *     "Showing 91 of 120 total funds | as of 09/18/26" for the ETF filter, so
 *     three ETFs are on the site but not yet in the guide. The updater logs the
 *     difference instead of inventing rows for it (see README "Known value
 *     limitations").
 *   - every VanEck ETF ticker in the guide is 3 or 4 characters long, which is
 *     what the pinned Ticker column width is sized from.
 *
 * `aumAsOfGuide` is the guide's own as-of date and is deliberately NOT the same
 * date as the live fund-page total net assets; both are recorded so neither is
 * mistaken for the other.
 */

/** As-of date printed by the VanEck ETF Guide for its AUM column. */
export const AUM_AS_OF_GUIDE = '06/30/2026';

/** Provider asset-class headings, in the guide's own order. */
export const VAN_ECK_CATEGORIES = [
  'Equity Thematic',
  'U.S. Equity',
  'TruSectors',
  'Moat Investing',
  'Natural Resources',
  'Country/Regional',
  'Corporate Bond',
  'International Bond',
  'Equity Income',
  'Municipal Bond',
  'Floating Rate',
  'Commodity',
] as const;

/** Top-level tab label the catalog UI groups by (provider vocabulary). */
export const CATEGORY_GROUP: Record<string, string> = {
  'Equity Thematic': 'Equity',
  'U.S. Equity': 'Equity',
  TruSectors: 'Equity',
  'Moat Investing': 'Equity',
  'Natural Resources': 'Equity',
  'Country/Regional': 'Equity',
  'Corporate Bond': 'Income',
  'International Bond': 'Income',
  'Equity Income': 'Income',
  'Municipal Bond': 'Income',
  'Floating Rate': 'Income',
  Commodity: 'Real Assets | Commodities',
};

export type VanEckSeedFund = {
  ticker: string;
  /** Fund name exactly as the VanEck ETF Guide prints it. */
  name: string;
  /** Provider asset-class heading from the guide. */
  category: string;
  /** Gross expense ratio in percent, or null when the guide prints none. */
  terGross: number | null;
  /** Net expense ratio in percent, or null when the guide prints none. */
  terNet: number | null;
  /** AUM in $ millions from the guide, or null when it prints "--". */
  aumMillions: number | null;
};

type SeedTuple = [ticker: string, name: string, category: string, gross: number | null, net: number | null, aumM: number | null];

/**
 * One tuple per guide row: ticker, name, guide heading, gross %, net %, AUM $M.
 * `null` means the guide printed no value for that cell (a "--" AUM cell, for
 * example); the updater keeps it null and the UI renders an em dash.
 */
const SEED_ROWS: SeedTuple[] = [
  // --- Equity Thematic -----------------------------------------------------
  ['GPZ', 'Alternative Asset Manager ETF', 'Equity Thematic', 0.4, 0.4, 224],
  ['VAVX', 'Avalanche ETF', 'Equity Thematic', 0.2, 0.2, 11],
  ['BBH', 'Biotech ETF', 'Equity Thematic', 0.35, 0.35, 396],
  ['HODL', 'Bitcoin ETF', 'Equity Thematic', 0.2, 0.2, 952],
  ['VBNB', 'BNB ETF', 'Equity Thematic', 0.39, 0.39, 2],
  ['SMHC', 'China Semiconductor ETF', 'Equity Thematic', 0.65, 0.65, 7],
  ['RACK', 'Data Center Supply Chain ETF', 'Equity Thematic', 0.5, 0.5, 31],
  ['GENZ', 'Digital Native Economy ETF', 'Equity Thematic', 0.51, 0.51, 18],
  ['DAPP', 'Digital Transformation ETF', 'Equity Thematic', 0.52, 0.52, 346],
  ['ETHV', 'Ethereum ETF', 'Equity Thematic', 0.2, 0.2, 77],
  ['EVX', 'Environmental Services ETF', 'Equity Thematic', 0.62, 0.55, 101],
  ['SMHX', 'Fabless Semiconductor ETF', 'Equity Thematic', 0.35, 0.35, 297],
  ['NODE', 'Onchain Economy ETF', 'Equity Thematic', 0.69, 0.67, 73],
  ['PPH', 'Pharmaceutical ETF', 'Equity Thematic', 0.36, 0.36, 879],
  ['RTH', 'Retail ETF', 'Equity Thematic', 0.35, 0.35, 248],
  ['IBOT', 'Robotics ETF', 'Equity Thematic', 0.47, 0.47, 98],
  ['SMH', 'Semiconductor ETF', 'Equity Thematic', 0.35, 0.35, 77198],
  ['VSOL', 'Solana ETF', 'Equity Thematic', 0.3, 0.3, 14],
  ['WARP', 'Space ETF', 'Equity Thematic', 0.5, 0.5, 58],
  ['ESPO', 'Video Gaming and eSports ETF', 'Equity Thematic', 0.55, 0.55, 239],

  // --- U.S. Equity ---------------------------------------------------------
  ['LFEQ', 'Long/Flat Trend ETF', 'U.S. Equity', 0.83, 0.58, 28],
  ['BUZZ', 'Social Sentiment ETF', 'U.S. Equity', 0.76, 0.76, 105],
  ['JULV', 'U.S. Equity Buffer ETF - July', 'U.S. Equity', 0.5, 0.5, 66],

  // --- TruSectors ----------------------------------------------------------
  ['TRUC', 'Communication Services TruSector ETF', 'TruSectors', 0.14, 0.14, 47],
  ['TRUD', 'Consumer Discretionary TruSector ETF', 'TruSectors', 0.16, 0.16, 33],
  ['TRUO', 'Consumer Staples TruSector ETF', 'TruSectors', 0.14, 0.14, null],
  ['TRUN', 'Energy TruSector ETF', 'TruSectors', 0.16, 0.16, null],
  ['TRUF', 'Financials TruSector ETF', 'TruSectors', 0.1, 0.1, 1],
  ['TRUH', 'Healthcare TruSector ETF', 'TruSectors', 0.1, 0.1, 1],
  ['TRUI', 'Industrials TruSector ETF', 'TruSectors', 0.1, 0.1, null],
  ['TRUM', 'Materials TruSector ETF', 'TruSectors', 0.15, 0.15, null],
  ['TRUR', 'Real Estate TruSector ETF', 'TruSectors', 0.17, 0.17, null],
  ['TRUT', 'Technology TruSector ETF', 'TruSectors', 0.14, 0.14, 163],
  ['TRUU', 'Utilities TruSector ETF', 'TruSectors', 0.1, 0.1, null],

  // --- Moat Investing ------------------------------------------------------
  ['MOTG', 'Morningstar Global Wide Moat ETF', 'Moat Investing', 1.14, 0.52, 17],
  ['MOTI', 'Morningstar International Moat ETF', 'Moat Investing', 0.63, 0.58, 70],
  ['SMOT', 'Morningstar SMID Moat ETF', 'Moat Investing', 0.49, 0.49, 334],
  ['MOAT', 'Morningstar Wide Moat ETF', 'Moat Investing', 0.46, 0.46, 11625],
  ['MVAL', 'Morningstar Wide Moat Value ETF', 'Moat Investing', 2.09, 0.5, 2],

  // --- Natural Resources ---------------------------------------------------
  ['MOO', 'Agribusiness ETF', 'Natural Resources', 0.56, 0.56, 944],
  ['EMET', 'Copper and Electrification Metals ETF', 'Natural Resources', 0.62, 0.62, 34],
  ['GDX', 'Gold Miners ETF', 'Natural Resources', 0.51, 0.51, 22753],
  ['GDXJ', 'Junior Gold Miners ETF', 'Natural Resources', 0.52, 0.52, 7078],
  ['SMOG', 'Low Carbon Energy ETF', 'Natural Resources', 0.64, 0.64, 144],
  ['HAP', 'Natural Resources ETF', 'Natural Resources', 0.41, 0.41, 299],
  ['CRAK', 'Oil Refiners ETF', 'Natural Resources', 0.94, 0.61, 146],
  ['OIH', 'Oil Services ETF', 'Natural Resources', 0.35, 0.35, 1992],
  ['REMX', 'Rare Earth and Strategic Metals ETF', 'Natural Resources', 0.53, 0.53, 2695],
  ['RAAX', 'Real Assets ETF', 'Natural Resources', 0.89, 0.69, 1054],
  ['SLX', 'Steel ETF', 'Natural Resources', 0.64, 0.55, 170],
  ['NLR', 'Uranium and Nuclear Energy ETF', 'Natural Resources', 0.52, 0.52, 4214],

  // --- Country/Regional ----------------------------------------------------
  ['AFK', 'Africa Index ETF', 'Country/Regional', 0.76, 0.76, 100],
  ['BRF', 'Brazil Small-Cap ETF', 'Country/Regional', 1.17, 0.6, 22],
  ['CNXT', 'ChiNext Innovators ETF', 'Country/Regional', 1.0, 0.65, 141],
  ['DGIN', 'Digital India ETF', 'Country/Regional', 0.7, 0.7, 15],
  ['GLIN', 'India Growth Leaders ETF', 'Country/Regional', 0.8, 0.72, 99],
  ['INDZ', 'India Select ETF', 'Country/Regional', 0.75, 0.75, 3],
  ['IDX', 'Indonesia Index ETF', 'Country/Regional', 0.86, 0.57, 27],
  ['ISRA', 'Israel ETF', 'Country/Regional', 0.64, 0.59, 153],
  ['VEFA', 'MSCI EAFE Analyst Sentiment ETF', 'Country/Regional', 0.3, 0.3, 4],
  ['VNM', 'Vietnam ETF', 'Country/Regional', 0.66, 0.66, 565],
  // Not in the 06/30/2026 ETF Guide (in liquidation since 2022, kept in the
  // Investment Finder): seed TER/AUM are null here; the live fund page
  // (NAV $0.34/$0.39, net assets $32.88M/$348.59K as of 09/18/2026) and the
  // finder-verified table overwrite them on every run.
  ['RSX', 'Russia ETF', 'Country/Regional', 1.33, 0.83, null],
  ['RSXJ', 'Russia Small-Cap ETF', 'Country/Regional', 9.5, 0.84, null],
  // Launched 09/09/2026, after the guide's as-of date; same live-source rule.
  ['VEEM', 'MSCI EM Analyst Sentiment ETF', 'Country/Regional', 0.3, 0.3, null],

  // --- Income / Corporate Bond --------------------------------------------
  ['ANGL', 'Fallen Angel High Yield Bond ETF', 'Corporate Bond', 0.25, 0.25, 3118],
  ['MBBB', "Moody's Analyt. BBB Corp Bond ETF", 'Corporate Bond', 0.25, 0.25, 5],
  ['MIG', "Moody's Analyt. IG Corp Bond ETF", 'Corporate Bond', 0.2, 0.2, 19],

  // --- Income / International Bond ----------------------------------------
  ['CBON', 'China Bond ETF', 'International Bond', 0.91, 0.5, 24],
  ['EMBX', 'EM Bond ETF', 'International Bond', 0.76, 0.76, 246],
  ['HYEM', 'EM High Yield Bond ETF', 'International Bond', 0.4, 0.4, 534],
  ['GRNB', 'Green Bond ETF', 'International Bond', 0.2, 0.2, 183],
  ['IHY', 'International High Yield Bond ETF', 'International Bond', 0.4, 0.4, 43],
  ['EMLC', 'JPM EM Local Curr. Bond ETF', 'International Bond', 0.31, 0.3, 4872],

  // --- Income / Equity Income ---------------------------------------------
  ['DURA', 'Durable High Dividend ETF', 'Equity Income', 0.3, 0.3, 37],
  ['EINC', 'Energy Income ETF', 'Equity Income', 0.46, 0.46, 109],
  ['MORT', 'Mortgage REIT Income ETF', 'Equity Income', 0.43, 0.43, 400],
  ['DESK', 'Office and Commercial REIT ETF', 'Equity Income', 0.51, 0.51, 3],
  ['PFXF', 'Prefer Securities exFinancials ETF', 'Equity Income', 0.4, 0.4, 2629],

  // --- Income / Municipal Bond --------------------------------------------
  ['XMPT', 'CEF Municipal Income ETF', 'Municipal Bond', 1.97, 1.97, 221],
  ['HYD', 'High Yield Muni ETF', 'Municipal Bond', 0.32, 0.32, 4522],
  ['ITM', 'Intermediate Muni ETF', 'Municipal Bond', 0.18, 0.18, 2190],
  ['MLN', 'Long Muni ETF', 'Municipal Bond', 0.24, 0.24, 700],
  ['SHYD', 'Short High Yield Muni ETF', 'Municipal Bond', 0.32, 0.32, 451],
  ['SMB', 'Short Muni ETF', 'Municipal Bond', 0.07, 0.07, 314],

  // --- Income / Floating Rate ---------------------------------------------
  ['CLOB', 'AA-BB CLO ETF', 'Floating Rate', 0.45, 0.45, 177],
  ['BIZD', 'BDC Income ETF', 'Floating Rate', 9.69, 9.69, 1632],
  ['CLOI', 'CLO ETF', 'Floating Rate', 0.36, 0.36, 1424],
  ['FLTR', 'IG Floating Rate ETF', 'Floating Rate', 0.14, 0.14, 2831],

  // --- Commodity -----------------------------------------------------------
  ['CMCI', 'CMCI Commodity Strategy ETF', 'Commodity', 4.95, 0.67, 3],
  ['PIT', 'Commodity Strategy ETF', 'Commodity', 0.55, 0.55, 260],
  ['OUNZ', 'Merk Gold ETF', 'Commodity', 0.25, 0.25, 2500],
];

export const VAN_ECK_SEED: VanEckSeedFund[] = SEED_ROWS.map(([ticker, name, category, terGross, terNet, aumMillions]) => ({
  ticker,
  name,
  category,
  terGross,
  terNet,
  aumMillions,
}));

/** Longest ticker in the universe — drives the pinned Ticker column width. */
export function maxTickerLength(funds: VanEckSeedFund[] = VAN_ECK_SEED): number {
  return funds.reduce((max, fund) => Math.max(max, fund.ticker.length), 0);
}

export function fundByTicker(ticker: string): VanEckSeedFund | undefined {
  const wanted = String(ticker || '').trim().toUpperCase();
  return VAN_ECK_SEED.find((fund) => fund.ticker === wanted);
}

// ---------------------------------------------------------------------------
// Canonical VanEck fund-page slugs (inlined from the former scripts/vaneck-slugs.ts)
// ---------------------------------------------------------------------------

/**
 * Canonical VanEck fund-page slugs.
 *
 * VanEck's `etf-<TICKER>` redirect is unreliable:
 *   - `etf-einc` → `dynamic-high-income-etf-inc` (wrong fund, 404)
 *   - `etf-afk/downloads/holdings/` → overview page, not the holdings table
 *   - Bun's fetch then loops `?redirectVE=generic` → too-many-redirects
 *
 * This table is the source of truth, scraped from the Investment Finder
 * (`/us/en/etf-mutual-fund-finder/etfs/?InvType=etf&tab=ov`, 91 ETFs, 2026-09-19)
 * and verified via `fetch_page` for every ticker in the 88-fund seed.
 * Update it when VanEck adds/renames an ETF; `vaneckFundPageUrl()` falls back to
 * `etf-<ticker>` only for an unknown ticker so a missing entry is never silent.
 */
export const VANECK_SLUGS: Record<string, string> = {
  // Equity Thematic (20)
  GPZ: 'alternative-asset-manager-etf-gpz',
  VAVX: 'avalanche-etf-vavx',
  BBH: 'biotech-etf-bbh',
  HODL: 'bitcoin-etf-hodl',
  VBNB: 'bnb-etf-vbnb',
  SMHC: 'china-semiconductor-etf-smhc',
  RACK: 'data-center-supply-chain-etf-rack',
  GENZ: 'digital-native-economy-etf-genz',
  DAPP: 'digital-transformation-etf-dapp',
  ETHV: 'ethereum-etf-ethv',
  EVX: 'enviromental-services-etf-evx',
  SMHX: 'fabless-semiconductor-etf-smhx',
  NODE: 'onchain-economy-etf-node',
  PPH: 'pharmaceutical-etf-pph',
  RTH: 'retail-etf-rth',
  IBOT: 'robotics-etf-ibot',
  SMH: 'semiconductor-etf-smh',
  VSOL: 'solana-etf-vsol',
  WARP: 'space-etf-warp',
  ESPO: 'video-gaming-esports-etf-espo',

  // U.S. Equity (3)
  LFEQ: 'long-flat-trend-etf-lfeq',
  BUZZ: 'social-sentiment-etf-buzz',
  JULV: 'us-equity-buffer-july-etf-julv',

  // TruSectors (11)
  TRUC: 'communication-services-trusector-etf-truc',
  TRUD: 'consumer-discretionary-trusector-etf-trud',
  TRUO: 'consumer-staples-trusector-etf-truo',
  TRUN: 'energy-trusector-etf-trun',
  TRUF: 'financials-trusector-etf-truf',
  TRUH: 'healthcare-trusector-etf-truh',
  TRUI: 'industrials-trusector-etf-trui',
  TRUM: 'materials-trusector-etf-trum',
  TRUR: 'real-estate-trusector-etf-trur',
  TRUT: 'technology-trusector-etf-trut',
  TRUU: 'utilities-trusector-etf-truu',

  // Moat Investing (5)
  MOTG: 'morningstar-global-wide-moat-etf-motg',
  MOTI: 'morningstar-international-moat-etf-moti',
  SMOT: 'morningstar-smid-moat-etf-smot',
  MOAT: 'morningstar-wide-moat-etf-moat',
  MVAL: 'morningstar-wide-moat-value-etf-mval',

  // Natural Resources (12)
  MOO: 'agribusiness-etf-moo',
  EMET: 'copper-and-electrification-etf-emet',
  GDX: 'gold-miners-etf-gdx',
  GDXJ: 'junior-gold-miners-etf-gdxj',
  SMOG: 'low-carbon-energy-etf-smog',
  HAP: 'natural-resources-etf-hap',
  CRAK: 'oil-refiners-etf-crak',
  OIH: 'oil-services-etf-oih',
  REMX: 'rare-earth-strategic-metals-etf-remx',
  RAAX: 'real-assets-etf-raax',
  SLX: 'steel-etf-slx',
  NLR: 'uranium-nuclear-energy-etf-nlr',

  // Country/Regional (10)
  AFK: 'africa-index-etf-afk',
  BRF: 'brazil-small-cap-etf-brf',
  CNXT: 'chinext-innovators-etf-cnxt',
  DGIN: 'digital-india-etf-dgin',
  GLIN: 'india-growth-leaders-etf-glin',
  INDZ: 'india-select-etf-indz',
  IDX: 'indonesia-index-etf-idx',
  ISRA: 'israel-etf-isra',
  VEFA: 'msci-eafe-analyst-sentiment-etf-vefa',
  VNM: 'vietnam-etf-vnm',
  RSX: 'russia-etf-rsx',
  RSXJ: 'russia-small-cap-etf-rsxj',
  VEEM: 'msci-em-analyst-sentiment-etf-veem',

  // Corporate Bond (3)
  ANGL: 'angel-high-yield-bond-etf-angl',
  MBBB: 'moodys-analytics-bbb-corporate-bond-etf-mbbb',
  MIG: 'moodys-analytics-ig-corporate-bond-etf-mig',

  // International Bond (6)
  CBON: 'chinaamc-china-bond-etf-cbon',
  EMBX: 'emerging-markets-bond-etf-embx',
  HYEM: 'emerging-markets-high-yield-bond-etf-hyem',
  GRNB: 'green-bond-etf-grnb',
  IHY: 'international-high-yield-bond-etf-ihy',
  EMLC: 'jp-morgan-em-local-currency-bond-etf-emlc',

  // Equity Income (5)
  DURA: 'durable-high-dividend-etf-dura',
  EINC: 'energy-income-etf-einc',
  MORT: 'mortgage-reit-income-mort',
  DESK: 'office-and-commercial-reit-desk',
  PFXF: 'preferred-securities-ex-financials-etf-pfxf',

  // Municipal Bond (6)
  XMPT: 'cef-municipal-income-etf-xmpt',
  HYD: 'high-yield-muni-etf-hyd',
  ITM: 'intermediate-muni-etf-itm',
  MLN: 'long-muni-etf-mln',
  SHYD: 'short-high-yield-muni-etf-shyd',
  SMB: 'short-muni-etf-smb',

  // Floating Rate (4)
  CLOB: 'aa-bb-clo-etf-clob',
  BIZD: 'bdc-income-etf-bizd',
  CLOI: 'clo-etf-cloi',
  FLTR: 'ig-floating-rate-etf-fltr',

  // Commodity (3)
  CMCI: 'cmci-commodity-strategy-etf-cmci',
  PIT: 'commodity-strategy-etf-pit',
  OUNZ: 'merk-gold-trust-etf-ounz',
};

export function slugForTicker(ticker: string): string | undefined {
  return VANECK_SLUGS[ticker.toUpperCase()];
}

// ---------------------------------------------------------------------------
// VanEck Investment Finder verified table (inlined from the former scripts/vaneck-finder.ts)
// ---------------------------------------------------------------------------

/**
 * VanEck Investment Finder verified table.
 *
 * The five finder tabs
 * (`/us/en/etf-mutual-fund-finder/etfs/?InvType=etf&tab=<ov|month-end-returns|price-returns|fe|lit>`)
 * render their tables client-side, so the static updater cannot fetch them
 * with a plain GET. This file is the checked-in, reviewable transcription of
 * the two tabs the feed needs, read on 2026-09-20 (prices/yields as of
 * 09/18/2026, month-end returns as of 08/31/2026):
 *
 *   tab=price-returns .... Distribution Frequency, 30-Day SEC Yield,
 *                          Distribution Yield, 12 Month Yield (all 91 ETFs)
 *   tab=month-end-returns  YTD (NAV) fallback for funds whose page header
 *                          shows the 30-day SEC yield instead of a YTD figure
 *                          (CBON, EMLC), or whose header shows neither
 *                          (VBNB), plus the full month-end tenor row for the
 *                          two Russia funds, whose performance block is a
 *                          liquidation stub.
 *
 * Nothing here is estimated. `--` on vaneck.com is stored as null. Two
 * VanEck site errors are deliberately NOT transcribed:
 *   - EMBX 12 Month Yield prints as `-777.30%`, which is arithmetically
 *     impossible for a yield (a yield cannot be negative at all) — stored
 *     as null (see `EMBX` below).
 *   - RSX/RSXJ month-end tenors (e.g. RSX 3Y `119.73`, RSXJ 1Y `213.06`)
 *     are transcribed verbatim but flagged `liquidationStub: true`; both
 *     funds are in court-approved liquidation since 2022 and their return
 *     cells are stub artefacts, not spendable performance.
 *
 * Merge precedence in `scripts/update-data.ts`:
 *   frequency ......... finder (official declared cadence) first, inferred
 *                       ex-date cadence only when the finder prints `--`.
 *   secYield .......... finder (published for every distributing fund,
 *                       negatives included) first, fund-page header second.
 *   dividendYield ..... finder Distribution Yield first, indicated
 *                       (latest distribution x payments / NAV) second.
 *   ytd ............... fund-page header first, finder month-end YTD second.
 *   RSX/RSXJ tenors ... finder month-end row when the performance block is
 *                       absent (the updater never derives cumulative tenors
 *                       from these stub annualised figures).
 */

export const FINDER_READ_AT = '2026-09-20T00:00:00.000Z';
/** As-of date printed by the Prices & Yields tab. */
export const FINDER_PRICES_AS_OF = '09/18/2026';
/** As-of date printed by the month-end Performance tab. */
export const FINDER_MONTH_END_AS_OF = '08/31/2026';

export type FinderMonthEndTenors = {
  ytd: number | null;
  y1: number | null;
  y3: number | null;
  y5: number | null;
  y10: number | null;
  life: number | null;
};

export type FinderFund = {
  /** Distribution Frequency exactly as the Prices & Yields tab prints it. */
  frequency: string;
  /** 30-Day SEC Yield in percent, null when the tab prints `--`. */
  secYield: number | null;
  /** Distribution Yield in percent, null when the tab prints `--`. */
  distributionYield: number | null;
  /** 12 Month Yield in percent, null when the tab prints `--`. */
  yield12M: number | null;
  /** Month-end YTD (NAV) fallback, only where the page header lacks a YTD. */
  monthEndYtd?: number | null;
  /** Full month-end tenor row (NAV), only for the liquidation-stub funds. */
  monthEndTenors?: FinderMonthEndTenors;
  /** True when the month-end tenors are liquidation stub artefacts. */
  liquidationStub?: boolean;
};

type FinderTuple = [
  ticker: string,
  frequency: string,
  secYield: number | null,
  distributionYield: number | null,
  yield12M: number | null,
  monthEndYtd?: number | null,
];

/**
 * One tuple per finder row: ticker, frequency, SEC %, distribution %,
 * 12M %, optional month-end YTD fallback.
 */
const FINDER_ROWS: FinderTuple[] = [
  ['AFK', 'Annual', 1.68, 0.95, 1.27],
  ['ANGL', 'Monthly', 6.73, 6.7, 6.43],
  ['BBH', 'Annual', 0.34, 0.41, 0.7],
  ['BIZD', 'Quarterly', 9.2, 7.31, 10.05],
  ['BRF', 'Annual', 5.23, 5.45, 5.51],
  ['BUZZ', 'Annual', -0.46, null, null],
  ['CBON', 'Monthly', 1.04, 1.33, 1.62, 5.43],
  ['CLOB', 'Monthly', 5.72, 5.94, 6.25],
  ['CLOI', 'Monthly', 4.98, 5.1, 5.29],
  ['CMCI', 'Annual', 2.59, 7.49, 12.32],
  ['CNXT', 'Annual', -0.04, 0.16, 0.21],
  ['CRAK', 'Annual', 1.18, 1.16, 3.58],
  ['DAPP', 'Annual', -0.41, null, null],
  ['DESK', 'Quarterly', 4.16, 3.8, 4.78],
  ['DGIN', 'Annual', -0.27, 2.12, 1.62],
  ['DURA', 'Quarterly', 2.7, 2.77, 3.99],
  ['EINC', 'Quarterly', 3.49, 6.76, 5.78],
  // The site prints `-777.30%` for the 12M cell — impossible for a yield,
  // so it is stored as null rather than transcribed (see file header).
  ['EMBX', 'Monthly', 5.98, 6.24, null],
  ['EMET', 'Annual', 0.66, 1.62, 2.67],
  ['EMLC', 'Monthly', 6.33, 6.21, 6.27, 2.83],
  ['ESPO', 'Annual', 0.88, 1.33, 0.98],
  ['ETHV', '--', null, null, null],
  ['EVX', 'Annual', 0.56, 0.18, 0.18],
  ['FLTR', 'Monthly', 4.21, 4.26, 4.6],
  ['GDX', 'Annual', 0.41, 0.66, 0.97],
  ['GDXJ', 'Annual', 0.26, 2.13, 3.12],
  ['GENZ', 'Annual', null, 3.63, 2.72],
  ['GLIN', 'Annual', 0.18, 0.86, 0.81],
  ['GPZ', 'Annual', 2.58, 1.0, 0.61],
  ['GRNB', 'Monthly', 5.2, 4.63, 4.3],
  ['HAP', 'Annual', 1.64, 1.79, 3.07],
  ['HODL', '--', null, null, null],
  ['HYD', 'Monthly', 4.69, 4.52, 4.3],
  ['HYEM', 'Monthly', 7.12, 7.03, 6.91],
  ['IBOT', 'Annual', 0.63, 0.32, 0.48],
  ['IDX', 'Annual', 3.41, 3.03, 1.47],
  ['IHY', 'Monthly', 5.99, 5.57, 5.7],
  ['INDZ', 'Annual', -0.18, null, null],
  ['ISRA', 'Annual', 1.07, 1.29, 1.89],
  ['ITM', 'Monthly', 3.73, 3.2, 2.92],
  ['JULV', 'Annual', null, null, null],
  ['LFEQ', 'Annual', 0.5, 0.81, 1.04],
  ['MBBB', 'Monthly', 5.55, 5.24, 4.87],
  ['MIG', 'Monthly', 5.4, 4.71, 4.47],
  ['MLN', 'Monthly', 4.54, 4.1, 3.77],
  ['MOAT', 'Annual', 1.0, 1.31, 1.46],
  ['MOO', 'Annual', 1.44, 2.12, 2.82],
  ['MORT', 'Quarterly', 14.6, 18.84, 12.69],
  ['MOTG', 'Annual', 1.41, 17.62, 15.21],
  ['MOTI', 'Annual', 2.07, 3.38, 3.01],
  ['MVAL', 'Annual', 1.88, 1.71, 1.87],
  ['NLR', 'Annual', 0.5, 2.92, 2.09],
  ['NODE', 'Annual', -0.44, 0.92, 1.16],
  ['OIH', 'Annual', 1.22, 1.22, 2.66],
  ['OUNZ', '--', null, null, null],
  ['PFXF', 'Monthly', 6.37, 4.16, 6.26],
  ['PIT', 'Annual', 2.03, 5.63, 13.63],
  ['PPH', 'Quarterly', 1.87, 2.25, 2.65],
  ['RAAX', 'Annual', 1.98, 1.98, 2.87],
  ['RACK', 'Annual', 0.13, null, null],
  ['REMX', 'Annual', 0.51, 1.89, 1.92],
  ['RSX', 'Annual', null, null, 3.53],
  ['RSXJ', 'Annual', null, null, 213.11],
  ['RTH', 'Annual', 0.75, 0.96, 0.96],
  ['SHYD', 'Monthly', 3.96, 3.67, 3.57],
  ['SLX', 'Annual', 2.54, 1.24, 2.25],
  ['SMB', 'Monthly', 3.04, 2.91, 2.75],
  ['SMH', 'Annual', 0.17, 0.19, 0.55],
  ['SMHC', 'Annual', -0.42, null, null],
  ['SMHX', 'Annual', -0.03, 0.02, 0.04],
  ['SMOG', 'Annual', 0.59, 1.49, 1.7],
  ['SMOT', 'Annual', 1.12, 1.29, 1.42],
  ['TRUC', 'Quarterly', 0.86, 0.9, null],
  ['TRUD', 'Quarterly', 0.51, 0.58, 0.48],
  ['TRUF', 'Quarterly', 1.35, 1.46, null],
  ['TRUH', 'Quarterly', 1.47, 1.15, null],
  ['TRUI', 'Quarterly', 1.05, null, null],
  ['TRUM', 'Quarterly', 1.51, null, null],
  ['TRUN', 'Quarterly', 2.49, null, null],
  ['TRUO', 'Quarterly', 2.34, null, null],
  ['TRUR', 'Quarterly', 3.18, null, null],
  ['TRUT', 'Quarterly', 0.33, 0.41, 0.45],
  ['TRUU', 'Quarterly', 2.9, null, null],
  ['VAVX', 'Other', 3.96, 0.98, null],
  ['VBNB', '--', -0.37, null, null, 7.59],
  ['VEEM', 'Semi-Annual', null, null, null],
  ['VEFA', 'Semi-Annual', 1.81, 0.76, null],
  ['VNM', 'Annual', 1.29, 0.21, 0.2],
  ['VSOL', 'Other', 3.59, null, null],
  ['WARP', 'Annual', -0.06, null, null],
  ['XMPT', 'Monthly', 6.34, 6.32, 5.55],
];

function buildFinderTable(): Record<string, FinderFund> {
  const table: Record<string, FinderFund> = {};
  for (const [ticker, frequency, secYield, distributionYield, yield12M, monthEndYtd] of FINDER_ROWS) {
    table[ticker] = {
      frequency,
      secYield,
      distributionYield,
      yield12M,
      ...(monthEndYtd === undefined ? {} : { monthEndYtd }),
    };
  }
  // Month-end tenor rows (NAV, as of 08/31/2026) for the two liquidation
  // funds, verbatim from tab=month-end-returns. The 3Y/1Y cells are stub
  // artefacts of frozen post-sanction NAVs, never derived from.
  table['RSX'].monthEndTenors = { ytd: 2.05, y1: 3.04, y3: 119.73, y5: -21.91, y10: -5.47, life: -5.73 };
  table['RSX'].liquidationStub = true;
  table['RSXJ'].monthEndTenors = { ytd: 2.24, y1: 213.06, y3: 181.4, y5: -22.25, y10: -7.78, life: -10.15 };
  table['RSXJ'].liquidationStub = true;
  return table;
}

export const VANECK_FINDER: Record<string, FinderFund> = buildFinderTable();

export function finderForTicker(ticker: string): FinderFund | undefined {
  return VANECK_FINDER[String(ticker || '').trim().toUpperCase()];
}

/**
 * Normalises the finder's frequency vocabulary onto the feed's labels.
 * The finder prints `Annual`; the feed (and `inferDistributionFrequency`)
 * uses `Annually`. `--` means the fund makes no distributions.
 */
export function normalizeFinderFrequency(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '--' || text === '—') return 'Unknown';
  const lower = text.toLowerCase();
  if (lower === 'annual') return 'Annually';
  if (lower === 'semi-annual' || lower === 'semiannual') return 'Semiannually';
  if (lower === 'monthly') return 'Monthly';
  if (lower === 'quarterly') return 'Quarterly';
  return text;
}

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
export function yahooChartUrl(ticker: string, nowMs: number = Date.now(), historyRange = 'max'): string {
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${historyWindowStartEpoch(historyRange, Math.floor(nowMs / 1000))}&period2=${Math.floor(nowMs / 1000)}&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
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

/** Declared SEC/EDGAR identity used when SEC_UA is blank. */
export const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';

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

export function parseMaxRetries(raw: string): number {
  if (!raw) return 3;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw new Error('MAX_RETRIES: expected integer >= 1');
  return Number(raw);
}

export function parseHistoryRange(raw: string): string {
  if (!raw) return 'max';
  if (!/^(max|[1-9]\d*y)$/i.test(raw)) throw new Error('HISTORY_RANGE: use max or Ny (e.g. 5y)');
  return raw.toLowerCase();
}

/** First epoch second of the Yahoo request window: `max` -> 0, `Ny` -> N years before now. */
export function historyWindowStartEpoch(historyRange: string, nowEpochSeconds: number): number {
  const years = /^([1-9]\d*)y$/i.exec(historyRange.trim());
  return years ? Math.max(0, Math.floor(nowEpochSeconds - Number(years[1]) * 365.25 * 86_400)) : 0;
}

function parseNonNegativeFloat(raw: string, fallback: number): number {
  if (String(raw ?? '').trim() === '') return fallback; // Number('') is 0: an empty control must not silently disable pacing
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
  if (text.split(':').length > 2) throw new Error(`${label}: "${text}" must contain exactly one colon`);
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
  const match = /^(\d+(?:\.\d+)?|\.\d+)([KMBT])?$/i.exec(cleaned);
  if (!match) throw new Error(`AUM: "${bound.trim()}" is not a number (use digits with an optional K/M/B/T suffix)`);
  return Number(match[1]) * (match[2] ? (AMOUNT_SUFFIXES[match[2].toUpperCase()] ?? 1) : 1);
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
  if (text.split(':').length > 2) throw new Error(`AUM: "${text}" must contain exactly one colon`);
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
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), 2),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), 2),
    maxFetches: parseNonNegativeInt(envValue(env, 'MAX_FETCHES'), 0),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), 250),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE', ['HISTORICAL_PAGE_SIZE']), 1000),
    storeRawDownloads: parseBoolean(envValue(env, 'STORE_RAW_DOWNLOADS')),
    maxRetries: parseMaxRetries(envValue(env, 'MAX_RETRIES')),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: parseHistoryRange(envValue(env, 'HISTORY_RANGE')),
    category: cleanText(envValue(env, 'CATEGORY')),
    secUa: envValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO')),
    skipVanEck: parseBoolean(envValue(env, 'SKIP_VANECK')),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK'), true),
    offlineSeed: parseBoolean(envValue(env, 'OFFLINE_SEED')),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(envValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// File defaults and explicit overrides share one allowlisted resolver for the
// CLI and the workflow, so GitHub Actions never interpolates user input into
// bash. Precedence: config file < advanced JSON < nonblank inputs < environment.
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'CATEGORY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'HISTORY_RANGE', 'MAX_RETRIES', 'SEC_UA',
  'STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_VANECK', 'EDGAR_FALLBACK', 'OFFLINE_SEED', 'VERBOSE', 'USE_SYSTEM_CA',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);
const CONTROL_ENV_ALIASES: Record<string, string[]> = { HISTORY_PAGE_SIZE: ['HISTORICAL_PAGE_SIZE'] };

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = env[key] ?? CONTROL_ENV_ALIASES[key]?.map((alias) => env[alias]).find((v) => v !== undefined);
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  if (result.REQUEST_SLEEP && (!Number.isFinite(Number(result.REQUEST_SLEEP)) || Number(result.REQUEST_SLEEP) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_VANECK', 'EDGAR_FALLBACK', 'OFFLINE_SEED', 'VERBOSE']) {
    if (result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key])) throw new Error(`${key}: expected boolean`);
  }
  if (result.USE_SYSTEM_CA !== undefined) {
    const mode = result.USE_SYSTEM_CA.toLowerCase();
    if (!['auto', 'true', 'false'].includes(mode)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA = mode;
  }
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  let file: unknown = {};
  try { file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return resolveControls(file, {}, {}, env);
}

const USAGE = `
VanEck ETF static feed updater (zero dependencies, run with Bun).

  bun ./scripts/update-data.ts [-h|--help]

Defaults live in scripts/update-data.config.json. Precedence: config file <
advanced JSON (workflow) < nonblank workflow inputs < environment variables.
Every variable below is optional.

  MAX_FETCHES          0     Funds to process. 0 = full pass. A positive value
                             resumes after the committed cursor in
                             api/vaneck/update-state.json.
  REQUEST_SLEEP        2     Minimum seconds between request starts.
  CONCURRENCY          2     Parallel fund workers (each worker has its own paced request lane).
  MAX_RETRIES          3     Retries for network errors and 408/425/429/5xx (integer >= 1).
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
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y   "min:max" return percent (YTD and 1Y as published, 3Y/5Y/10Y annualized).
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y  "min:max" cumulative total return percent.
                             Yield and return ranges exclude funds whose value is null.
  HOLDINGS_PAGE_SIZE   250   Rows per holdings page file.
  HISTORY_PAGE_SIZE    1000  Rows per history page file (env alias
                             HISTORICAL_PAGE_SIZE).
  HISTORY_RANGE        max   Yahoo request window and published history rows: max or Ny (e.g. 5y).
  CATEGORY             ""    Keep only this provider asset-class heading.
  STORE_RAW_DOWNLOADS  false 1|true|yes|y|on writes api/vaneck/raw/**.
  SEC_UA               "daggerok ETF feed daggerok@gmail.com"
                             Declared User-Agent for SEC EDGAR requests (a blank
                             value falls back to the same built-in identity).
  EDGAR_FALLBACK       true  Use Form N-PORT-P when a fund has no holdings file.
  SKIP_YAHOO           false Skip Yahoo Finance (distributions, derived returns).
  SKIP_VANECK          false Skip vaneck.com entirely (keeps committed data).
  OFFLINE_SEED         false Replay data/vaneck-verified.ts instead of
                             fetching. Used to regenerate the feed with no
                             network egress.
  VERBOSE              false Print per-fund retry and fallback notices.
  USE_SYSTEM_CA        auto  TLS trust store: auto restarts once with Bun's --use-system-ca on an
                             untrusted-certificate error, true always uses the system CA store,
                             false never restarts.

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

// One pacing lane per concurrent worker (sized from config.concurrency
// where the worker pool is started). A single shared chain serialized every
// request through one FIFO regardless of concurrency; CONCURRENCY workers
// now each get their own paced lane, so concurrency actually multiplies
// throughput as documented instead of only overlapping wait time.
let lastRequestAtLanes: number[] = [0];

/**
 * Reserves the next slot of the least-recently-used lane synchronously (before
 * any await), so concurrent callers never pick the same slot and wake together.
 * Each lane starts its requests at least `requestSleep` seconds apart.
 */
export async function paceRequests(config: UpdaterConfig): Promise<void> {
  let lane = 0;
  for (let i = 1; i < lastRequestAtLanes.length; i++) if (lastRequestAtLanes[i] < lastRequestAtLanes[lane]) lane = i;
  const now = Date.now();
  const slot = Math.max(now, lastRequestAtLanes[lane] + config.requestSleep * 1000);
  lastRequestAtLanes[lane] = slot;
  if (slot > now) await sleep(slot - now);
}

/** Resets the pacing lanes (one per worker); used by main and tests. */
export function resetPacingLanes(count: number): void {
  lastRequestAtLanes = new Array(Math.max(1, count)).fill(0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Per-attempt network budget (headers AND body): a stalled socket must not hold a worker forever. */
let fetchTimeoutMs = 45_000;
let retryBackoffMs = 15_000;
export function setNetworkTimings(timeoutMs: number, backoffMs: number): void {
  fetchTimeoutMs = timeoutMs;
  retryBackoffMs = backoffMs;
}
function isTimeoutError(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timed out|aborted due to timeout/i.test(String(e?.message ?? ''));
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
      const attemptInit: RequestInit = { ...init, signal: AbortSignal.timeout(fetchTimeoutMs) };
      const response = isVanEck
        ? await fetchVanEckWithManualRedirect(url, attemptInit, label)
        : await fetch(url, attemptInit);
      // VanEck sits behind a WAF that answers 403 while throttling, so a 403 is
      // retried like a 429 (bounded) rather than treated as "not found".
      if (response.ok || (!RETRY_STATUS.has(response.status) && response.status !== 403)) return response;
      if (attempt >= config.maxRetries) return response;
      outputNote(`[ ${'retry'.padEnd(9)}] ${label}: HTTP ${response.status} (retry ${attempt + 1}/${config.maxRetries})`);
    } catch (error) {
      const msg = errorMessage(error);
      const isRedirectLoop = /redirect(ed)? too many times/i.test(msg);
      const isNetwork = isRedirectLoop || isTimeoutError(error) || /fetch failed|network|ECONNRESET|ETIMEDOUT|Client network socket disconnected/i.test(msg);
      if (attempt >= config.maxRetries || (!isNetwork && !isRedirectLoop)) throw error;
      outputNote(`[ ${'retry'.padEnd(9)}] ${label}: ${msg} (retry ${attempt + 1}/${config.maxRetries})`);
      if (isRedirectLoop && isVanEck && attempt < config.maxRetries) {
        // For VanEck a loop is usually a transient WAF hiccup; back off and retry the whole jar
        await sleep(8000 * (attempt + 1));
        attempt += 1;
        continue;
      }
      if (isRedirectLoop) throw error;
    }
    attempt += 1;
    await sleep(retryBackoffMs * attempt);
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

/** Fetches and reads the body; a body that stalls past the timeout is retried like a failed request. */
async function fetchBody<T>(
  url: string,
  headers: Record<string, string>,
  config: UpdaterConfig,
  label: string,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchWithRetry(url, { headers }, config, label);
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
    try {
      return await read(response);
    } catch (error) {
      if (!isTimeoutError(error) || attempt >= config.maxRetries) throw error;
      outputNote(`[ ${'retry'.padEnd(9)}] ${label}: body timed out (retry ${attempt + 1}/${config.maxRetries})`);
    }
  }
}

async function fetchText(url: string, headers: Record<string, string>, config: UpdaterConfig, label = url): Promise<string> {
  return fetchBody(url, headers, config, label, (response) => response.text());
}

async function fetchBytes(url: string, headers: Record<string, string>, config: UpdaterConfig, label = url): Promise<Uint8Array> {
  return fetchBody(url, headers, config, label, async (response) => new Uint8Array(await response.arrayBuffer()));
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
    return JSON.parse(await fetchText(yahooChartUrl(ticker, Date.now(), config.historyRange), yahooHeaders(), config, `${ticker} Yahoo chart`));
  } catch (error) {
    outputNote(`[ ${'chart'.padEnd(9)}] ${ticker}: Yahoo chart unavailable (${errorMessage(error)})`);
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
    outputNote(`[ ${'perf'.padEnd(9)}] ${ticker}: performance history unavailable (${errorMessage(error)})`);
    throw error;
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
    outputNote(`[ ${'distrib'.padEnd(9)}] ${ticker}: VanEck distributions unavailable (${errorMessage(error)})`);
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

/**
 * A yield above this is a liquidation or return-of-capital payout, not a yield
 * (RSXJ: a $0.82 final distribution over a $0.39 NAV annualised to 210%), so it is
 * published as null rather than as a number a screener would sort on.
 */
export const MAX_SANE_YIELD_PERCENT = 100;
export function saneYield(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= MAX_SANE_YIELD_PERCENT ? value : null;
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
  if (!text) return '00 - None';
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

/** Writes through a sibling temp file and renames it, so a killed run never leaves truncated JSON. */
async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, file);
}

/** Writes only when the serialized bytes actually differ (P13: empty diff). */
async function writeIfChanged(file: string, contents: string): Promise<'written' | 'unchanged'> {
  if (existsSync(file)) {
    const existing = await readFile(file, 'utf8');
    if (existing === contents) return 'unchanged';
  }
  await writeFileAtomic(file, contents);
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
      performanceAsOf: null,
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

/**
 * STANDARD.md 9a: `metrics.returnsBasis` (non-empty label) and
 * `metrics.performanceAsOf` (ISO date of the returns, or null) always sit at
 * the end of `metrics`. The date is the as-of stamp of the returns block
 * (`returns.monthEnd.asOfDate`: the fund-page YTD stamp, else the performance
 * table month-end, else the finder month-end) - never the NAV date field.
 */
export function withReturnsMeta(entry: CatalogEntry): CatalogEntry {
  const { returnsBasis, performanceAsOf: _previous, ytdAsOf: _previousYtd, ...rest } = (entry.metrics as Record<string, unknown>) ?? {};
  const monthEnd = (entry.returns as { monthEnd?: { asOfDate?: unknown; tenorsAsOf?: unknown } } | undefined)?.monthEnd;
  const toIso = (stamp: unknown): string | null =>
    typeof stamp === 'string' && stamp !== '—' && Number.isFinite(Date.parse(`${stamp} UTC`))
      ? new Date(`${stamp} UTC`).toISOString().slice(0, 10)
      : null;
  // The date the tenor figures (1Y/3Y/5Y/10Y/since inception) are as of; the fund-page stamp (daily YTD) only when no tenor date is known.
  const iso = toIso(monthEnd?.tenorsAsOf) ?? toIso(monthEnd?.asOfDate);
  const ytdIso = (rest as Record<string, unknown>).ytd === null || (rest as Record<string, unknown>).ytd === undefined ? null : toIso(monthEnd?.asOfDate);
  const basis = typeof returnsBasis === 'string' && returnsBasis.trim() && returnsBasis.trim() !== '-' && returnsBasis.trim() !== '—'
    ? returnsBasis
    : 'not yet refreshed from vaneck.com';
  return { ...entry, metrics: { ...rest, ytdAsOf: ytdIso, returnsBasis: basis, performanceAsOf: iso } };
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

async function readCursor(scope: string): Promise<string | null> {
  const file = path.join(API_ROOT, 'update-state.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    // A cursor saved under another filter set (or by an older version without a scope) is not ours.
    if (parsed.scope !== scope) return null;
    return typeof parsed.cursor === 'string' && parsed.cursor ? parsed.cursor : null;
  } catch {
    return null;
  }
}

/** Value of a PERFORMANCE_* (annualized from 3Y, YTD/1Y as published) or TOTAL_RETURN_* (cumulative) tenor. */
function returnMetric(metrics: Record<string, unknown>, kind: 'PERFORMANCE' | 'TOTAL_RETURN', period: ReturnPeriod): number | null {
  const key =
    period === 'YTD' ? 'ytd' :
    period === '1Y' ? 'tr1y' :
    kind === 'PERFORMANCE' ? `cagr${period.toLowerCase()}` : `tr${period.toLowerCase()}`;
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inRange(value: number | null, range: Range | undefined): boolean {
  if (!range || (range.min === undefined && range.max === undefined)) return true;
  if (value === null) return false; // a bounded range excludes funds without a value
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

/** Data-dependent filters (yields and returns), evaluated on the freshly computed metrics before anything is written. */
export function fundPassesDataFilters(metrics: Record<string, unknown>, config: UpdaterConfig): boolean {
  const num = (key: string) => (typeof metrics[key] === 'number' && Number.isFinite(metrics[key] as number) ? (metrics[key] as number) : null);
  if (!inRange(num('dividendYield'), config.dividendYieldRange)) return false;
  if (!inRange(num('secYield'), config.secYieldRange)) return false;
  for (const period of RETURN_PERIODS) {
    if (!inRange(returnMetric(metrics, 'PERFORMANCE', period), config.performanceRanges[period])) return false;
    if (!inRange(returnMetric(metrics, 'TOTAL_RETURN', period), config.totalReturnRanges[period])) return false;
  }
  return true;
}

/** Identity of the active selection; the MAX_FETCHES cursor only resumes inside the same filter set. */
export function filterScope(config: UpdaterConfig): string {
  return JSON.stringify([
    config.tickers.slice().sort(), config.category, config.aumRange ?? null, config.terRange ?? null,
    config.dividendYieldRange ?? null, config.secYieldRange ?? null, config.performanceRanges, config.totalReturnRanges,
  ]);
}

/** Unknown tickers are an error, never a silent empty selection. */
export function assertKnownTickers(tickers: string[], funds: VanEckSeedFund[]): void {
  const known = new Set(funds.map((fund) => fund.ticker));
  const unknown = tickers.filter((ticker) => !known.has(ticker));
  if (unknown.length) throw new Error(`TICKERS: unknown ticker(s) ${unknown.join(', ')}`);
}

/** Soft internal deadline: the workflow timeout is 30 minutes, so stop taking new funds after 25. */
export const RUN_SOFT_DEADLINE_MS = 25 * 60 * 1000;

/** A row without funds/<T>/meta.json points nowhere: dataFile is null (the metrics object stays complete). */
function withDataFile(entry: CatalogEntry): CatalogEntry {
  const exists = existsSync(path.join(API_ROOT, 'funds', String(entry.ticker), 'meta.json'));
  return { ...entry, dataFile: exists ? `./funds/${entry.ticker}/meta.json` : null };
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

export type PendingWrite = { file: string; contents: string };

/** Plans the page files of one fund section (nothing is written here): pages are flushed with the fund, before its meta.json. */
function planFundPages(
  ticker: string,
  kind: 'holdings' | 'history',
  manifest: Omit<PageManifest, 'pages' | 'pageCount'>,
  pages: Array<Array<Record<string, string>>>,
  writes: PendingWrite[],
): PageManifest {
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
    writes.push({
      file: path.join(dir, name),
      contents: serialize({ ticker, page: i + 1, pageSize: manifest.pageSize, totalRows: manifest.totalRows, headers, rows }),
    });
  }
  return { ...manifest, pageCount: pages.length, pages: pageFiles };
}

/** Removes page files beyond the new page count; runs only after the new meta.json is in place. */
async function removeStalePages(ticker: string, kind: 'holdings' | 'history', pageCount: number): Promise<void> {
  const dir = path.join(API_ROOT, 'funds', ticker, kind);
  if (!existsSync(dir)) return;
  for (const name of await readdir(dir)) {
    const match = /^(\d{3})\.json$/.exec(name);
    if (match && Number(match[1]) > pageCount) await rm(path.join(dir, name), { force: true });
  }
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
): Promise<CatalogEntry | null> {
  let entry = seedCatalogEntry(seed);
  const ticker = seed.ticker;
  const writes: PendingWrite[] = [];
  // Required live sources that failed (an honest HTTP 404 is absence, not failure). Any failure keeps
  // the fund's previous complete published state instead of mixing fresh and stale columns.
  const failedSources: string[] = [];
  const isNotFound = (error: unknown) => /HTTP 404\b/.test(errorMessage(error));
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
      outputNote(`[ ${'product'.padEnd(9)}] ${ticker}: fund page unavailable (${errorMessage(error)})`);
      failedSources.push('fund page');
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
  const liveVanEck = !config.skipVanEck && !config.offlineSeed;
  let holdingsMissing = false;
  if (liveVanEck) {
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
        outputNote(`[ ${'holdings'.padEnd(9)}] ${ticker}: holdings unavailable (${errorMessage(error)}; legacy: ${errorMessage(legacyError)})`);
        holdingsMissing = isNotFound(error) && isNotFound(legacyError);
        if (!holdingsMissing && !snapshotHoldingsFor(ticker)) failedSources.push('holdings');
      }
    }
  }
  if (!holdings) holdings = snapshotHoldingsFor(ticker);
  const holdingsPages = holdings ? chunkRows(toKeyedRows(holdings.headers, holdings.rows), config.holdingsPageSize) : [];
  const holdingsManifest = holdings
    ? planFundPages(ticker, 'holdings', {
        totalRows: holdings.rows.length,
        pageSize: config.holdingsPageSize,
        asOfDate: holdings.asOfDate,
        source: `VanEck daily holdings download (${source.holdingsDownload})`,
      }, holdingsPages, writes)
    : null;

  // --- history -------------------------------------------------------------
  let history: ParsedHistory | null = null;
  if (liveVanEck) {
    try {
      history = parseVanEckHistoryXlsx(await fetchBytes(source.navDownload, browserHeaders(), config, `${ticker} NAV history`));
    } catch (error) {
      outputNote(`[ ${'history'.padEnd(9)}] ${ticker}: NAV history unavailable (${errorMessage(error)})`);
      if (!isNotFound(error) && !snapshotHistoryFor(ticker)) failedSources.push('NAV history');
    }
  }
  if (!history) history = snapshotHistoryFor(ticker);
  if (history && config.historyRange && config.historyRange !== 'max') {
    const cutoff = historyWindowStartEpoch(config.historyRange, Math.floor(Date.now() / 1000)) * 1000;
    history = { ...history, rows: history.rows.filter((row) => Date.parse(`${toIsoDate(row[0])} UTC`) >= cutoff) };
  }
  const historyPages = history ? chunkRows(toKeyedRows(history.headers, history.rows), config.historyPageSize) : [];
  const historyManifest = history
    ? planFundPages(ticker, 'history', {
        totalRows: history.rows.length,
        pageSize: config.historyPageSize,
        asOfDate: history.rows.length ? history.rows[0][0] : '—',
        source: `VanEck NAV & premium/discount history download (${source.navDownload})`,
      }, historyPages, writes)
    : null;

  if (history && history.rows.length) entry = applyLatestHistoryRow(entry, history.rows[0]);
  entry.holdings = holdings ? holdings.rows.length : 0;
  entry.history = history ? history.rows.length : 0;

  // --- performance (Average Annual Total Returns) ---------------------------
  // Client-hydrated on the page, but from a plain JSON endpoint the widget
  // itself calls — see fetchVanEckPerformance().
  let performance: ParsedPerformance | null = null;
  if (!config.skipVanEck && !config.offlineSeed && pageSnapshot?.pageId && pageSnapshot?.performanceBlockId) {
    try {
      performance = await fetchVanEckPerformance(ticker, pageSnapshot.pageId, pageSnapshot.performanceBlockId, config);
    } catch {
      failedSources.push('performance');
    }
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
    // The tenor figures are as of the performance block's own date, not the fund page's daily YTD stamp.
    if (performance.asOfDate) returnsMonthEnd.tenorsAsOf = performance.asOfDate;
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
    monthEnd.tenorsAsOf = formatVanEckDate(FINDER_MONTH_END_AS_OF);
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
  const indicatedYield = saneYield(latestAmount !== null && indicatedAllowed ? indicatedDividendYield(latestAmount, payments, navForYield) : null);
  const dividendYield = saneYield(officialDistributionYield ?? indicatedYield);
  metrics.distributionYield = saneYield(officialDistributionYield);
  metrics.distributionYieldText = formatPercentText(saneYield(officialDistributionYield));
  metrics.yield12M = saneYield(finder?.yield12M ?? null);
  metrics.yield12MText = formatPercentText(saneYield(finder?.yield12M ?? null));

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

  entry = withReturnsMeta(entry);

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
  if (failedSources.length) {
    throw new Error(`${ticker}: ${failedSources.join(', ')} unavailable; kept the previous published state`);
  }
  if (!fundPassesDataFilters(entry.metrics as Record<string, unknown>, config)) return null;

  // Flush order: pages, raw downloads, meta.json, then stale pages (never before the new meta exists).
  for (const write of writes) await writeIfChanged(write.file, write.contents);
  if (config.storeRawDownloads && holdings) {
    await writeIfChanged(
      path.join(API_ROOT, 'raw', `${ticker}-holdings.json`),
      serialize({ url: source.holdingsDownload, asOfDate: holdings.asOfDate, headers: holdings.headers, rows: holdings.rows }),
    );
  }
  const metaResult = await writeIfChanged(path.join(API_ROOT, 'funds', ticker, 'meta.json'), serialize(meta));
  if (holdingsManifest) await removeStalePages(ticker, 'holdings', holdingsManifest.pageCount);
  if (historyManifest) await removeStalePages(ticker, 'history', historyManifest.pageCount);
  if (metaResult === 'written') stats.updated += 1;
  else stats.unchanged += 1;
  return entry;
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<void> {
  if (argv.some((arg) => arg === '--help' || arg === '-h')) {
    console.log(USAGE);
    return;
  }
  if (argv.length) throw new Error(`unsupported argument(s): ${argv.join(' ')}. Use --help for usage.`);
  const controls = await runtimeControls(env);
  if (controls.VERBOSE !== undefined && env === process.env) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  const config = readConfig(controls);
  outputPrintConfig('VanEck', config);
  const stats: RunStats = { updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  assertKnownTickers(config.tickers, VAN_ECK_SEED);
  const scope = filterScope(config);
  const cursor = config.maxFetches > 0 ? await readCursor(scope) : null;
  const candidates = selectCandidates(VAN_ECK_SEED, config, cursor);

  outputPrintFilter(candidates.length, VAN_ECK_SEED.length, outputHasOutputFilters(config));
  const output = outputCreateReporter(API_ROOT, candidates.length);
  if (cursor) console.log(`Resuming after cursor ${cursor}.`);

  const byTicker = new Map<string, CatalogEntry>();
  const queue = candidates.slice();
  const total = candidates.length;
  let processed = 0;
  const deadline = Date.now() + RUN_SOFT_DEADLINE_MS;
  const laneCount = Math.max(1, config.concurrency);
  resetPacingLanes(laneCount);
  const workers = Array.from({ length: laneCount }, async () => {
    for (;;) {
      if (Date.now() > deadline) return; // soft deadline: stop taking new funds, still write the index
      const seed = queue.shift();
      if (!seed) return;
      const before = await output.before(seed.ticker);
      try {
        const entry = await updateFund(seed, config, stats);
        if (entry) byTicker.set(seed.ticker, entry);
        else stats.skipped += 1;
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

  const funds = Object.values(previous).map(withReturnsMeta).map(withDataFile).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + Number(fund.holdings || 0), 0),
    history: funds.reduce((sum, fund) => sum + Number(fund.history || 0), 0),
  };
  const index = {
    generatedAt: previousGeneratedAt,
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
        `Investment Finder Prices & Yields (${FINDER_PRICES_AS_OF}) and month-end Performance (${FINDER_MONTH_END_AS_OF}) tabs, verified ${FINDER_READ_AT} (see VANECK_FINDER in scripts/update-data.ts)`,
      exchange: 'Nasdaq Trader symbol directory, Yahoo Finance chart meta as fallback',
    },
    counts,
    funds,
  };
  // The stamp only moves when the feed content moved, so a rerun with unchanged upstream data writes nothing.
  const contentKey = (value: unknown) => JSON.stringify({ ...(value as object), generatedAt: null });
  let previousIndexText = '';
  try { previousIndexText = await readFile(indexFile, 'utf8'); } catch { /* first run */ }
  let indexUnchanged = false;
  try { indexUnchanged = previousIndexText !== '' && contentKey(JSON.parse(previousIndexText)) === contentKey(index); } catch { /* rewrite a corrupt index */ }
  if (!indexUnchanged) {
    await writeFileAtomic(indexFile, serialize({ ...index, generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }));
  }

  const statePath = path.join(API_ROOT, 'update-state.json');
  if (config.maxFetches > 0 && candidates.length) {
    await writeFileAtomic(statePath, serialize({ scope, cursor: candidates[candidates.length - 1].ticker }));
  } else if (config.maxFetches === 0 && scope === filterScope(readConfig({})) && existsSync(statePath)) {
    // Only an unfiltered full pass resets the cursor; a TICKERS or filtered run never touches it.
    await rm(statePath);
  }

  console.log(
    `Done. updated=${stats.updated} unchanged=${stats.unchanged} skipped=${stats.skipped} failed=${stats.failed} · funds=${counts.funds} holdings=${counts.holdings} history=${counts.history}`,
  );
  if (candidates.length > 0 && stats.failed >= candidates.length && byTicker.size === 0) {
    throw new Error(`every selected fund failed (${stats.failed}/${candidates.length})`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exit(1);
  });
}
