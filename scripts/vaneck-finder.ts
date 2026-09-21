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
