/**
 * Live VanEck responses captured during the S0 reconnaissance on 2026-09-19.
 *
 * Why this file exists: the sandbox the feed was first built in has no direct
 * network egress, so the updater could not be run against vaneck.com from
 * there. These are the real, verbatim server responses for a bounded set of
 * funds, kept as a replayable snapshot so `bun ./scripts/update-data.ts` can
 * produce a byte-identical feed offline and so the parsers have real input to
 * be tested against. A run with network access (`OFFLINE_SEED=0`) overwrites
 * every field here from the live endpoints and keeps this file only as the
 * fallback, exactly like the catalog fallback in the sibling updaters.
 *
 * Everything here was read from:
 *   https://www.vaneck.com/us/en/investments/<slug>/                     (fund header)
 *   https://www.vaneck.com/us/en/investments/<slug>/downloads/holdings/  (daily holdings)
 *   https://www.vaneck.com/us/en/investments/<slug>/downloads/fundhistoprices/ (NAV history)
 *
 * Nothing in this file is estimated, interpolated or copied from another
 * provider. Cells VanEck printed as "--" are stored as null.
 */

export const SNAPSHOT_READ_AT = '2026-09-19T00:00:00.000Z';

/** Fund-page header block, exactly as the server-rendered page prints it. */
export type FundPageSnapshot = {
  /** Canonical fund page URL after VanEck's ticker redirect. */
  fundPage: string;
  /** Fund name as printed in the page H1 ("VanEck Gold Miners ETF"). */
  fundName: string;
  /** Breadcrumb category the fund page itself files the fund under. */
  breadcrumb: string;
  nav: number | null;
  navAsOf: string | null;
  ytdReturn: number | null;
  ytdAsOf: string | null;
  totalNetAssets: number | null;
  totalNetAssetsAsOf: string | null;
  /** Printed as "Gross Expense Ratio"/"Net Expense Ratio" or "Total Expense Ratio". */
  grossExpenseRatio: number | null;
  netExpenseRatio: number | null;
  totalExpenseRatio: number | null;
  inceptionDate: string | null;
};

export const FUND_PAGE_SNAPSHOTS: Record<string, FundPageSnapshot> = {
  GDX: {
    fundPage: 'https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/',
    fundName: 'VanEck Gold Miners ETF',
    breadcrumb: 'Equity ETFs',
    nav: 95.67,
    navAsOf: '09/18/2026',
    ytdReturn: 11.22,
    ytdAsOf: '09/18/2026',
    totalNetAssets: 28420000000,
    totalNetAssetsAsOf: '09/18/2026',
    grossExpenseRatio: 0.51,
    netExpenseRatio: 0.51,
    totalExpenseRatio: null,
    inceptionDate: '05/16/2006',
  },
  SMH: {
    fundPage: 'https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/',
    fundName: 'VanEck Semiconductor ETF',
    breadcrumb: 'Equity ETFs',
    nav: 572.84,
    navAsOf: '09/18/2026',
    ytdReturn: 59.07,
    ytdAsOf: '09/18/2026',
    totalNetAssets: 74060000000,
    totalNetAssetsAsOf: '09/18/2026',
    grossExpenseRatio: null,
    netExpenseRatio: null,
    totalExpenseRatio: 0.35,
    inceptionDate: '12/20/2011',
  },
};

/**
 * Equity-sheet columns, in VanEck's own order:
 *   Number | Ticker | Holding Name | Identifier (FIGI) | Shares | Asset Class
 *   | Market Value (US$) | Notional Value | % of Net Assets
 * Rows are stored without the leading Number and without the trailing
 * Notional Value, which VanEck prints as "--" for every equity position.
 */
export type EquityHoldingTuple = [
  ticker: string,
  name: string,
  figi: string,
  shares: string,
  assetClass: string,
  marketValue: string,
  weight: string,
];

export type EquityHoldingsSnapshot = { asOf: string; rows: EquityHoldingTuple[] };

