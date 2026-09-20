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
