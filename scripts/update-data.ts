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
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
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
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
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
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
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
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${`${String(index).padStart(width)}/${total}`.padEnd(8)} ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
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
 * A source that cannot be reached never replaces what is published: the fund keeps its
 * previous complete state and the run reports the failure.
 */
import { appendFile, mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
/** The finder month-end YTD is a YTD only within its own calendar year (`returnsYear`: year of the fund's returns). */
export function finderYtdUsable(returnsYear: string): boolean {
  return FINDER_MONTH_END_AS_OF.slice(-4) === returnsYear;
}

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

/** A calendar date as ISO (shared calendar-dates block: plain text, never the local time zone); any other text unchanged. */
export function toIsoDate(raw: unknown): string {
  const text = cleanText(raw);
  return calendarIso(text) ?? text;
}

/** Epoch milliseconds of a calendar date (UTC midnight), NaN when the text is no date. */
function calendarEpoch(raw: unknown): number {
  const iso = calendarIso(raw);
  return iso ? Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) : NaN;
}

/** Sorts "Sep 18 2026"-style dates chronologically without a locale round trip. */
export function compareDisplayDates(a: string, b: string): number {
  return calendarEpoch(a) - calendarEpoch(b);
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
  'STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_VANECK', 'EDGAR_FALLBACK', 'VERBOSE', 'USE_SYSTEM_CA',
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
  for (const key of ['STORE_RAW_DOWNLOADS', 'SKIP_YAHOO', 'SKIP_VANECK', 'EDGAR_FALLBACK', 'VERBOSE']) {
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
  HISTORY_RANGE        max   Yahoo request window (distributions fallback, exchange): max or Ny (e.g. 5y); the NAV history stays complete.
  CATEGORY             ""    Keep only this provider asset-class heading.
  STORE_RAW_DOWNLOADS  false 1|true|yes|y|on writes api/vaneck/raw/**.
  SEC_UA               "daggerok ETF feed daggerok@gmail.com"
                             Declared User-Agent for SEC EDGAR requests (a blank
                             value falls back to the same built-in identity).
  EDGAR_FALLBACK       true  Use the fund's newest Form N-PORT-P when the holdings download fails or is absent (only a filing newer than the published holdings).
  SKIP_YAHOO           false Skip Yahoo Finance (distributions, derived returns).
  SKIP_VANECK          false Skip vaneck.com entirely (keeps committed data).
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
      outputNote(`[ ${'retry'.padEnd(8)} ] ${label}: HTTP ${response.status} (retry ${attempt + 1}/${config.maxRetries})`);
    } catch (error) {
      const msg = errorMessage(error);
      const isRedirectLoop = /redirect(ed)? too many times/i.test(msg);
      const isNetwork = isRedirectLoop || isTimeoutError(error) || /fetch failed|network|ECONNRESET|ETIMEDOUT|Client network socket disconnected/i.test(msg);
      if (attempt >= config.maxRetries || (!isNetwork && !isRedirectLoop)) throw error;
      outputNote(`[ ${'retry'.padEnd(8)} ] ${label}: ${msg} (retry ${attempt + 1}/${config.maxRetries})`);
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
      outputNote(`[ ${'retry'.padEnd(8)} ] ${label}: body timed out (retry ${attempt + 1}/${config.maxRetries})`);
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
    outputNote(`[ ${'chart'.padEnd(8)} ] ${ticker}: Yahoo chart unavailable (${errorMessage(error)})`);
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
    outputNote(`[ ${'exchange'.padEnd(8)} ] Nasdaq symbol directory unavailable (${errorMessage(error)}); exchange falls back to Yahoo`);
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
    outputNote(`[ ${'perf'.padEnd(8)} ] ${ticker}: performance history unavailable (${errorMessage(error)})`);
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
    .sort((a, b) => (calendarEpoch(b.exDate) || 0) - (calendarEpoch(a.exDate) || 0));
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
    outputNote(`[ ${'distrib'.padEnd(8)} ] ${ticker}: VanEck distributions unavailable (${errorMessage(error)})`);
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
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
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
    const iso = calendarIso(found[1]);
    return iso ? formatVanEckDate(`${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`) : null;
  };
  const percent = (blob: string): number | null => {
    const found = /(-?\d+(?:\.\d+)?)\s*%/.exec(blob);
    return found ? Number(found[1]) : null;
  };
  const compactMoney = (blob: string): number | null => {
    // Small funds print thousands (`$349.4K`, RSXJ and the TRU* funds): every unit counts.
    const found = /\$\s?([\d,]+(?:\.\d+)?)\s*([KMBT])?\b/i.exec(blob);
    if (!found) return null;
    const base = Number(found[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) return null;
    const multiplier: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
    return round(base * (multiplier[(found[2] || '').toUpperCase()] ?? 1), 2);
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
    .map((raw) => calendarEpoch(raw))
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
  const ex = calendarEpoch(latestExDate);
  const asOf = calendarEpoch(asOfDate);
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
      dividendYieldBasis: null,
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

/** Codes of `metrics.dividendYieldBasis`: which definition stands behind `dividendYield`. */
export type DividendYieldBasis = 'official-distribution-rate' | 'indicated';
const DIVIDEND_YIELD_BASES: readonly string[] = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'];

/**
 * `dividendYield` is the finder's official Distribution Yield (latest distribution annualised: a distribution
 * rate) when published, else the indicated yield. `null` exactly when the yield is null. A row carrying no valid
 * code (published by an older run) is classified from its own numbers: equal to `distributionYield` -> official.
 */
export function dividendYieldBasisOf(metrics: Record<string, unknown>): DividendYieldBasis | string | null {
  const yieldValue = metrics.dividendYield;
  if (typeof yieldValue !== 'number' || !Number.isFinite(yieldValue)) return null;
  const code = metrics.dividendYieldBasis;
  if (typeof code === 'string' && DIVIDEND_YIELD_BASES.includes(code)) return code;
  return metrics.distributionYield === yieldValue ? 'official-distribution-rate' : 'indicated';
}

/**
 * STANDARD.md 9a: `metrics.returnsBasis` (non-empty label) and
 * `metrics.performanceAsOf` (ISO date of the returns, or null) always sit at
 * the end of `metrics`. The date is the as-of stamp of the returns block
 * (`returns.monthEnd.asOfDate`: the fund-page YTD stamp, else the performance
 * table month-end, else the finder month-end) - never the NAV date field.
 */
export function withReturnsMeta(entry: CatalogEntry): CatalogEntry {
  const { returnsBasis, performanceAsOf: _previous, ytdAsOf: _previousYtd, dividendYieldBasis: _previousBasis, ...rest } = (entry.metrics as Record<string, unknown>) ?? {};
  const dividendYieldBasis = dividendYieldBasisOf({ ...rest, dividendYieldBasis: _previousBasis });
  const monthEnd = (entry.returns as { monthEnd?: { asOfDate?: unknown; tenorsAsOf?: unknown } } | undefined)?.monthEnd;
  const toIso = isoOfStamp;
  // The date the tenor figures (1Y/3Y/5Y/10Y/since inception) are as of; the fund-page stamp (daily YTD) only when no tenor date is known.
  const iso = toIso(monthEnd?.tenorsAsOf) ?? toIso(monthEnd?.asOfDate);
  // A backfilled finder YTD carries its own month-end date (`ytdAsOf`); otherwise YTD is the fund-page daily stamp.
  const ytdStamp = (monthEnd as { ytdAsOf?: unknown } | undefined)?.ytdAsOf;
  const ytdIso = (rest as Record<string, unknown>).ytd === null || (rest as Record<string, unknown>).ytd === undefined ? null : toIso(ytdStamp) ?? toIso(monthEnd?.asOfDate);
  const basis = typeof returnsBasis === 'string' && returnsBasis.trim() && returnsBasis.trim() !== '-' && returnsBasis.trim() !== '—'
    ? returnsBasis
    : 'not yet refreshed from vaneck.com';
  return { ...entry, metrics: { ...rest, dividendYieldBasis, ytdAsOf: ytdIso, returnsBasis: basis, performanceAsOf: iso } };
}

/** ISO date of a display stamp ("Sep 30 2026", "09/30/2026") as calendar text (shared calendar-dates block); null for '—' or junk. */
function isoOfStamp(stamp: unknown): string | null {
  return typeof stamp === 'string' ? calendarIso(stamp) : null;
}

/** The horizons of the metrics and of a returns table (`monthEnd`, `quarterEnd`), in years. */
const METRIC_HORIZONS = { tr1y: 1, siAnn: 1, tr3y: 3, cagr3y: 3, tr5y: 5, cagr5y: 5, tr10y: 10, cagr10y: 10 };
const RETURN_HORIZONS = { yr1: 1, sinceInception: 1, yr3: 3, yr5: 5, yr10: 10 };

/**
 * A horizon longer than the fund's age at the returns date does not exist: null, never a stand-in (the shared
 * `withoutYoungReturns`, calendar anniversary of the inception). VanEck puts the CUMULATIVE since-inception figure into the
 * "Life" column of funds younger than one year (TRUF, launched 2026-04-01: 8.75 as of 2026-09-30) and VSOL (335 days) even
 * into 1 Year; the fund-page "Performance since inception" stat of a days-old fund (VEEM) is cumulative too. Annualized
 * since inception therefore needs one year between inception and the table date (month-end: `tenorsAsOf`, quarter-end: its
 * own date; today when unknown), 3/5/10Y need 3/5/10 years. An unknown inception keeps the figures.
 */
export function withoutTooYoungTenors(entry: CatalogEntry, today = new Date().toISOString().slice(0, 10)): CatalogEntry {
  const inception = isoOfStamp(entry.inceptionDate);
  if (!inception) return entry;
  const returns = (entry.returns ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const monthAsOf = isoOfStamp(returns.monthEnd?.tenorsAsOf) ?? isoOfStamp(returns.monthEnd?.asOfDate) ?? today;
  const quarterAsOf = isoOfStamp(returns.quarterEnd?.asOfDate) ?? today;
  const metrics = withoutYoungReturns((entry.metrics as Record<string, unknown>) ?? {}, inception, monthAsOf, METRIC_HORIZONS);
  const monthEnd = returns.monthEnd ? withoutYoungReturns(returns.monthEnd, inception, monthAsOf, RETURN_HORIZONS) : undefined;
  const quarterEnd = returns.quarterEnd ? withoutYoungReturns(returns.quarterEnd, inception, quarterAsOf, RETURN_HORIZONS) : undefined;
  return { ...entry, metrics, returns: { ...returns, ...(monthEnd ? { monthEnd } : {}), ...(quarterEnd ? { quarterEnd } : {}) } };
}

/** Merges a parsed fund page onto a catalog entry. */
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
    merged.secYield = v;
    merged.secYieldValue = v;
    merged.secYieldText = `${v.toFixed(2)}%`;
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
  // A closed fund is never fetched, guarded or reported, and never spends the MAX_FETCHES budget.
  list = withoutClosedFunds(list, (fund) => fund.ticker, CLOSED_FUNDS);
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

/** Rows of the previously published holdings or history (0 when the fund has no meta or published none). */
async function publishedRowCount(ticker: string, kind: 'holdings' | 'history'): Promise<number> {
  try {
    const meta = JSON.parse(await readFile(path.join(API_ROOT, 'funds', ticker, 'meta.json'), 'utf8'));
    return Number(meta?.[kind]?.totalRows) || 0;
  } catch {
    return 0;
  }
}

/** Rows of the published holdings pages that carry a numeric weight (holdingsGuard's previousWeights; null when nothing is published). */
async function publishedWeightCount(ticker: string): Promise<number | null> {
  try {
    const meta = JSON.parse(await readFile(path.join(API_ROOT, 'funds', ticker, 'meta.json'), 'utf8'));
    const pages: unknown[] = Array.isArray(meta?.holdings?.pages) ? meta.holdings.pages : [];
    let count = 0;
    for (const page of pages) {
      const sheet = JSON.parse(await readFile(path.join(API_ROOT, 'funds', ticker, String(page)), 'utf8'));
      count += holdingsWeightCount(Array.isArray(sheet?.headers) ? sheet.headers : [], Array.isArray(sheet?.rows) ? sheet.rows : []);
    }
    return count;
  } catch {
    return null;
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

// ---------------------------------------------------------------------------
// SEC EDGAR Form N-PORT-P holdings fallback (EDGAR_FALLBACK)
// ---------------------------------------------------------------------------
// Used only when the VanEck holdings download failed or is absent, and only when the filing's report period is
// strictly newer than the published holdings: a quarterly filing never replaces fresher daily holdings.

export const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
export const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

/**
 * The VanEck holdings sheet of an N-PORT filing, in HOLDINGS_HEADERS order: a missing number stays empty (never 0), the
 * weight keeps 4 decimals with a `%` like the VanEck download; tickers come from nportTickers (U.S. equities only).
 */
export function nportHoldingRows(filing: NportFiling, tickers: ReadonlyArray<string>): string[][] {
  return filing.positions.map((position, index) => {
    const weight = nportCell(position.weight, 4);
    return [position.name, tickers[index] || '', nportIdentifier(position), weight ? `${weight}%` : '', nportCell(position.value, 2), nportCell(position.balance), position.assetCat];
  });
}

/** "2026-06-30" -> "Jun 30 2026", the date form of the VanEck holdings sheets. */
function isoToVanEckDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? formatVanEckDate(`${match[2]}/${match[3]}/${match[1]}`) : iso || '—';
}

/** One run's SEC state: the two ticker tables (a failed load is asked once more later in the run, then not again), the N-PORT reader cache, a 403. */
let secState: {
  funds: { value: Map<string, NportSeriesRef> | null; pending: Promise<Map<string, NportSeriesRef>> | null; failures: number };
  names: Promise<Map<string, string>> | null;
  reader: Map<string, unknown>;
  denied: boolean;
} = { funds: { value: null, pending: null, failures: 0 }, names: null, reader: new Map(), denied: false };

export function resetSecState(): void {
  secState = { funds: { value: null, pending: null, failures: 0 }, names: null, reader: new Map(), denied: false };
}

/** An SEC request; after a 403 (missing or rejected User-Agent contact) no further SEC requests this run. */
async function secText(url: string, config: UpdaterConfig, label: string): Promise<string> {
  if (secState.denied) throw new Error(`${label}: SEC denied an earlier request this run`);
  try {
    return await fetchText(url, secHeaders(config), config, label);
  } catch (error) {
    if (/HTTP 403\b/.test(errorMessage(error))) secState.denied = true;
    throw error;
  }
}

function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  const table = secState.funds;
  if (table.value) return Promise.resolve(table.value);
  if (table.pending) return table.pending;
  if (table.failures >= 2) return Promise.reject(new Error('SEC fund ticker table unavailable this run'));
  table.pending = secText(SEC_FUND_TICKERS_URL, config, 'SEC fund ticker table').then(
    (body) => { table.value = parseSecFundTickers(JSON.parse(body)); table.pending = null; return table.value; },
    (error: unknown) => { table.failures += 1; table.pending = null; throw error; },
  );
  return table.pending;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run (null when SEC does not answer). */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string> | null> {
  if (!secState.names) {
    const loading = secText(SEC_COMPANY_TICKERS_URL, config, 'SEC company ticker table').then((body) => parseSecCompanyNames(JSON.parse(body)));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names.catch(() => null);
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
}

/**
 * The fund's own newest N-PORT-P filing as a VanEck sheet (shared nport-reader block: series identity, newest report period,
 * registrant folder), used only when strictly newer than the published holdings. Holdings that came from an N-PORT filing
 * are compared by the filing itself: the same filing is published again unchanged (zero diff), another one must be newer.
 */
async function fetchNportHoldings(ticker: string, config: UpdaterConfig): Promise<{ asOfDate: string; rows: string[][]; source: string } | null> {
  try {
    const ref = (await loadFundTickerTable(config)).get(ticker);
    if (!ref) {
      outputNote(`[ ${'edgar'.padEnd(8)} ] ${ticker}: not in the SEC fund ticker table`);
      return null;
    }
    const published = await publishedHoldings(ticker);
    const publishedAsOf = calendarIso(published?.asOfDate) ?? '';
    const publishedRows = Number(published?.totalRows) || 0;
    const fromNport = /^SEC EDGAR Form N-PORT-P /.test(String(published?.source ?? ''));
    const read = await readNportHoldings({ ticker, cik: ref.cik, seriesId: ref.seriesId }, fromNport ? { rows: 0 } : { asOf: publishedAsOf, rows: publishedRows }, (url, label) => secText(url, config, label), { cache: secState.reader });
    if ('problem' in read) {
      outputNote(`[ ${'edgar'.padEnd(8)} ] ${read.problem}`);
      return null;
    }
    const source = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate})`;
    if (fromNport && source !== published?.source && !nportIsFresh(read.filing.repPdDate, publishedAsOf, publishedRows)) {
      outputNote(`[ ${'edgar'.padEnd(8)} ] ${ticker}: N-PORT ${read.filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published?.asOfDate ?? '—')}); not used`);
      return null;
    }
    const rows = nportHoldingRows(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config), await loadUsListings((url, label) => fetchText(url, secHeaders(config), config, label))));
    return { asOfDate: isoToVanEckDate(read.filing.repPdDate), rows, source };
  } catch (error) {
    outputNote(`[ ${'edgar'.padEnd(8)} ] ${ticker}: N-PORT fallback unavailable (${errorMessage(error)})`);
    return null;
  }
}

/** The published meta.json of a fund (null when it has none). */
async function publishedMeta(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path.join(API_ROOT, 'funds', ticker, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** True when a published meta carries at least one 1Y/3Y/5Y/10Y/since-inception figure. */
export function publishedHasTenors(meta: Record<string, unknown> | null): boolean {
  const metrics = (meta?.metrics ?? {}) as Record<string, unknown>;
  return ['tr1y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn'].some((key) => typeof metrics[key] === 'number');
}

/** The published holdings manifest of a fund (null when it has no meta). */
async function publishedHoldings(ticker: string): Promise<{ totalRows?: unknown; asOfDate?: unknown; source?: unknown } | null> {
  try {
    return JSON.parse(await readFile(path.join(API_ROOT, 'funds', ticker, 'meta.json'), 'utf8'))?.holdings ?? null;
  } catch {
    return null;
  }
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
  const isEmptyDownload = (error: unknown) => /: empty download\b/.test(errorMessage(error));
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
  let parsedPage: ParsedFundPage | null = null;
  if (!config.skipVanEck) {
    try {
      const html = await fetchText(vaneckFundPageUrl(ticker), browserHeaders(), config, `${ticker} fund page`);
      parsedPage = parseVanEckFundPage(html, vaneckFundPageUrl(ticker));
    } catch (error) {
      outputNote(`[ ${'product'.padEnd(8)} ] ${ticker}: fund page unavailable (${errorMessage(error)})`);
      failedSources.push('fund page');
    }
  }
  if (parsedPage) {
    entry = applyFundPageSnapshot(entry, parsedPage);
    source.fundPage = parsedPage.fundPage;
    source.holdingsDownload = vaneckHoldingsUrl(parsedPage.fundPage);
    source.navDownload = vaneckHistoryUrl(parsedPage.fundPage);
  }

  // --- holdings ------------------------------------------------------------
  let holdings: ParsedHoldings | null = null;
  const liveVanEck = !config.skipVanEck;
  let holdingsMissing = false;
  if (liveVanEck) {
    try {
      const bytes = await fetchBytes(source.holdingsDownload, browserHeaders(), config, `${ticker} holdings`);
      if (!bytes.length) throw new Error(`${ticker} holdings: empty download (HTTP 200, 0 bytes)`);
      holdings = parseVanEckHoldingsXlsx(bytes);
    } catch (error) {
      // The suspended Russia funds never moved to `/downloads/holdings/`;
      // retry once against the legacy pre-redesign path before giving up.
      try {
        const legacyUrl = vaneckLegacyHoldingsUrl(ticker);
        holdings = parseVanEckHoldingsXlsx(await fetchBytes(legacyUrl, browserHeaders(), config, `${ticker} holdings (legacy)`));
        source.holdingsDownload = legacyUrl;
      } catch (legacyError) {
        outputNote(`[ ${'holdings'.padEnd(8)} ] ${ticker}: holdings unavailable (${errorMessage(error)}; legacy: ${errorMessage(legacyError)})`);
        // A physical metal trust (OUNZ) holds bullion, not securities: its
        // holdings download answers an empty 200. That is an honest absence
        // only while the fund never published holdings; otherwise the
        // download is broken and the published state is kept.
        holdingsMissing = (isNotFound(error) && isNotFound(legacyError))
          || (isEmptyDownload(error) && !(await publishedRowCount(ticker, 'holdings')));
        if (!holdingsMissing) failedSources.push('holdings');
      }
    }
  }
  // EDGAR_FALLBACK: the download failed or is absent -> the fund's newest N-PORT-P filing, only when newer than what is published.
  let holdingsSource = '';
  if (liveVanEck && !holdings && config.edgarFallback) {
    // the filing that is already published is published again unchanged (zero diff); any other one must be newer
    const nport = await fetchNportHoldings(ticker, config);
    if (nport) {
      holdings = { asOfDate: nport.asOfDate, headers: HOLDINGS_HEADERS, rows: nport.rows };
      holdingsSource = nport.source;
      const failed = failedSources.indexOf('holdings');
      if (failed >= 0) failedSources.splice(failed, 1);
    }
  }
  // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone,
  // a sheet without its header row that parses to 0 rows) never replace the published ones: the fund is kept and reported failed.
  // `holdings` is only ever a freshly downloaded sheet here (the previous sheet is never re-read as retention).
  // No relax lets an all-non-numeric weight sheet replace a published sheet with numeric weights (Q24).
  const holdingsProblem = holdings
    ? holdingsGuard(holdings.headers, holdings.rows, await publishedRowCount(ticker, 'holdings'), HOLDINGS_GUARD_RELAX[ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], await publishedWeightCount(ticker))
    : null;
  if (holdingsProblem) throw new Error(`${ticker}: holdings guard: ${holdingsProblem}; kept the previous published state`);
  const holdingsPages = holdings ? chunkRows(toKeyedRows(holdings.headers, holdings.rows), config.holdingsPageSize) : [];
  const holdingsManifest = holdings
    ? planFundPages(ticker, 'holdings', {
        totalRows: holdings.rows.length,
        pageSize: config.holdingsPageSize,
        asOfDate: holdings.asOfDate,
        source: holdingsSource || `VanEck daily holdings download (${source.holdingsDownload})`,
      }, holdingsPages, writes)
    : null;

  // --- history -------------------------------------------------------------
  let history: ParsedHistory | null = null;
  if (liveVanEck) {
    try {
      const parsed = parseVanEckHistoryXlsx(await fetchBytes(source.navDownload, browserHeaders(), config, `${ticker} NAV history`));
      // A sheet without its header row parses to 0 rows. NAV history only grows, so 0 rows after history was published
      // is a broken download: fail the source (the fund keeps its published state) instead of deleting the history pages.
      const published = parsed.rows.length ? 0 : await publishedRowCount(ticker, 'history');
      if (published) throw new Error(`${ticker} NAV history: no rows in the download (${published} published)`);
      history = parsed;
    } catch (error) {
      outputNote(`[ ${'history'.padEnd(8)} ] ${ticker}: NAV history unavailable (${errorMessage(error)})`);
      if (!isNotFound(error)) failedSources.push('NAV history');
    }
  }
  // HISTORY_RANGE bounds only the Yahoo request: the VanEck NAV history download is always complete and a window never
  // shrinks the published history (open-items etfs Q25)
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
  if (!config.skipVanEck && parsedPage?.pageId && parsedPage?.performanceBlockId) {
    try {
      performance = await fetchVanEckPerformance(ticker, parsedPage.pageId, parsedPage.performanceBlockId, config);
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
  // The finder YTD is as of FINDER_MONTH_END_AS_OF: it is stamped with that date (`ytdAsOf`, never the newer performance
  // date) and dropped once the returns are from another calendar year (a 2026 YTD is not a 2027 YTD).
  const ytdReturnsYear = (isoOfStamp(((entry.returns as Record<string, Record<string, unknown>>).monthEnd ?? {}).tenorsAsOf) ?? new Date().toISOString()).slice(0, 4);
  if ((metrics.ytd === null || metrics.ytd === undefined) && finder?.monthEndYtd !== null && finder?.monthEndYtd !== undefined && finderYtdUsable(ytdReturnsYear)) {
    metrics.ytd = finder.monthEndYtd;
    const monthEnd = (entry.returns as Record<string, unknown>).monthEnd as Record<string, unknown>;
    monthEnd.ytd = finder.monthEndYtd;
    monthEnd.ytdText = `${finder.monthEndYtd.toFixed(2)}%`;
    monthEnd.ytdAsOf = formatVanEckDate(FINDER_MONTH_END_AS_OF);
    if (monthEnd.asOfDate === '—') monthEnd.asOfDate = formatVanEckDate(FINDER_MONTH_END_AS_OF);
    metrics.returnsBasis = `${metrics.returnsBasis || 'official VanEck Average Annual Total Returns (NAV)'} + Investment Finder month-end YTD (NAV)`;
  }
  // A performance block that answered without a NAV row (payload change), or a fund page without the block ids
  // (redesign, WAF page answering 200), is a FAILED source when the fund published tenors before: the fund is kept
  // instead of publishing nulls over good returns. A young fund that never had tenors still publishes honest nulls.
  if (liveVanEck && parsedPage && !performance && !failedSources.includes('performance')
    && ['tr1y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn'].every((key) => metrics[key] === null || metrics[key] === undefined)
    && publishedHasTenors(await publishedMeta(ticker))) {
    outputNote(`[ ${'perf'.padEnd(8)} ] ${ticker}: ${parsedPage.pageId && parsedPage.performanceBlockId ? 'performance block has no NAV row' : 'fund page has no performance block id'}; published returns kept`);
    failedSources.push('performance');
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
  if (!config.skipVanEck && parsedPage?.pageId && parsedPage?.distributionsBlockId) {
    vanEckDistributions = await fetchVanEckDistributions(ticker, parsedPage.pageId, parsedPage.distributionsBlockId, config);
  }
  const exDates = vanEckDistributions?.map((d) => d.exDate) ?? null;
  const latestNative = vanEckDistributions && vanEckDistributions.length ? vanEckDistributions[0] : null;
  // One Yahoo chart fetch serves both the distributions fallback and the
  // exchange-name fallback below.
  const yahooChartJson = !config.skipYahoo ? await fetchYahooChartJson(ticker, config) : null;
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
  const navForYield = (entry.navValue ?? entry.closePriceValue) as number | null;
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
    const nasdaq = await fetchNasdaqExchanges(config);
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
  metrics.dividendYieldBasis = dividendYield === null ? null : saneYield(officialDistributionYield) !== null ? 'official-distribution-rate' : 'indicated';
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

  entry = withReturnsMeta(withoutTooYoungTenors(entry));

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
  const startedAt = Date.now();
  outputPrintConfig('VanEck', config);
  const stats: RunStats = { updated: 0, unchanged: 0, skipped: 0, failed: 0 };
  // The published index as it was before this run (rows of earlier runs, catalog-only rows included).
  const indexFile = path.join(API_ROOT, 'index.json');
  let previousRows: CatalogEntry[] = [];
  let previousGeneratedAt = '';
  if (existsSync(indexFile)) {
    try {
      const parsed = JSON.parse(await readFile(indexFile, 'utf8'));
      previousGeneratedAt = String(parsed.generatedAt || '');
      previousRows = Array.isArray(parsed.funds) ? parsed.funds : [];
    } catch {
      previousRows = [];
    }
  }
  // Q27: a TICKERS entry outside the built-in fund list and the published funds stops the run before any request or write.
  const listed = VAN_ECK_SEED.map((seed) => seed.ticker);
  assertKnownTickers(config.tickers.length ? config.tickers : null, knownTickers(listed, previousRows), 'the VanEck catalog or published feed');
  const scope = filterScope(config);
  const cursor = config.maxFetches > 0 ? await readCursor(scope) : null;
  const candidates = selectCandidates(VAN_ECK_SEED, config, cursor);
  console.log(`[ catalog  ] ${VAN_ECK_SEED.length} VanEck ETFs (official VanEck ETF Guide, AUM as of ${AUM_AS_OF_GUIDE})`);
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
  resetSecState();
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
        if (entry) await output.result(seed.ticker, before);
        else await output.result(seed.ticker, before, 'skipped', 'yield/return filter');
      } catch (error) {
        processed += 1;
        await output.result(seed.ticker, before, 'failed', errorMessage(error));
        stats.failed += 1;
      }
    }
  });
  await Promise.all(workers);

  // Catalog: previously published entries are preserved so a bounded or failed
  // run never empties the site (P14/13.5); a catalog-only row the fund list no longer names is dropped.
  const previous: Record<string, CatalogEntry> = {};
  for (const fund of withoutStalePlaceholders(previousRows, listed)) previous[String(fund.ticker)] = fund;
  for (const seed of VAN_ECK_SEED) {
    if (!previous[seed.ticker]) previous[seed.ticker] = seedCatalogEntry(seed);
  }
  for (const [ticker, entry] of byTicker) previous[ticker] = entry;

  // the 52-week range of every row from its published history pages (shared range-52w block)
  const funds = await withRange52w(API_ROOT, markClosedFunds(Object.values(previous).map(withReturnsMeta).map(withDataFile).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker))), CLOSED_FUNDS));
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
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(previousRows, funds));
  for (const line of newFunds) console.log(line);
  if (newFunds.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join('\n')}\n`, 'utf8');

  const statePath = path.join(API_ROOT, 'update-state.json');
  if (config.maxFetches > 0 && candidates.length) {
    await writeFileAtomic(statePath, serialize({ scope, cursor: candidates[candidates.length - 1].ticker }));
  } else if (config.maxFetches === 0 && scope === filterScope(readConfig({})) && existsSync(statePath)) {
    // Only an unfiltered full pass resets the cursor; a TICKERS or filtered run never touches it.
    await rm(statePath);
  }

  console.log(output.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
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

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; an abbreviated or reordered name the
 *   exact key misses through a looser key that must name one company (`nportLooseKey`, Q35: `Lowe's Cos` = `LOWES COMPANIES`,
 *   `SCHWAB CHARLES CORP`); never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/**
 * Abbreviated words of issuer names (open-items etfs Q35) -> one spelling, each seen in N-PORT-P filings of the brands against
 * the SEC company_tickers.json title of the same CUSIP issuer (2026-10-26): `LOWES COS` / `LOWES COMPANIES`, `AMERIPRISE FINL`,
 * `VICI PPTYS`, `TAIWAN SEMICONDUCTOR MFG`, `ZIONS BANCORP NA` / `ZIONS BANCORPORATION NATIONAL ASSOCIATION`. '' drops the word.
 */
function nportLooseWords(): Record<string, string> {
  return {
    COS: '', COMPANIES: '', AND: '', OF: '', NA: '', NATIONAL_ASSOCIATION: '', INCORPORATION: '', REIT: '',
    BANCORPORATION: 'BANCORP', FINL: 'FINANCIAL', PPTYS: 'PROPERTIES', PPTY: 'PROPERTY', MFG: 'MANUFACTURING', GRP: 'GROUP',
    HLDGS: 'HOLDINGS', HLDG: 'HOLDING', INTL: 'INTERNATIONAL', SVCS: 'SERVICES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES',
    SYS: 'SYSTEMS', NATL: 'NATIONAL', RES: 'RESOURCES', RLTY: 'REALTY', INDS: 'INDUSTRIES', INS: 'INSURANCE', BROS: 'BROTHERS', SVGS: 'SAVINGS',
  };
}

/**
 * The second, looser company key (open-items etfs Q35), used only for a row the exact key (`nportNameKey`) left without a
 * ticker: a Bloomberg location or article after a slash dropped (`Charles Schwab Corp/The`, `Energy Fuels Inc/canada`; never a
 * one-word start like `RE/MAX`), abbreviations read as one word (`nportLooseWords`), the share class dropped (the caller picks
 * the class) and the words sorted, so EDGAR's reordered titles meet the usual order: `SCHWAB CHARLES CORP` = `Charles Schwab
 * Corp`, `HORTON D R INC` = `DR Horton Inc`, `PRICE T ROWE GROUP INC` = `T Rowe Price Group Inc`. Several companies can share a
 * loose key: `parseSecCompanyNames` and `parseUsListings` keep such a key empty, so it never gives a ticker.
 */
export function nportLooseKey(value: unknown): string {
  let raw = String(value === null || value === undefined ? '' : value).trim();
  const slash = /^(.*\s\S*[A-Za-z]{2}[.,]?)\s*\/\s*([A-Za-z][A-Za-z .,']*)$/.exec(raw);
  if (slash) raw = slash[1];
  // a trailing EDGAR or Bloomberg qualifier after the legal form: `CHEVRON CORP NEW`, `US BANCORP DEL`, `PROGRESSIVE CORP OHIO`
  raw = raw.replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|CO(?:MPANY)?|LTD|BANCORP|GROUP|GRP|TRUST|HOLDINGS?)\.?,?\s+(?:NEW|DEL|REINCORPORATION|OHIO|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\.?$/i, '$1');
  const words = nportLooseWords();
  const key = nportNameKey(raw).replace(/ CL [A-Z]$/, '').replace(/\bNATIONAL ASSOCIATION\b/g, 'NATIONAL_ASSOCIATION');
  return key.split(' ').map((word) => (Object.prototype.hasOwnProperty.call(words, word) ? words[word] : word)).filter(Boolean).sort().join(' ');
}

/**
 * SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too).
 * Each loose key (`nportLooseKey`) is added as `\u0001<loose key>` -> the company's tickers, space-separated in the table's
 * order, or '' when two companies (CIKs) share it; `nportTickers` reads them for rows the exact key misses.
 */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const loose = new Map<string, { cik: string; tickers: string[] } | null>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown; cik_str?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
    const looseKey = nportLooseKey(row.title);
    const cik = String(row.cik_str === null || row.cik_str === undefined ? '' : row.cik_str).replace(/\D/g, '');
    if (!looseKey || !Number(cik)) continue;
    const seen = loose.get(looseKey);
    if (seen === undefined) loose.set(looseKey, { cik: String(Number(cik)), tickers: [ticker] });
    else if (seen && seen.cik === String(Number(cik))) { if (seen.tickers.indexOf(ticker) < 0) seen.tickers.push(ticker); }
    else loose.set(looseKey, null);
  }
  loose.forEach((seen, looseKey) => names.set(`\u0001${looseKey}`, seen ? seen.tickers.join(' ') : ''));
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
    const looseKey = nportLooseKey(nportIssuerName(name));
    if (looseKey && nportListedCommon(name)) loose.set(looseKey, (loose.get(looseKey) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  loose.forEach((symbols, looseKey) => listings.set(`\u0001${looseKey}`, symbols.join(' ')));
  return listings;
}

/** Is a symbol directory security name a company's own common or ordinary shares (not preferred, depositary, notes, warrants, units, rights)? */
function nportListedCommon(name: string): boolean {
  return !/\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b|\bPREFERRED\b|\bPREF\b|\bPFD\b|\bNOTES?\b|\bDEBENTURES?\b|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|%|\bDUE\s+\d{4}\b|\bPERPETUAL\b|\bCUMULATIVE\b|\bSUBORDINATED\b|\bTRUST\s+(?:SECURITIES|CERTIFICATES)\b|\bETNS?\b|\bEXCHANGE[- ]TRADED\b/i.test(name);
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or title
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Rows still without a
 * ticker get the second, looser name match (`nportLooseTickers`), which never changes a ticker given here. Bonds, cash, funds
 * and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker, key) => { if (key.charAt(0) !== '\u0001') secTickers.add(ticker); });
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  const exact = tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
  return nportLooseTickers(positions, exact, names, listings);
}

/**
 * The second name match (open-items etfs Q35) for the common-stock rows `nportTickers` left without a ticker; the tickers it
 * already gave never change. The row's loose key (`nportLooseKey`) must name one company: in the SEC table (`\u0001` entries of
 * `parseSecCompanyNames`, one CIK) and/or in the symbol directories (`\u0001` entries of `parseUsListings`, common shares only),
 * and when both know the key they must agree on the company. Of that company's tickers only its listed common shares count
 * (with one SEC ticker and no listing, that ticker); several of them (Fox, Lennar, Zillow) need the class the row states in its
 * name or title, matched to the listed security name, else no ticker. A foreign ISIN needs the directory listing of the same
 * key (its own U.S. shares, never depositary ones). A ticker that a row of `exact` holds for another security, or that this pass
 * finds for two securities, is dropped.
 */
function nportLooseTickers(positions: ReadonlyArray<NportPosition>, exact: string[], names: Map<string, string> | null, listings: Map<string, string> | null): string[] {
  if (!names) return exact;
  const companyOf = new Map<string, string>();
  names.forEach((tickers, key) => { if (key.charAt(0) === '\u0001' && tickers) tickers.split(' ').forEach((ticker) => companyOf.set(ticker, key)); });
  const securityOf = (position: NportPosition): string => position.cusip || position.isin || position.other || nportNameKey(position.name);
  const listedClass = (symbol: string): string => nportShareClass(listings ? listings.get(symbol) : '');
  const found = positions.map((position, index) => {
    if (exact[index] || position.assetCat !== 'EC' || position.derivative || nportIsRight(position)) return '';
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    if (foreign ? position.currency !== 'USD' || !listings : position.currency && position.currency !== 'USD') return '';
    if (!/^[0-9A-Z]{9}$/.test(position.cusip) && !/^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) return '';
    const key = nportLooseKey(position.name);
    if (!key) return '';
    const sec = names.get(`\u0001${key}`);
    const listed = listings ? listings.get(`\u0001${key}`) : undefined;
    if (sec === '' || (sec === undefined && listed === undefined) || (foreign && !listed)) return '';
    const listedSymbols = listed ? listed.split(' ') : [];
    // the company: the SEC entry of the key, else the one SEC entry every listed symbol of the key belongs to
    const company = sec !== undefined ? `\u0001${key}` : companyOf.get(listedSymbols[0]) || '';
    if (!company || listedSymbols.some((symbol) => companyOf.get(symbol) !== company)) return '';
    const tickers = String(names.get(company) || '').split(' ').filter(Boolean);
    const common = tickers.filter((ticker) => listings && listings.has(ticker) && nportListedCommon(String(listings.get(ticker))));
    const candidates = common.length ? common : tickers.length === 1 && !foreign ? tickers : [];
    if (foreign && candidates.some((ticker) => listedSymbols.indexOf(ticker) < 0)) return '';
    const wanted = nportShareClass(position.name, position.title);
    if (candidates.length === 1) return !wanted || !listings || !listings.has(candidates[0]) || !listedClass(candidates[0]) || listedClass(candidates[0]) === wanted ? candidates[0] : '';
    const classed = wanted ? candidates.filter((ticker) => listedClass(ticker) === wanted) : [];
    return classed.length === 1 ? classed[0] : '';
  });
  const taken = new Map<string, string[]>();
  exact.forEach((ticker, index) => { if (ticker) taken.set(ticker, (taken.get(ticker) || []).concat(securityOf(positions[index]))); });
  found.forEach((ticker, index) => {
    if (!ticker) return;
    const seen = taken.get(ticker) || [];
    if (seen.indexOf(securityOf(positions[index])) < 0) taken.set(ticker, seen.concat(securityOf(positions[index])));
  });
  return exact.map((ticker, index) => ticker || (found[index] && (taken.get(found[index]) || []).length === 1 ? found[index] : ''));
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>

// <range-52w> shared block of .claude/tools/etfs/etf-std/range-52w.block.ts, applied by apply-block.ts: never edit it in one repo
export type Range52w = {
  week52Low: number | null; week52High: number | null; range52w: number | null; range52wClose: number | null; range52wAsOf: string | null;
  range52wSince: string | null; range52wBasis: string | null;
};

/**
 * The price columns of a history sheet, tried in this order: the market close first, NAV only when no market price is
 * published. A function, not a const: the block sits at the end of update-data.ts, after the top-level `await main()`.
 */
export function range52wColumns(): string[] {
  return ['Close', 'Market Price', 'NAV', 'NAV per Share'];
}

/** The seven `metrics` keys of the 52-week range, all null: a catalog-only row and a fund without history carry this. */
export function range52wEmpty(): Range52w {
  return { week52Low: null, week52High: null, range52w: null, range52wClose: null, range52wAsOf: null, range52wSince: null, range52wBasis: null };
}

/**
 * The 52-week range from the closes of a fund's published history sheet (owner, 2026-10-29: closes, not intraday highs and
 * lows; no extra requests). `headers` are the sheet headers, `rows` objects keyed by header or arrays in header order.
 * - Price column: the first of range52wColumns() with at least two numeric values (`$1,234.50` reads as 1234.5); the date
 *   column is `Date`, else `As Of`, else the first header. Dates go through calendarIso, so every published format works
 * - Window: the last dated close and every close up to 52 weeks (364 days) before it. `week52Low` and `week52High` are the
 *   lowest and highest close of the window, `range52w` the position of the last close between them in percent
 *   (0 = at the low, 100 = at the high, 2 decimals). The last close is part of the window, so it never falls outside;
 *   `range52wClose` and `range52wAsOf` are that close and its date (it can differ from the row's closePrice source)
 * - A fund with less than 52 weeks of history gets the range since its first published close, and `range52wSince` names
 *   that date (owner: "alternative" - the range since launch with a note); a full window has `range52wSince: null`
 * - `range52wBasis` names the column used. Fewer than two closes give range52wEmpty(); a flat window (high = low) keeps
 *   low and high but `range52w: null`, never a made-up 0 or 50
 */
export function range52wMetrics(headers: string[], rows: unknown[]): Range52w {
  const list = Array.isArray(headers) ? headers.map((h) => String(h)) : [];
  const dateHeader = list.indexOf('Date') >= 0 ? 'Date' : list.indexOf('As Of') >= 0 ? 'As Of' : list[0];
  const cell = (row: unknown, header: string): unknown => {
    if (Array.isArray(row)) return row[list.indexOf(header)];
    return row && typeof row === 'object' ? (row as Record<string, unknown>)[header] : undefined;
  };
  const price = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const text = String(value === null || value === undefined ? '' : value).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return number > 0 ? number : null;
  };
  const all = Array.isArray(rows) ? rows : [], columns = range52wColumns();
  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    if (list.indexOf(column) < 0 || !dateHeader) continue;
    const points: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const date = calendarIso(cell(all[i], dateHeader)), close = price(cell(all[i], column));
      if (date && close !== null) points.push({ date, close });
    }
    if (points.length < 2) continue;
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = points[points.length - 1];
    const end = Date.UTC(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)));
    const start = new Date(end - 364 * 86400000).toISOString().slice(0, 10);
    const window = points.filter((p) => p.date >= start);
    if (window.length < 2) continue;
    let low = window[0].close, high = window[0].close;
    for (let i = 1; i < window.length; i++) { low = Math.min(low, window[i].close); high = Math.max(high, window[i].close); }
    const round = (value: number, digits: number): number => Number(value.toFixed(digits));
    return {
      week52Low: round(low, 4), week52High: round(high, 4),
      range52w: high > low ? round(((last.close - low) / (high - low)) * 100, 2) : null, range52wClose: round(last.close, 4), range52wAsOf: last.date,
      range52wSince: points[0].date > start ? points[0].date : null,
      range52wBasis: column,
    };
  }
  return range52wEmpty();
}
/**
 * The index rows with the five 52-week keys in every `metrics`, computed from each fund's published history pages
 * (`funds/<T>/history/*.json` under `feedRoot`, the folder of index.json). Call it on the final rows right before
 * index.json is written: updated, unchanged and kept funds all get the range of the history they publish, a row without
 * `dataFile` or without history pages gets range52wEmpty(). A row without a `metrics` object is left as it is. The seven
 * keys go in front of `returnsBasis` and `performanceAsOf`, so those two stay the last keys of `metrics`.
 */
