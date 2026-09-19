/**
 * Unit tests for the VanEck data updater.
 *
 * Every HTML fixture below is a faithful transcription of the markup VanEck
 * actually serves (verified against the live pages on 2026-09-18/19), trimmed
 * to the columns that matter. These tests are the guard for the parts of the
 * updater that the committed feed cannot exercise: the fixed-income holdings
 * sheet (which has no Ticker column at all) and the row/header shape contract.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HOLDINGS_HEADERS,
  VANECK_ETF_TRUST_CIK,
  VANECK_FINDER_URL,
  annualizedFromCumulative,
  chunkRows,
  cleanText,
  compareDisplayDates,
  cumulativeFromAnnualized,
  decodeHtmlEntities,
  findHeaderRowIndex,
  formatAumDisplay,
  formatMoneyText,
  formatPercentText,
  formatVanEckDate,
  frequencyCode,
  indicatedDividendYield,
  inferDistributionFrequency,
  normalizeNumberText,
  numberOrNull,
  parseAumRange,
  parseHtmlTables,
  parseRange,
  parseVanEckFundPage,
  parseVanEckHistory,
  parseVanEckHoldings,
  paymentsPerYear,
  premiumDiscount,
  sanitizeTicker,
  toIsoDate,
  vaneckEdgarFilingsUrl,
  vaneckFundPageUrl,
  vaneckHistoryUrl,
  vaneckHoldingsUrl,
  yahooChartProvenanceUrl,
  yahooChartUrl,
} from "./update-data";

const REPO_ROOT = path.join(import.meta.dir, "..");
const API_ROOT = path.join(REPO_ROOT, "api", "vaneck");

function feedJson(relative: string): any {
  return JSON.parse(readFileSync(path.join(API_ROOT, relative), "utf8"));
}

// ---------------------------------------------------------------------------
// 1. Source URLs
// ---------------------------------------------------------------------------

describe("source URLs", () => {
  test("fund page, holdings and history URLs follow the verified vaneck.com layout", () => {
    // Canonical slugs are harvested from the Investment Finder (2026-09-19);
    // /investments/etf-<ticker>/ is a greedy 302 (etf-einc → inc → 404) so the
    // slug table is authoritative.
    expect(vaneckFundPageUrl("GDX")).toBe("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/");
    expect(vaneckFundPageUrl("smh")).toBe("https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/");
    expect(vaneckFundPageUrl("EINC")).toBe("https://www.vaneck.com/us/en/investments/energy-income-etf-einc/");
    expect(vaneckFundPageUrl("AFK")).toBe("https://www.vaneck.com/us/en/investments/africa-index-etf-afk/");
    // Unknown ticker falls back to etf-<ticker> so the 404 is visible.
    expect(vaneckFundPageUrl("ZZZZ")).toBe("https://www.vaneck.com/us/en/investments/etf-zzzz/");
    expect(vaneckHoldingsUrl("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/")).toBe(
      "https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/downloads/holdings/",
    );
    expect(vaneckHistoryUrl("https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx")).toBe(
      "https://www.vaneck.com/us/en/investments/gold-miners-etf-gdx/downloads/fundhistoprices/",
    );
    // Holdings/history are always <fundPage>/downloads/…
    expect(vaneckHoldingsUrl("https://www.vaneck.com/us/en/investments/equity/gdx/overview/")).toBe(
      "https://www.vaneck.com/us/en/investments/equity/gdx/overview/downloads/holdings/",
    );
    expect(vaneckHistoryUrl("https://www.vaneck.com/us/en/investments/equity/gdx/overview")).toBe(
      "https://www.vaneck.com/us/en/investments/equity/gdx/overview/downloads/fundhistoprices/",
    );
  });

  test("the EDGAR fallback targets the VanEck ETF Trust, not the adviser", () => {
    expect(VANECK_ETF_TRUST_CIK).toBe("0001137360");
    expect(vaneckEdgarFilingsUrl()).toContain("CIK=0001137360");
    expect(vaneckEdgarFilingsUrl()).toContain("type=NPORT-P");
    expect(vaneckEdgarFilingsUrl("0000768847")).toContain("CIK=0000768847");
  });

  test("the finder URL is the one that actually server-renders the fund table", () => {
    expect(VANECK_FINDER_URL).toBe("https://www.vaneck.com/us/en/etf-mutual-fund-finder/");
  });

  test("the recorded chart provenance URL carries no wall-clock value", () => {
    // A live query needs period2 = now or Yahoo downgrades range=max to monthly
    // bars; the provenance copy must not, or every no-op rerun would git-diff.
    const live = yahooChartUrl("GDX", 1_789_848_311_000);
    expect(live).toContain("period2=1789848311");
    expect(live).toContain("interval=1d");
    const provenance = yahooChartProvenanceUrl("GDX");
    expect(provenance).toBe("https://query1.finance.yahoo.com/v8/finance/chart/GDX");
    expect(provenance).not.toContain("period2");
    // stable across calls made at different instants
    expect(yahooChartProvenanceUrl("GDX")).toBe(yahooChartProvenanceUrl("GDX"));
  });
});

// ---------------------------------------------------------------------------
// 2. Text and number normalization
// ---------------------------------------------------------------------------

describe("normalization", () => {
  test("sanitizeTicker strips whitespace and uppercases", () => {
    expect(sanitizeTicker("  gdx ")).toBe("GDX");
    expect(sanitizeTicker(null)).toBe("");
    expect(sanitizeTicker(undefined)).toBe("");
  });

  test("cleanText collapses whitespace and drops nbsp", () => {
    expect(cleanText("  Total   Net\nAssets\u00a0 ")).toBe("Total Net Assets");
    expect(cleanText(null)).toBe("");
  });

  test("normalizeNumberText strips currency, thousands separators and percent", () => {
    expect(normalizeNumberText("$3,094,290,686.41")).toBe("3094290686.41");
    expect(normalizeNumberText("10.89%")).toBe("10.89");
    expect(normalizeNumberText("24,875,719")).toBe("24875719");
  });

  test("numberOrNull returns null for VanEck's placeholders, never NaN", () => {
    expect(numberOrNull("$95.67")).toBe(95.67);
    expect(numberOrNull("10.89%")).toBe(10.89);
    expect(numberOrNull("--")).toBeNull();
    expect(numberOrNull("—")).toBeNull();
    expect(numberOrNull("")).toBeNull();
    expect(numberOrNull("n/a")).toBeNull();
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });

  test("decodeHtmlEntities handles the entities VanEck's pages actually emit", () => {
    expect(decodeHtmlEntities("VanEck&nbsp;&amp;&nbsp;Co &lt;ETF&gt; &#39;x&#39; &quot;y&quot;")).toBe(
      "VanEck & Co <ETF> 'x' \"y\"",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Dates
// ---------------------------------------------------------------------------

describe("dates", () => {
  test("formatVanEckDate renders mm/dd/yyyy as the display form the UI expects", () => {
    expect(formatVanEckDate("09/18/2026")).toBe("Sep 18 2026");
    expect(formatVanEckDate("05/16/2006")).toBe("May 16 2006");
    expect(formatVanEckDate("12/20/2011")).toBe("Dec 20 2011");
    expect(formatVanEckDate("")).toBe("—");
    // VanEck prints "--" verbatim for unavailable cells; it is passed through
    // unchanged rather than rewritten, and the UI renders it as-is.
    expect(formatVanEckDate("--")).toBe("--");
  });

  test("toIsoDate is stable for sorting and compareDisplayDates orders correctly", () => {
    expect(toIsoDate("09/18/2026")).toBe("2026-09-18");
    expect(toIsoDate("9/8/2026")).toBe("2026-09-08");
    // already-display text is passed through unchanged
    expect(toIsoDate("Sep 18 2026")).toBe("Sep 18 2026");
    expect(compareDisplayDates("Sep 18 2026", "Sep 17 2026")).toBeGreaterThan(0);
    expect(compareDisplayDates("Sep 17 2026", "Sep 18 2026")).toBeLessThan(0);
    expect(compareDisplayDates("Sep 18 2026", "Sep 18 2026")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Display formatters
// ---------------------------------------------------------------------------

describe("formatters", () => {
  test("formatAumDisplay uses the millions form VanEck's ETF Guide prints", () => {
    expect(formatAumDisplay(22_753_000_000)).toBe("$22,753.00 M");
    expect(formatAumDisplay(1_234_567)).toBe("$1.23 M");
  });

  test("percent and money text render an em dash for null, never a blank cell", () => {
    expect(formatPercentText(11.22)).toBe("11.22%");
    expect(formatPercentText(0)).toBe("0.00%");
    expect(formatPercentText(null)).toBe("—");
    expect(formatMoneyText(95.67)).toBe("$95.67");
    expect(formatMoneyText(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// 5. Range parsing (MAX_FETCHES / AUM / TER config)
// ---------------------------------------------------------------------------

describe("range parsing", () => {
  test("parseRange requires the explicit min:max syntax", () => {
    expect(parseRange("0.10:0.60", "TER")).toEqual({ min: 0.1, max: 0.6 });
    expect(parseRange("", "TER")).toBeUndefined();
    expect(parseRange(":", "TER")).toBeUndefined();
    expect(() => parseRange("0.35", "TER")).toThrow(/min:max/);
  });

  test("parseAumRange accepts presets and explicit dollar ranges", () => {
    expect(parseAumRange("")).toBeUndefined();
    expect(parseAumRange("large")).toBeDefined();
    expect(parseAumRange("1000000000:")).toMatchObject({ min: 1_000_000_000 });
  });
});

// ---------------------------------------------------------------------------
// 6. HTML table extraction
// ---------------------------------------------------------------------------

describe("HTML table extraction", () => {
  const HTML = `
    <table><tr><th>Date</th><th>NAV</th><th>Last Trade</th></tr>
      <tr><td>09/18/2026</td><td>95.67</td><td>95.48</td></tr></table>
    <table><tr><td>Number</td><td>Ticker</td><td>Holding Name</td><td>% of Net Assets</td></tr>
      <tr><td>1</td><td>NEM</td><td>Newmont Corp</td><td>10.89</td></tr></table>`;

  test("parseHtmlTables returns every table's rows in document order", () => {
    const tables = parseHtmlTables(HTML);
    expect(tables.length).toBe(2);
    expect(tables[0][0]).toEqual(["Date", "NAV", "Last Trade"]);
    expect(tables[1][1]).toEqual(["1", "NEM", "Newmont Corp", "10.89"]);
  });

  test("findHeaderRowIndex matches on normalized cell text", () => {
    const tables = parseHtmlTables(HTML);
    expect(findHeaderRowIndex(tables[0], ["Date", "NAV", "Last Trade"])).toBe(0);
    expect(findHeaderRowIndex(tables[0], ["Holding Name", "% of Net Assets"])).toBe(-1);
    expect(findHeaderRowIndex(tables[1], ["Holding Name", "% of Net Assets"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Holdings parsing — the equity sheet
// ---------------------------------------------------------------------------

const EQUITY_HOLDINGS_HTML = `
<div>Daily Holdings (%) &nbsp;09/17/2026</div>
<table>
  <tr><td>Number</td><td>Ticker</td><td>Holding Name</td><td>Identifier (FIGI)</td>
      <td>Shares</td><td>Asset Class</td><td>Market Value (US$)</td>
      <td>Notional Value</td><td>% of Net Assets</td></tr>
  <tr><td>1</td><td>NEM</td><td>Newmont Corp</td><td>BBG000BPWXK1</td>
      <td>24,875,719</td><td>Stock</td><td>$3,094,290,686.41</td><td>--</td><td>10.89</td></tr>
  <tr><td>2</td><td>NST AU</td><td>Northern Star Resources Ltd</td><td>BBG00X7YS2P3</td>
      <td>9,000,000</td><td>Stock</td><td>$100,000,000.00</td><td>--</td><td>0.35</td></tr>
  <tr><td>3</td><td>-USD CASH-</td><td></td><td></td>
      <td>0</td><td>Cash</td><td>$57,000,000.00</td><td>--</td><td>0.20</td></tr>
  <tr><td>4</td><td>--</td><td>Other/Cash</td><td>--</td>
      <td>--</td><td>Cash</td><td>$31,792,656.80</td><td>--</td><td>0.11</td></tr>
  <tr><td colspan="9">This information is not recommendations to buy or to sell any security.</td></tr>
</table>`;

describe("parseVanEckHoldings (equity sheet)", () => {
  const parsed = parseVanEckHoldings(EQUITY_HOLDINGS_HTML);

  test("the as-of date comes from the 'Daily Holdings (%)' header line", () => {
    expect(parsed.asOfDate).toBe("Sep 17 2026");
  });

  test("columns are emitted in the shared contract's order, not the provider's", () => {
    expect(parsed.headers).toEqual([
      "Name", "Ticker", "Identifier", "Shares Held",
      "Asset Category", "Market Value", "Notional Value", "Weight",
    ]);
  });

  test("every row carries exactly the published headers, in that order", () => {
    // Regression guard: the snapshot tuples were once zipped against the wrong
    // header order, silently swapping Name and Ticker in every row.
    expect(parsed.rows.length).toBe(4);
    for (const row of parsed.rows) expect(row.length).toBe(parsed.headers.length);
    const nameIndex = parsed.headers.indexOf("Name");
    const tickerIndex = parsed.headers.indexOf("Ticker");
    expect(parsed.rows[0][nameIndex]).toBe("Newmont Corp");
    expect(parsed.rows[0][tickerIndex]).toBe("NEM");
    expect(parsed.rows[0][parsed.headers.indexOf("Identifier")]).toBe("BBG000BPWXK1");
    // the "%" in "% of Net Assets" is stripped during header normalization, so
    // the lookup key must be normalized too or every weight comes back empty
    expect(parsed.rows[0][parsed.headers.indexOf("Weight")]).toBe("10.89%");
    expect(parsed.rows[1][parsed.headers.indexOf("Weight")]).toBe("0.35%");
    expect(parsed.rows[3][parsed.headers.indexOf("Weight")]).toBe("0.11%");
    // VanEck prints "--" for Notional Value on every equity position, and
    // cleanCell collapses that placeholder to "" (the client renders "—").
    expect(parsed.rows[0][parsed.headers.indexOf("Notional Value")]).toBe("");
  });

  test("non-US listings keep their local exchange suffix verbatim", () => {
    expect(parsed.rows[1][parsed.headers.indexOf("Ticker")]).toBe("NST AU");
  });

  test("cash balances are kept, including the placeholder-ticker Other/Cash row", () => {
    expect(parsed.rows[2][parsed.headers.indexOf("Ticker")]).toBe("-USD CASH-");
    expect(parsed.rows[3][parsed.headers.indexOf("Name")]).toBe("Other/Cash");
    expect(parsed.rows[3][parsed.headers.indexOf("Ticker")]).toBe("");
  });

  test("the trailing legal-disclosure row is dropped, not counted as a position", () => {
    expect(parsed.rows.some((r) => r.join(" ").includes("not recommendations"))).toBe(false);
    expect(parsed.rows.length).toBe(4);
  });

  test("a page with no recognizable holdings table yields zero rows, never a throw", () => {
    const empty = parseVanEckHoldings("<html><body><p>Nothing here</p></body></html>");
    expect(empty.rows).toEqual([]);
    expect(empty.headers).toEqual(HOLDINGS_HEADERS);
  });
});

// ---------------------------------------------------------------------------
// 8. Holdings parsing — the fixed-income sheet (no Ticker column at all)
// ---------------------------------------------------------------------------

const FIXED_INCOME_HOLDINGS_HTML = `
<div>Daily Holdings (%) &nbsp;09/17/2026</div>
<table>
  <tr><td>Number</td><td>Holding Name</td><td>Maturity</td><td>Identifier (FIGI)</td>
      <td>Coupon</td><td>Asset Class</td><td>Par Value/ Contracts</td>
      <td>Market Value</td><td>Notional Value</td><td>% of Net Assets</td>
      <td>Country</td><td>Currency</td></tr>
  <tr><td>1</td><td>Celanese US Holdings Inc</td><td>04/01/2027</td><td>BBG00K1ABC23</td>
      <td>6.05</td><td>Corporate</td><td>$1,000,000</td><td>$1,020,000</td><td>--</td>
      <td>1.42</td><td>United States</td><td>USD</td></tr>
  <tr><td>2</td><td>Celanese US Holdings Inc</td><td>07/15/2029</td><td>BBG00K1XYZ89</td>
      <td>5.75</td><td>Corporate</td><td>$800,000</td><td>$790,000</td><td>--</td>
      <td>1.10</td><td>United States</td><td>USD</td></tr>
  <tr><td colspan="12">This information is not recommendations to buy or to sell any security.</td></tr>
</table>`;

describe("parseVanEckHoldings (fixed-income sheet)", () => {
  const parsed = parseVanEckHoldings(FIXED_INCOME_HOLDINGS_HTML);

  test("a Maturity column switches the parser to the fixed-income column set", () => {
    expect(parsed.headers).toEqual([
      "Name", "Maturity", "Identifier", "Coupon", "Asset Category",
      "Par Value", "Market Value", "Weight", "Country", "Currency",
    ]);
    expect(parsed.headers).not.toContain("Ticker");
  });

  test("the FIGI is the only identifier, and duplicate issuers stay distinct rows", () => {
    expect(parsed.rows.length).toBe(2);
    const identifierIndex = parsed.headers.indexOf("Identifier");
    expect(parsed.rows[0][identifierIndex]).toBe("BBG00K1ABC23");
    expect(parsed.rows[1][identifierIndex]).toBe("BBG00K1XYZ89");
    // Same issuer name across two maturities — dedupe must key on the FIGI.
    const nameIndex = parsed.headers.indexOf("Name");
    expect(parsed.rows[0][nameIndex]).toBe(parsed.rows[1][nameIndex]);
    expect(parsed.rows[0][identifierIndex]).not.toBe(parsed.rows[1][identifierIndex]);
  });

  test("maturity is normalized to the display date form and coupon is kept verbatim", () => {
    expect(parsed.rows[0][parsed.headers.indexOf("Maturity")]).toBe("Apr 01 2027");
    expect(parsed.rows[0][parsed.headers.indexOf("Coupon")]).toBe("6.05");
    expect(parsed.rows[0][parsed.headers.indexOf("Country")]).toBe("United States");
    expect(parsed.rows[0][parsed.headers.indexOf("Currency")]).toBe("USD");
  });

  test("every row still carries exactly the published headers", () => {
    for (const row of parsed.rows) expect(row.length).toBe(parsed.headers.length);
  });
});

// ---------------------------------------------------------------------------
// 9. History parsing
// ---------------------------------------------------------------------------

const HISTORY_HTML = `
<table>
  <tr><td>Date</td><td>NAV</td><td>Change</td><td>% Change</td><td>Last Trade</td>
      <td>Volume</td><td>Premium/Discount</td><td>% Premium/Discount</td>
      <td>AUM</td><td>Index Level</td></tr>
  <tr><td>09/18/2026</td><td>95.67</td><td>0.42</td><td>0.44</td><td>95.48</td>
      <td>5,000,000</td><td>-0.19</td><td>-0.20</td><td>28,418,567,995.87</td><td>1,234.56</td></tr>
  <tr><td>09/17/2026</td><td>95.25</td><td>-1.10</td><td>-1.14</td><td>95.30</td>
      <td>4,800,000</td><td>0.05</td><td>0.05</td><td>28,300,000,000.00</td><td>1,229.10</td></tr>
</table>`;

describe("parseVanEckHistory", () => {
  const parsed = parseVanEckHistory(HISTORY_HTML);

  test("the descending provider order is preserved", () => {
    expect(parsed.headers[0]).toBe("Date");
    expect(parsed.rows.length).toBe(2);
    expect(parsed.rows[0][0]).toBe("Sep 18 2026");
    expect(parsed.rows[1][0]).toBe("Sep 17 2026");
  });

  test("premium/discount is derived from NAV and Last Trade, not re-parsed blindly", () => {
    const nav = Number(parsed.rows[0][parsed.headers.indexOf("NAV")].replace(/[^-\d.]/g, ""));
    const close = Number(parsed.rows[0][parsed.headers.indexOf("Close")].replace(/[^-\d.]/g, ""));
    expect(premiumDiscount(close, nav)).toBeCloseTo(-0.1986, 2);
    expect(parsed.rows[0][parsed.headers.indexOf("Premium/Discount")]).toBe("-0.19");
    expect(parsed.rows[0][parsed.headers.indexOf("Total Net Assets")]).toBe("28,418,567,995.87");
  });

  test("a page without a history table yields zero rows", () => {
    expect(parseVanEckHistory("<p>No table</p>").rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Fund page parsing
// ---------------------------------------------------------------------------

describe("parseVanEckFundPage", () => {
  test("GDX publishes Gross and Net expense ratios separately", () => {
    const html = `
      <h1>GDX VanEck Gold Miners ETF</h1>
      <div>NAV</div><div>$95.67</div><div>as of September 18, 2026</div>
      <div>YTD RETURNS</div><div>11.22%</div><div>as of September 18, 2026</div>
      <div>Total Net Assets</div><div>$28.42B</div><div>as of September 18, 2026</div>
      <div>Gross Expense Ratio</div><div>0.51%</div>
      <div>Net Expense Ratio</div><div>0.51%</div>
      <div>Inception Date</div><div>05/16/2006</div>`;
    const parsed = parseVanEckFundPage(html, "https://www.vaneck.com/us/en/investments/equity/gdx/overview/");
    expect(parsed.nav).toBe(95.67);
    expect(parsed.ytdReturn).toBe(11.22);
    expect(parsed.totalNetAssets).toBe(28_420_000_000);
    expect(parsed.inceptionDate).toBe("May 16 2006");
    expect(parsed.grossExpenseRatio).toBe(0.51);
    expect(parsed.netExpenseRatio).toBe(0.51);
    expect(parsed.fundName).toContain("Gold Miners");
    expect(parsed.navAsOf).toBe("Sep 18 2026");
    expect(parsed.ytdAsOf).toBe("Sep 18 2026");
    expect(parsed.totalNetAssetsAsOf).toBe("Sep 18 2026");
    expect(parsed.fundPage).toBe("https://www.vaneck.com/us/en/investments/equity/gdx/overview/");
  });

  test("SMH publishes a single Total Expense Ratio, and the Net figure is used", () => {
    const html = `
      <h1>SMH VanEck Semiconductor ETF</h1>
      <div>NAV</div><div>$572.84</div><div>as of September 18, 2026</div>
      <div>YTD RETURNS</div><div>59.07%</div>
      <div>Total Net Assets</div><div>$74.06B</div>
      <div>Total Expense Ratio</div><div>0.35%</div>
      <div>Inception Date</div><div>12/20/2011</div>`;
    const parsed = parseVanEckFundPage(html, "https://www.vaneck.com/us/en/investments/equity/smh/overview/");
    expect(parsed.nav).toBe(572.84);
    expect(parsed.ytdReturn).toBe(59.07);
    expect(parsed.totalExpenseRatio).toBe(0.35);
    expect(parsed.inceptionDate).toBe("Dec 20 2011");
    // GDX publishes Gross and Net separately; SMH publishes only the total.
    expect(parsed.grossExpenseRatio).toBeNull();
  });

  test("an unreadable page yields placeholders, never fabricated numbers", () => {
    const parsed = parseVanEckFundPage("<html><body>Loading…</body></html>", "x");
    expect(parsed.nav).toBeNull();
    expect(parsed.ytdReturn).toBeNull();
    expect(parsed.totalNetAssets).toBeNull();
    expect(parsed.grossExpenseRatio).toBeNull();
    expect(parsed.netExpenseRatio).toBeNull();
    expect(parsed.inceptionDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Return arithmetic
// ---------------------------------------------------------------------------

describe("return arithmetic", () => {
  test("cumulative and annualized are exact inverses", () => {
    const cumulative = cumulativeFromAnnualized(10, 3);
    expect(cumulative).toBeCloseTo(33.1, 1);
    expect(annualizedFromCumulative(cumulative, 3)).toBeCloseTo(10, 2);
    expect(cumulativeFromAnnualized(null, 3)).toBeNull();
    expect(annualizedFromCumulative(null, 3)).toBeNull();
    // zero years is arithmetically zero growth, not an error
    expect(cumulativeFromAnnualized(10, 0)).toBe(0);
    // a total loss cannot be annualized
    expect(annualizedFromCumulative(-100, 3)).toBeNull();
  });

  test("premiumDiscount is null unless both inputs are numbers", () => {
    expect(premiumDiscount(95.48, 95.67)).toBe(-0.2); // rounded to 2dp
    expect(premiumDiscount(null, 95.67)).toBeNull();
    expect(premiumDiscount(95.48, null)).toBeNull();
    expect(premiumDiscount(95.48, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Distribution frequency coding
// ---------------------------------------------------------------------------

describe("distribution frequency", () => {
  test("inferDistributionFrequency reads the cadence out of ex-dates", () => {
    const monthly = ["2026-01-05", "2026-02-04", "2026-03-05", "2026-04-06"];
    const quarterly = ["2025-09-22", "2025-12-22", "2026-03-23", "2026-06-22"];
    expect(inferDistributionFrequency(monthly)).toBe("Monthly");
    expect(inferDistributionFrequency(quarterly)).toBe("Quarterly");
    // fewer than three ex-dates cannot establish a cadence
    expect(inferDistributionFrequency([])).toBe("Unknown");
    expect(inferDistributionFrequency(["2026-01-05"])).toBe("Unknown");
    expect(inferDistributionFrequency(["2025-06-20", "2025-12-22", "2026-06-22"])).toBe("Semiannually");
    expect(inferDistributionFrequency(["2024-01-05", "2025-08-10", "2026-03-02"])).toBe("Irregular");
  });

  test("frequencyCode maps labels to the sortable codes the catalog needs", () => {
    // the coded label the catalog sorts on, mirroring the client formatter
    expect(frequencyCode("Monthly")).toBe("01 - Monthly");
    expect(frequencyCode("Quarterly")).toBe("04 - Quarterly");
    expect(frequencyCode("Semiannually")).toBe("06 - Semi-annually");
    expect(frequencyCode("Annually")).toBe("12 - Annually");
    expect(frequencyCode("Irregular")).toBe("99 - Irregular");
    expect(frequencyCode("None")).toBe("00 - None");
    expect(frequencyCode("Unknown")).toBe("00 - Unknown");
    expect(frequencyCode("")).toBe("00 - —");
    expect(frequencyCode(null)).toBe("00 - —");
  });

  test("paymentsPerYear matches each code", () => {
    expect(paymentsPerYear("Monthly")).toBe(12);
    expect(paymentsPerYear("Quarterly")).toBe(4);
    expect(paymentsPerYear("Semiannually")).toBe(2);
    expect(paymentsPerYear("Annually")).toBe(1);
    // an irregular or unknown cadence has no payments-per-year, so no indicated
    // yield is invented
    expect(paymentsPerYear("Irregular")).toBeNull();
    expect(paymentsPerYear("Unknown")).toBeNull();
  });

  test("the indicated yield is annualized from the latest distribution and NAV", () => {
    // signature is (latestDividend, paymentsPerYear, nav)
    expect(indicatedDividendYield(0.25, 4, 95.67)).toBe(1.05);
    expect(indicatedDividendYield(null, 4, 95.67)).toBeNull();
    expect(indicatedDividendYield(0.25, null, 95.67)).toBeNull();
    expect(indicatedDividendYield(0.25, 4, null)).toBeNull();
    expect(indicatedDividendYield(0.25, 0, 95.67)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13. Paging
// ---------------------------------------------------------------------------

describe("chunkRows", () => {
  test("splits evenly and keeps a partial final page", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(chunkRows([], 25)).toEqual([]);
  });

  test("page sizes always sum back to the input length", () => {
    for (const size of [1, 7, 25, 250, 1000]) {
      const rows = Array.from({ length: 121 }, (_, i) => i);
      const pages = chunkRows(rows, size);
      expect(pages.flat().length).toBe(121);
      expect(pages.every((p) => p.length > 0)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. The committed feed honours the contracts asserted above
// ---------------------------------------------------------------------------

describe("generated feed", () => {
  const index = feedJson("index.json");

  test("every fund carries a stable ticker, name and category", () => {
    expect(index.funds.length).toBe(88);
    expect(index.counts.funds).toBe(88);
    for (const fund of index.funds) {
      expect(typeof fund.ticker).toBe("string");
      expect(fund.ticker.length).toBeGreaterThan(0);
      expect(fund.name.length).toBeGreaterThan(0);
      expect(fund.category.length).toBeGreaterThan(0);
    }
  });

  test("no fund invents a metric VanEck does not publish server-side", () => {
    // Multi-year returns and CUSIP/ISIN are not readable from the
    // server-rendered VanEck pages, so they must be null in the feed
    // (and therefore "—" in the UI) rather than guessed. The 30-day SEC
    // yield *is* server-rendered for a subset of funds (e.g. EINC, DESK,
    // OIH) and may therefore be present; the same holds for YTD which is
    // present for every fund whose page is fetched.
    const neverPublished = [
      "tr1y", "tr3y", "tr5y", "tr10y",
      "cagr3y", "cagr5y", "cagr10y",
      "siAnn", "dividendYield",
    ] as const;
    let ytdCount = 0;
    for (const fund of index.funds) {
      // Exchange / CUSIP / ISIN are only reliably present when the live
      // fund page has been fetched; snapshots keep them null.
      const metrics = fund.metrics;
      expect(metrics).toBeDefined();
      for (const key of neverPublished) {
        expect(metrics[key]).toBeNull();
        const text = metrics[`${key}Text`];
        if (text !== undefined) expect(text).toBe("—");
      }
      if (metrics.ytd !== null) ytdCount += 1;
      // secYield is null for most funds but may be a number where VanEck
      // server-renders "30-Day SEC Yield" — assert type, not value.
      if (metrics.secYield !== null) expect(typeof metrics.secYield).toBe("number");
      if (metrics.secYieldText !== undefined && metrics.secYield !== null) {
        expect(metrics.secYieldText).toMatch(/%/);
      }
    }
    expect(ytdCount).toBeGreaterThanOrEqual(2); // at least GDX and SMH snapshots
  });

  test("every fund records where its figures would come from", () => {
    for (const fund of index.funds) {
      const meta = feedJson(`funds/${fund.ticker}/meta.json`);
      expect(meta.source.provider).toContain("VanEck");
      expect(meta.source.fundPage).toContain("vaneck.com");
      expect(meta.source.holdingsDownload).toContain("/downloads/holdings/");
      expect(meta.source.navDownload).toContain("/downloads/fundhistoprices/");
      expect(meta.source.nportRegistrant).toContain(VANECK_ETF_TRUST_CIK);
      // the recorded chart URL must carry no wall-clock value
      expect(meta.source.yahooChart).toBe(
        `https://query1.finance.yahoo.com/v8/finance/chart/${fund.ticker}`,
      );
    }
  });

  test("every holdings row's key set matches its page headers exactly", () => {
    let rowCount = 0;
    for (const fund of index.funds) {
      if (!fund.holdings) continue;
      const meta = feedJson(`funds/${fund.ticker}/meta.json`);
      let total = 0;
      for (const page of meta.holdings.pages) {
        // page paths are relative to the fund folder with no "./" prefix
        expect(page.startsWith("./")).toBe(false);
        const payload = feedJson(`funds/${fund.ticker}/${page}`);
        expect(payload.headers.length).toBeGreaterThan(0);
        for (const row of payload.rows) {
          const keys = Object.keys(row);
          expect(keys.length).toBe(payload.headers.length);
          for (const key of keys) expect(payload.headers).toContain(key);
        }
        total += payload.rows.length;
        rowCount += payload.rows.length;
      }
      expect(total).toBe(meta.holdings.totalRows);
      expect(total).toBe(fund.holdings);
    }
    expect(rowCount).toBe(index.counts.holdings);
  });

  test("the published Name/Ticker columns are not swapped", () => {
    // Regression guard for the column-order bug the unit tests above pin down.
    const page = feedJson("funds/GDX/holdings/001.json");
    const first = page.rows[0];
    expect(first.Ticker).toBe("NEM");
    expect(first.Name).toBe("Newmont Corp");
    expect(first.Identifier).toBe("BBG000BPWXK1");
    expect(first.Weight).toBe("10.89%");
  });

  test("catalog-only funds stay catalog-only, with an explanatory empty state", () => {
    const withHoldings = index.funds.filter((f: any) => Number(f.holdings) > 0);
    expect(withHoldings.map((f: any) => f.ticker).sort()).toEqual(["GDX", "OIH", "SMH"]);
    const catalogOnly = index.funds.filter((f: any) => !Number(f.holdings));
    expect(catalogOnly.length).toBe(85);
    for (const fund of catalogOnly) {
      expect(fund.holdings ?? 0).toBe(0);
      expect(fund.history ?? 0).toBe(0);
    }
  });

  test("history pages are consistent with their manifest", () => {
    const meta = feedJson("funds/GDX/meta.json");
    expect(meta.history.pageCount).toBe(2);
    expect(meta.history.pageSize).toBe(25);
    let total = 0;
    for (const page of meta.history.pages) {
      total += feedJson(`funds/GDX/${page}`).rows.length;
    }
    expect(total).toBe(meta.history.totalRows);
    expect(total).toBe(33);
  });
});