export const EQUITY_HOLDINGS_SNAPSHOTS: Record<string, EquityHoldingsSnapshot> = {
  GDX: {
    asOf: '09/17/2026',
    rows: [
      ['NEM', 'Newmont Corp', 'BBG000BPWXK1', '24,875,719', 'Stock', '$3,094,290,686.41', '10.89%'],
      ['AEM', 'Agnico Eagle Mines Ltd', 'BBG000DLVDK3', '15,345,054', 'Stock', '$3,090,033,523.98', '10.87%'],
      ['B', 'Barrick Mining Corp', 'BBG000BB07P9', '48,288,794', 'Stock', '$2,109,737,409.86', '7.42%'],
      ['WPM', 'Wheaton Precious Metals Corp', 'BBG000PVRDL2', '11,138,785', 'Stock', '$1,695,323,077.00', '5.96%'],
      ['AU', 'Anglogold Ashanti Plc', 'BBG01HGVLP51', '13,910,690', 'Stock', '$1,423,898,228.40', '5.01%'],
      ['FNV', 'Franco-Nevada Corp', 'BBG000RD3CL8', '5,236,370', 'Stock', '$1,396,016,242.00', '4.91%'],
      ['KGC', 'Kinross Gold Corp', 'BBG000BB2DM7', '41,522,251', 'Stock', '$1,182,968,930.99', '4.16%'],
      ['GFI', 'Gold Fields Ltd', 'BBG000KHT4K7', '27,027,223', 'Stock', '$1,171,359,844.82', '4.12%'],
      ['PAAS', 'Pan American Silver Corp', 'BBG000C0RGY3', '14,815,764', 'Stock', '$735,158,209.68', '2.59%'],
      ['NST AU', 'Northern Star Resources Ltd', 'BBG000C82NF9', '44,359,047', 'Stock', '$691,791,701.77', '2.43%'],
      ['CDE', 'Coeur Mining Inc', 'BBG000BF8TF5', '32,523,124', 'Stock', '$649,812,017.52', '2.29%'],
      ['RGLD', 'Royal Gold Inc', 'BBG000BS5170', '2,176,420', 'Stock', '$547,260,809.00', '1.93%'],
      ['AGI', 'Alamos Gold Inc', 'BBG009HT6BL4', '13,897,819', 'Stock', '$496,986,007.44', '1.75%'],
      ['EQX', 'Equinox Gold Corp', 'BBG004XB7MN9', '38,382,050', 'Stock', '$469,028,651.00', '1.65%'],
      ['EVN AU', 'Evolution Mining Ltd', 'BBG000NF2249', '44,529,551', 'Stock', '$420,121,202.35', '1.48%'],
      ['PE&OLES* MF', 'Industrias Penoles Sab De Cv', 'BBG000LXSKQ0', '7,728,008', 'Stock', '$394,841,076.29', '1.39%'],
      ['EDV LN', 'Endeavour Mining Plc', 'BBG011DVVYT3', '6,316,092', 'Stock', '$393,261,714.15', '1.38%'],
      ['IAG', 'Iamgold Corp', 'BBG000LL9LQ5', '19,367,961', 'Stock', '$390,458,093.76', '1.37%'],
      ['HL', 'Hecla Mining Co', 'BBG000BL5W86', '19,976,158', 'Stock', '$378,747,955.68', '1.33%'],
      ['EGO', 'Eldorado Gold Corp', 'BBG000BN7277', '8,723,166', 'Stock', '$369,775,006.74', '1.30%'],
      ['AG', 'First Majestic Silver Corp', 'BBG000CH7WB8', '18,761,064', 'Stock', '$365,653,137.36', '1.29%'],
      ['GMIN CN', 'G Mining Ventures Corp', 'BBG01NT389N7', '9,438,386', 'Stock', '$335,723,521.61', '1.18%'],
      ['HMY', 'Harmony Gold Mining Co Ltd', 'BBG000BX93G1', '15,805,088', 'Stock', '$315,785,658.24', '1.11%'],
      ['2259 HK', 'Zijin Gold International Co Ltd', 'BBG01X5DL8L8', '15,501,800', 'Stock', '$308,521,889.08', '1.09%'],
      ['FRES LN', 'Fresnillo Plc', 'BBG000VH0TC0', '6,720,640', 'Stock', '$304,975,881.45', '1.07%'],
      ['LUG CN', 'Lundin Gold Inc', 'BBG000BZYV49', '4,201,476', 'Stock', '$274,200,642.96', '0.96%'],
      ['DPM CN', 'Dundee Precious Metals Inc', 'BBG000G9HTM6', '6,320,359', 'Stock', '$265,394,976.63', '0.93%'],
      ['BTG', 'B2gold Corp', 'BBG000V9KFD5', '47,951,548', 'Stock', '$258,938,359.20', '0.91%'],
      ['DSV CN', 'Discovery Mining Ltd', 'BBG000BS3HY7', '27,837,948', 'Stock', '$244,215,223.22', '0.86%'],
      ['OGC', 'Oceanagold Corp', 'BBG000TT7MW3', '8,423,271', 'Stock', '$243,179,833.77', '0.86%'],
      ['SSRM', 'Ssr Mining Inc', 'BBG000C0RWX9', '6,608,932', 'Stock', '$238,879,847.14', '0.84%'],
      ['BVN', 'Cia De Minas Buenaventura Saa', 'BBG000GPXR82', '5,976,260', 'Stock', '$207,435,984.60', '0.73%'],
      ['AMMN IJ', 'Amman Mineral Internasional Pt', 'BBG01GVLB759', '701,744,300', 'Stock', '$194,910,571.10', '0.69%'],
      ['OR', 'Or Royalties Inc', 'BBG006NTSJ78', '5,119,007', 'Stock', '$189,352,068.93', '0.67%'],
      ['PRU AU', 'Perseus Mining Ltd', 'BBG000Q68231', '41,015,219', 'Stock', '$188,764,320.75', '0.66%'],
      ['1818 HK', 'Zhaojin Mining Industry Co Ltd', 'BBG000DQ77W9', '67,937,500', 'Stock', '$178,409,634.27', '0.63%'],
      ['MAU CN', 'Montage Gold Corp', 'BBG00XKLZFZ8', '11,832,326', 'Stock', '$168,434,998.51', '0.59%'],
      ['ARTG CN', 'Artemis Gold Inc', 'BBG00PSSBKG8', '5,687,111', 'Stock', '$167,647,078.63', '0.59%'],
      ['KNT CN', 'K92 Mining Inc', 'BBG0018BVXB5', '7,908,878', 'Stock', '$163,871,793.83', '0.58%'],
      ['GMD AU', 'Genesis Minerals Ltd', 'BBG000J9HXY1', '30,242,292', 'Stock', '$156,974,686.84', '0.55%'],
      ['RMS AU', 'Ramelius Resources Ltd', 'BBG000PMB297', '61,974,793', 'Stock', '$154,330,910.26', '0.54%'],
      ['AYA CN', 'Aya Gold & Silver Inc', 'BBG000FTVZM3', '5,336,809', 'Stock', '$153,810,296.21', '0.54%'],
      ['ARIS', 'Aris Mining Corp', 'BBG000K0VQL1', '7,940,984', 'Stock', '$150,481,646.80', '0.53%'],
      ['CGAU', 'Centerra Gold Inc', 'BBG000QWM2M7', '6,405,936', 'Stock', '$145,735,044.36', '0.51%'],
      ['VAU AU', 'Vault Minerals Ltd', 'BBG000H39TV7', '32,952,773', 'Stock', '$142,194,868.84', '0.50%'],
      ['AUGO', 'Aura Minerals Inc', 'BBG000QCHWC2', '1,594,284', 'Stock', '$141,428,933.64', '0.50%'],
      ['TXG CN', 'Torex Gold Resources Inc', 'BBG000BSWRQ2', '2,857,484', 'Stock', '$139,579,814.02', '0.49%'],
      ['GGP AU', 'Greatland Resources Ltd', 'BBG01V7BTM08', '18,419,424', 'Stock', '$138,941,862.62', '0.49%'],
      ['WDO CN', 'Wesdome Gold Mines Ltd/Canada', 'BBG000DKQDS3', '5,520,902', 'Stock', '$137,247,890.85', '0.48%'],
      ['CMM AU', 'Capricorn Metals Ltd', 'BBG000C0X7Y6', '13,037,828', 'Stock', '$135,274,080.74', '0.48%'],
      ['BRMS IJ', 'Bumi Resources Minerals Tbk Pt', 'BBG0018R2541', '3,224,770,000', 'Stock', '$134,416,998.14', '0.47%'],
      ['FSM', 'Fortuna Silver Mines Inc', 'BBG000LDZ482', '10,960,528', 'Stock', '$130,649,493.76', '0.46%'],
      ['RRL AU', 'Regis Resources Ltd', 'BBG000BLX2J9', '23,180,135', 'Stock', '$125,856,637.68', '0.44%'],
      ['SKE', 'Skeena Resources Ltd', 'BBG000FCR8D5', '3,927,597', 'Stock', '$122,776,682.22', '0.43%'],
      ['EXK', 'Endeavour Silver Corp', 'BBG000K2HB18', '10,527,829', 'Stock', '$107,068,020.93', '0.38%'],
      ['SA', 'Seabridge Gold Inc', 'BBG000JYQX30', '3,427,976', 'Stock', '$105,855,898.88', '0.37%'],
      ['SVM', 'Silvercorp Metals Inc', 'BBG000CY5S22', '8,417,104', 'Stock', '$102,267,813.60', '0.36%'],
      ['WGX AU', 'Westgold Resources Ltd', 'BBG000BG27F7', '25,795,302', 'Stock', '$99,202,863.23', '0.35%'],
      ['HOC LN', 'Hochschild Mining Plc', 'BBG000Q49X82', '12,130,259', 'Stock', '$97,494,808.80', '0.34%'],
      ['-USD CASH-', '', '', '56,749,678', 'Cash Bal', '$56,749,677.93', '0.20%'],
      ['-IDR CASH-', '', '', '1', 'Cash Bal', '$.00', '0.00%'],
      ['-HKD CASH-', '', '', '--', 'Cash Bal', '$-.01', '0.00%'],
      ['-GBP CASH-', '', '', '31', 'Cash Bal', '$41.58', '0.00%'],
      ['-EUR CASH-', '', '', '--', 'Cash Bal', '$-.05', '0.00%'],
      ['-CAD CASH-', '', '', '-2,927', 'Cash Bal', '$-2,092.58', '0.00%'],
      ['--', 'Other/Cash', '--', '--', 'Cash', '$31,792,656.80', '0.11%'],
    ],
  },
  SMH: {
    asOf: '09/17/2026',
    rows: [
      ['NVDA', 'Nvidia Corp', 'BBG000BBJQV0', '74,080,493', 'Stock', '$16,248,815,334.62', '22.42%'],
      ['TSM', 'Taiwan Semiconductor Manufacturing Co L', 'BBG000BD8ZK0', '16,512,856', 'Stock', '$7,104,821,422.56', '9.80%'],
      ['AMD', 'Advanced Micro Devices Inc', 'BBG000BBQCY0', '8,195,528', 'Stock', '$4,467,300,357.52', '6.16%'],
      ['AVGO', 'Broadcom Inc', 'BBG00KHY5S69', '11,840,578', 'Stock', '$4,112,232,739.40', '5.67%'],
      ['MU', 'Micron Technology Inc', 'BBG000C5Z1S3', '4,156,962', 'Stock', '$4,063,430,355.00', '5.61%'],
      ['ASML', 'Asml Holding Nv', 'BBG000K6MRN4', '2,140,936', 'Stock', '$3,489,019,171.12', '4.81%'],
      ['INTC', 'Intel Corp', 'BBG000C0G1D1', '31,336,507', 'Stock', '$3,409,411,961.60', '4.70%'],
      ['QCOM', 'Qualcomm Inc', 'BBG000CGC1X8', '17,146,076', 'Stock', '$3,235,636,001.96', '4.46%'],
      ['MRVL', 'Marvell Technology Inc', 'BBG00ZXBJ153', '13,280,495', 'Stock', '$3,197,411,976.20', '4.41%'],
      ['ADI', 'Analog Devices Inc', 'BBG000BB6G37', '8,522,959', 'Stock', '$3,090,851,081.35', '4.26%'],
      ['TXN', 'Texas Instruments Inc', 'BBG000BVV7G1', '11,895,062', 'Stock', '$3,070,591,304.68', '4.24%'],
      ['AMAT', 'Applied Materials Inc', 'BBG000BBPFB9', '6,749,358', 'Stock', '$2,817,182,029.20', '3.89%'],
      ['LRCX', 'Lam Research Corp', 'BBG000BNFLM9', '10,422,404', 'Stock', '$2,806,857,621.24', '3.87%'],
      ['KLAC', 'Kla Corp', 'BBG000BMTFR4', '15,704,336', 'Stock', '$2,653,718,697.28', '3.66%'],
      ['CDNS', 'Cadence Design Systems Inc', 'BBG000C13CD9', '4,848,636', 'Stock', '$1,361,303,043.36', '1.88%'],
      ['SNPS', 'Synopsys Inc', 'BBG000BSFRF3', '3,407,927', 'Stock', '$1,298,999,534.59', '1.79%'],
      ['TER', 'Teradyne Inc', 'BBG000BV4DR6', '2,616,037', 'Stock', '$923,801,145.81', '1.27%'],
      ['MPWR', 'Monolithic Power Systems Inc', 'BBG000C30L48', '746,080', 'Stock', '$872,600,246.40', '1.20%'],
      ['NXPI', 'Nxp Semiconductors Nv', 'BBG000BND699', '3,456,302', 'Stock', '$787,864,040.90', '1.09%'],
      ['ARM', 'Arm Holdings Plc', 'BBG01J1GXZF0', '2,788,181', 'Stock', '$738,589,146.90', '1.02%'],
      ['STM', 'Stmicroelectronics Nv', 'BBG000BD4GX2', '14,240,509', 'Stock', '$692,231,142.49', '0.96%'],
      ['ALAB', 'Astera Labs Inc', 'BBG00TDKHW99', '2,237,343', 'Stock', '$656,794,411.08', '0.91%'],
      ['MCHP', 'Microchip Technology Inc', 'BBG000BHCP19', '8,353,835', 'Stock', '$591,618,594.70', '0.82%'],
      ['ON', 'On Semiconductor Corp', 'BBG000DV7MX4', '5,187,306', 'Stock', '$354,292,999.80', '0.49%'],
      ['SKHYV', 'Sk Hynix Inc', 'BBG0238L5JS9', '1,314,144', 'Stock', '$240,808,985.24', '0.33%'],
      ['SWKS', 'Skyworks Solutions Inc', 'BBG000KLB4Q1', '1,915,977', 'Stock', '$174,967,019.64', '0.24%'],
      ['-USD CASH-', '', '', '-15,402,357', 'Cash Bal', '$-15,402,357.31', '-0.02%'],
      ['--', 'Other/Cash', '--', '--', 'Cash', '$39,510,865.94', '0.05%'],
    ],
  },
  OIH: {
    asOf: '09/17/2026',
    rows: [
      ['SLB', 'Schlumberger Nv', 'BBG000BT41Q8', '7,913,058', 'Stock', '$412,112,060.64', '19.76%'],
      ['BKR', 'Baker Hughes Co', 'BBG00GBVBK51', '4,137,861', 'Stock', '$234,058,107.47', '11.22%'],
      ['FTI', 'Technipfmc Plc', 'BBG00DL8NMV2', '2,032,510', 'Stock', '$147,844,777.40', '7.09%'],
      ['HAL', 'Halliburton Co', 'BBG000BKTFN2', '3,677,971', 'Stock', '$125,161,353.13', '6.00%'],
      ['TS', 'Tenaris Sa', 'BBG000PLD4R3', '1,786,462', 'Stock', '$100,970,832.24', '4.84%'],
      ['RIG', 'Transocean Ltd', 'BBG000BH5LT6', '16,444,623', 'Stock', '$93,076,566.18', '4.46%'],
      ['NE', 'Noble Corp Plc', 'BBG018KBK3G8', '2,057,617', 'Stock', '$90,905,519.06', '4.36%'],
      ['SEI', 'Solaris Energy Infrastructure Inc', 'BBG00G7D6C05', '1,250,596', 'Stock', '$86,566,255.12', '4.15%'],
      ['WFRD', 'Weatherford International Plc', 'BBG00R4SQJ13', '1,008,391', 'Stock', '$82,738,481.55', '3.97%'],
      ['NOV', 'Nov Inc', 'BBG000BJX8C8', '3,755,184', 'Stock', '$77,093,927.52', '3.70%'],
      ['PTEN', 'Patterson-Uti Energy Inc', 'BBG000BKXFN7', '6,096,684', 'Stock', '$73,343,108.52', '3.52%'],
      ['OII', 'Oceaneering International Inc', 'BBG000CPBCL8', '1,553,370', 'Stock', '$71,765,694.00', '3.44%'],
      ['WHD', 'Cactus Inc', 'BBG00JRH1P95', '1,064,186', 'Stock', '$71,577,150.36', '3.43%'],
      ['VAL', 'Valaris Ltd', 'BBG010JW9K49', '825,715', 'Stock', '$69,401,345.75', '3.33%'],
      ['HP', 'Helmerich & Payne Inc', 'BBG000BLCPY4', '1,483,317', 'Stock', '$61,498,322.82', '2.95%'],
      ['TDW', 'Tidewater Inc', 'BBG00HBQ35R8', '653,466', 'Stock', '$57,393,918.78', '2.75%'],
      ['LBRT', 'Liberty Energy Inc', 'BBG00GK831B6', '2,700,283', 'Stock', '$51,602,408.13', '2.47%'],
      ['WTTR', 'Select Energy Services Inc', 'BBG00G4Y2DC1', '2,208,948', 'Stock', '$44,974,181.28', '2.16%'],
      ['NBR', 'Nabors Industries Ltd', 'BBG000BZTW70', '280,831', 'Stock', '$24,390,172.35', '1.17%'],
      ['PUMP', 'Propetro Holding Corp', 'BBG00FYCQ352', '2,088,584', 'Stock', '$21,846,588.64', '1.05%'],
      ['INVX', 'Dril-Quip Inc', 'BBG000BVDBY2', '719,455', 'Stock', '$20,986,502.35', '1.01%'],
      ['HOS', 'Hornbeck Offshore Services Inc', 'BBG000J7Q1L9', '2,329,737', 'Stock', '$19,989,143.46', '0.96%'],
      // XPRO is published with an empty Identifier (FIGI) cell — a real gap in
      // the VanEck file, kept as null rather than backfilled.
      ['XPRO', 'Expro Group Holdings Nv', '', '1,186,495', 'Stock', '$19,458,518.00', '0.93%'],
      ['RES', 'Rpc Inc', 'BBG000BS3047', '2,858,401', 'Stock', '$16,950,317.93', '0.81%'],
      ['CLB', 'Core Laboratories Inc', 'BBG01GG28WR3', '336,510', 'Stock', '$3,836,214.00', '0.18%'],
      ['-USD CASH-', '', '', '2,126,916', 'Cash Bal', '$2,126,916.31', '0.10%'],
      ['--', 'Other/Cash', '--', '--', 'Cash', '$3,575,401.85', '0.17%'],
    ],
  },
};

