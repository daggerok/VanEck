# VanEck catalog UI requirements

The catalog table is the app's landing view. This document fixes its column
set, order, data sources and the rules for values VanEck does not publish.
It is the specification `scripts/ui.test.ts` and `scripts/update-data.test.ts`
are written against.

## Column set and order

Exactly **25 columns**, in this order. The order is fixed; a column may be
empty but never removed.

| # | Column | Sort key | Source | Notes |
| --- | --- | --- | --- | --- |
| 1 | `#` | — | row index in the current view | renumbers under any filter |
| 2 | `Use` | — | selection checkbox | pinned, see *Pinned columns* |
| 3 | `Ticker` | `ticker` | ETF Guide / fund page | pinned |
| 4 | `Fund Name` | `name` | fund page `<h1>` / ETF Guide | |
| 5 | `Type` | `category` | vaneck.com asset class | `Equity`, `Income`, `Real Assets \| Commodities` |
| 6 | `NAV` | `navValue` | fund page header | `—` until a networked run |
| 7 | `Net Assets` | `aumValue` | fund page header, else ETF Guide | ETF Guide figures are as of 6/30/2026 |
| 8 | `Expense` | `terValue` | fund page / ETF Guide | Net where VanEck prints Gross and Net separately |
| 9 | `Dividend Yield` | `dividendYield` | indicated, from Yahoo | labelled *indicated* where present |
| 10 | `SEC Yield` | `secYield` | **not published** | always `—` |
| 11 | `Frequency` | `dividendFrequency` | derived, see below | coded for sorting |
| 12 | `YTD Return` | `ytd` | fund page header | published for GDX and SMH in this feed |
| 13 | `TR 1Y` | `yr1` | **not readable** | always `—` |
| 14 | `TR 3Y` | `tr3y` | **not readable** | always `—` |
| 15 | `TR 5Y` | `tr5y` | **not readable** | always `—` |
| 16 | `TR 10Y` | `tr10y` | **not readable** | always `—` |
| 17 | `CAGR 3Y` | `cagr3y` | **not readable** | always `—` |
| 18 | `CAGR 5Y` | `cagr5y` | **not readable** | always `—` |
| 19 | `CAGR 10Y` | `cagr10y` | **not readable** | always `—` |
| 20 | `SI Ann.` | `si` | **not readable** | always `—` |
| 21 | `Return As Of` | `returnAsOf` | fund page | as-of date for the figures above |
| 22 | `Inception` | `inceptionDate` | fund page header | |
| 23 | `Holdings` | `holdings` | generated feed | row count |
| 24 | `History` | `history` | generated feed | row count |
| 25 | `As Of` | `asOfDate` | feed | NAV / AUM as-of date |

"not readable" means the value sits in a panel VanEck renders client-side, so a
static updater cannot see it. See the README's *Known value limitations*.

## Coded Frequency

`Frequency` is a **coded** label so that sorting groups funds by cadence
instead of alphabetically by prose. It is computed **server-side** by
`scripts/update-data.ts` (`inferDistributionFrequency` + `frequencyCode`) and
mirrored client-side by `formatDividendFrequency`, which exists so an
unexpected label degrades to the raw text rather than to a blank cell.

| Code | Meaning |
| --- | --- |
| `00 - —` | no value at all |
| `00 - None` | the fund distributes nothing |
| `00 - Unknown` | fewer than three ex-dates, so no cadence can be established |
| `01 - Monthly` | median gap 20–40 days |
| `04 - Quarterly` | median gap 70–110 days |
| `06 - Semi-annually` | median gap 150–215 days |
| `12 - Annually` | median gap 330–400 days |
| `99 - Irregular` | a cadence, but none of the above |

The code sits between `SEC Yield` and `YTD Return`. The **Overview** tab shows
the raw label (`Monthly`), not the code.

VanEck publishes no frequency label anywhere a static updater can read, so the
cadence is inferred from observed ex-date gaps. The inference uses the most
recent six gaps rather than a fixed calendar window: a strict 365-day lookback
can never contain three semi-annual payments, because three payments on a
6-month cadence span about 365 days and the oldest always falls just outside.

## Pinned columns

Sticky positioning is applied **directly to the `th`/`td`**, never to a nested
span, and only through opt-in classes — never `:nth-child()`, which would break
as soon as a column is added or reordered.

| Column | Class | Offset |
| --- | --- | --- |
| catalog `Use` | `.catalog-sticky-col .catalog-sticky-use` | `left: 0`, `5rem` wide |
| catalog `Ticker` | `.catalog-sticky-col .catalog-sticky-ticker` | `left: 5rem` |
| Watchlist `Ticker` | `.watchlist-sticky-col .watchlist-sticky-ticker` | `left: 0` |

Backgrounds are **pre-blended opaque hexes**, never translucent, so scrolled
text cannot bleed through: `#ffffff` / `#f8fafc` in light mode, `#172033` base,
`#1f2a3d` hover, `#19274e` selected, `#0f172a` for the dark header.

### Why Ticker is 6rem, not 5rem

The inherited template pins `Ticker` at `5rem`. This feed keeps **6rem**:
**65 of the 88** tickers are 4 characters long (`ANGL`, `CLOB`, `JULV`, `VAVX`,
`VBNB`, …), and 4 × 8.4px = 33.6px plus `px-4` padding (32px) is already 65.6px
before the header's sort arrow (≈16.8px) is added. At `5rem` (80px) the header
would clip.

## Em dash semantics

`—` means **this value is not published / not readable**, and never "still
loading". Loading has its own explicit copy and its own row state. Every `—`
in the catalog is explained by:

1. the column's `title` tooltip (`COLUMN_TOOLTIPS` in `app.tsx`), and
2. a provenance row in the fund's **Overview** tab.

The feed stores `null` for these values under `meta.json.metrics`, and
`scripts/update-data.test.ts` asserts that no fund carries an invented
`secYield`, `tr1y`…`tr10y`, `cagr3y`…`cagr10y`, `siAnn`, `dividendYield`,
`cusip` or `isin` — and that wherever a matching `*Text` display field exists
it is exactly `—`, never an empty cell.

The Overview tab's `Fund` section carries the matching provenance rows
(`Holdings Source`, `History Source`, `Provider`, `CUSIP`, `ISIN`, `Benchmark
Index`), so a reader can see *why* a value is absent without leaving the app.

## Sorting and filtering

- Every column above with a sort key is sortable. The sort keys are the ones
  listed in the table and come from the `data-sort` attributes in `app.tsx`;
  note that the numeric columns sort on the parsed `*Value` fields
  (`navValue`, `aumValue`, `terValue`) rather than their display strings, and
  that `TR 1Y` and `SI Ann.` sort as `yr1` and `si`.
- Numeric columns sort numerically, dates chronologically (`Date.parse` over
  the display form, no locale round trip), text case-insensitively.
- The Watchlist has its own sort keys: `symbol`, `name`, `funds`, `fundCount`,
  `weightSum`, `maxWeight`, `identifier`.
- Sorting is **per tab** and is never reset by any control — not a row
  checkbox, not the header `Use`, not the `All ETFs` pill, not Copy Tickers,
  not the theme toggle.
- Filtering is **per tab** and stored under `vaneck-tab-filters`; the header
  `Use` checkbox's checked state is `.every(...)` over `visibleCatalogRows()`,
  never a selection-size comparison.
- Search is a substring match over a precomputed `searchIndex` (ticker, name,
  category, provider category and the fund's own figures). It therefore matches
  inside words: searching `muni` also returns `TRUC`, whose name contains
  "Com**muni**cation". That is intended behaviour, not a bug.