export async function withRange52w<T>(feedRoot: URL | string, funds: T[]): Promise<T[]> {
  const fs = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const root = feedRoot instanceof URL ? new URL(feedRoot.href.replace(/\/?$/, '/')) : pathToFileURL(String(feedRoot).replace(/\/?$/, '/'));
  const out: T[] = [];
  for (const fund of Array.isArray(funds) ? funds : []) {
    const row = fund as unknown as Record<string, unknown>;
    if (!row || typeof row !== 'object' || !row.metrics || typeof row.metrics !== 'object') { out.push(fund); continue; }
    let range = range52wEmpty();
    const dataFile = typeof row.dataFile === 'string' ? row.dataFile : '';
    if (dataFile) {
      const dir = new URL(`${dataFile.replace(/^\.\//, '').replace(/[^/]*$/, '')}history/`, root);
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /\.json$/.test(name)).sort();
      let headers: string[] = [];
      const rows: unknown[] = [];
      for (const name of names) {
        const page = await fs.readFile(new URL(name, dir), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
        if (!page || !Array.isArray(page.rows)) continue;
        if (!headers.length && Array.isArray(page.headers)) headers = page.headers;
        for (const item of page.rows) rows.push(item);
      }
      range = range52wMetrics(headers, rows);
    }
    // the range keys go in front of returnsBasis and performanceAsOf, which stay the last two keys (metrics contract)
    const metrics: Record<string, unknown> = {}, old = row.metrics as Record<string, unknown>, tail = ['returnsBasis', 'performanceAsOf'];
    for (const key of Object.keys(old)) if (tail.indexOf(key) < 0 && !(key in range)) metrics[key] = old[key];
    Object.assign(metrics, range);
    for (const key of tail) if (key in old) metrics[key] = old[key];
    out.push({ ...row, metrics } as unknown as T);
  }
  return out;
}
// </range-52w>