/**
 * NAV & Premium/Discount history rows, in VanEck's own column order:
 *   Date | NAV | Change | % Change | Last Trade | Volume | Premium/Discount
 *   | % Premium/Discount | AUM | Index Level
 *
 * BOUNDED SNAPSHOT: VanEck serves the complete daily series from inception
 * (GDX's is ~7,000 rows); only the most recent window captured during the S0
 * reconnaissance is replayed here. `scripts/update-data.test.ts` asserts the
 * internal consistency of every row (previous NAV + Change reproduces the
 * current NAV, and (Last Trade - NAV)/NAV reproduces the printed
 * premium/discount), so a transcription slip fails the build instead of
 * reaching the feed. A networked run replaces this with the full range
 * controlled by HISTORY_RANGE.
 */
export type HistoryTuple = [
  date: string,
  nav: number,
  change: number,
  changePct: number,
  lastTrade: number,
  volume: string,
  premDisc: number,
  premDiscPct: number,
  aum: number,
  indexLevel: number,
];

export type HistorySnapshot = { rows: HistoryTuple[] };

export const HISTORY_SNAPSHOTS: Record<string, HistorySnapshot> = {
  GDX: {
    rows: [
      ['09/18/2026', 95.6685, -0.02, -0.02, 95.48, '18,486,784', -0.19, -0.2, 28418567995.87, 3409.21],
      ['09/17/2026', 95.6912, 2.8, 3.02, 95.92, '21,054,405', 0.23, 0.24, 28473141532.65, 3405.69],
      ['09/16/2026', 92.8876, -1.32, -1.4, 92.8, '26,967,033', -0.09, -0.09, 27741115519.75, 3318.82],
      ['09/15/2026', 94.2098, -0.27, -0.28, 94.13, '13,883,544', -0.08, -0.08, 28296143051.53, 3352.2],
      ['09/14/2026', 94.4773, -2.5, -2.58, 94.14, '23,596,304', -0.34, -0.36, 28376504784.4, 3366.53],
      ['09/13/2026', 96.9767, 0.0, 0, 97.1, '', 0.12, 0.13, 29127207630.9, 3456.84],
      ['09/12/2026', 96.9767, 0.0, 0, 97.1, '', 0.12, 0.13, 29127207630.9, 3456.84],
      ['09/11/2026', 96.9767, 0.64, 0.66, 97.1, '14,297,483', 0.12, 0.13, 29127207630.9, 3456.84],
      ['09/10/2026', 96.3416, -3.03, -3.05, 96.03, '21,799,734', -0.31, -0.32, 28960512080.63, 3440.25],
      ['09/09/2026', 99.3718, 0.81, 0.82, 99.47, '15,067,565', 0.1, 0.1, 29926071976.8, 3545.22],
      ['09/08/2026', 98.5625, -0.97, -0.98, 98.41, '12,473,553', -0.15, -0.15, 29948466677.41, 3514.52],
      ['09/07/2026', 99.5372, 0.0, 0, 99.26, '21,529,057', -0.28, -0.28, 30264518419.7, 3542.7],
      ['09/06/2026', 99.5372, 0.0, 0, 99.26, '', -0.28, -0.28, 30264518419.7, 3546.02],
      ['09/05/2026', 99.5372, 0.0, 0, 99.26, '', -0.28, -0.28, 30264518419.7, 3546.02],
      ['09/04/2026', 99.5372, -1.76, -1.74, 99.26, '21,512,593', -0.28, -0.28, 30264518419.7, 3546.02],
      ['09/03/2026', 101.2995, 3.96, 4.07, 101.49, '29,122,555', 0.19, 0.19, 30800360921.77, 3602.54],
      ['09/02/2026', 97.3406, 2.31, 2.43, 97.63, '22,480,113', 0.29, 0.3, 29767010480.14, 3464.49],
      ['09/01/2026', 95.0276, -3.63, -3.67, 94.67, '31,218,761', -0.36, -0.38, 29206957830.82, 3394.15],
      ['08/31/2026', 98.6526, -1.37, -1.37, 98.51, '17,463,887', -0.14, -0.14, 30543091933.14, 3516.61],
      ['08/30/2026', 100.0239, 0.0, 0, 99.65, '', -0.37, -0.37, 30972642684.54, 3577.12],
      ['08/29/2026', 100.0239, 0.0, 0, 99.65, '', -0.37, -0.37, 30972642684.54, 3577.12],
      ['08/28/2026', 100.0239, -3.62, -3.49, 99.65, '40,949,280', -0.37, -0.37, 30972642684.54, 3577.12],
      ['08/27/2026', 103.6432, 0.96, 0.94, 103.69, '16,821,267', 0.05, 0.05, 32093375632.48, 3690.54],
      ['08/26/2026', 102.6807, -3.03, -2.86, 102.42, '23,796,262', -0.26, -0.25, 31846687365.63, 3661.63],
      ['08/25/2026', 105.7085, 2.1, 2.03, 105.52, '25,992,989', -0.19, -0.18, 32849178813.88, 3756.89],
      ['08/24/2026', 103.6056, 0.69, 0.67, 103.54, '22,727,761', -0.07, -0.06, 32247511055.08, 3689.89],
      ['08/23/2026', 102.9192, 0.0, 0, 102.83, '', -0.09, -0.09, 31982385496.55, 3660.45],
      ['08/22/2026', 102.9192, 0.0, 0, 102.83, '', -0.09, -0.09, 31982385496.55, 3660.45],
      ['08/21/2026', 102.9192, 3.07, 3.07, 102.83, '33,559,727', -0.09, -0.09, 31982385496.55, 3660.45],
      ['08/20/2026', 99.8525, 2.95, 3.05, 99.85, '33,325,958', 0.0, -0.0, 31039384688.43, 3553.42],
      ['08/19/2026', 96.8998, 7.66, 8.58, 97.33, '44,268,465', 0.43, 0.44, 30160316572.15, 3440.29],
      ['08/18/2026', 89.2448, -2.55, -2.78, 88.95, '22,420,918', -0.29, -0.33, 27777667744.65, 3184.59],
      ['08/17/2026', 91.7923, 1.82, 2.03, 91.89, '17,076,235', 0.1, 0.11, 28575165061.94, 3268.05],
    ],
  },
};
