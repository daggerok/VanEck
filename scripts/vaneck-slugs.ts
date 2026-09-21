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
