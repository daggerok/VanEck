/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));
const TENOR = /^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/;

test('precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'GDX' }, { CONCURRENCY: 3, TICKERS: 'SMH' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('SMH');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
});

test('blank input inherits the file value; advanced may deliberately blank a key', () => {
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'GDX' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
});

test('HISTORICAL_PAGE_SIZE env alias is kept and loses to HISTORY_PAGE_SIZE', () => {
  expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '500' }).HISTORY_PAGE_SIZE).toBe('500');
  expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '500', HISTORY_PAGE_SIZE: '600' }).HISTORY_PAGE_SIZE).toBe('600');
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const defaults = file();
  const c = resolveControls(defaults, JSON.parse('{}'), {}, {});
  expect(c).toEqual(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, String(v)])));
});

test('invalid JSON values, unknown keys, non-scalars and newlines are rejected', () => {
  for (const bad of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { AUM: '1:2:3' }, { TER: '0.5' }, { TICKERS: ['GDX'] }, { TICKERS: { a: 1 } }, null, []]) {
    expect(() => resolveControls(bad)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'GDX\nSMH' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, [] as unknown)).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('provider-specific default values', () => {
  const config = readConfig(resolveControls(file()));
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(2);
  expect(config.concurrency).toBe(2);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.maxRetries).toBe(3);
  expect(config.historyRange).toBe('max');
  expect(config.tickers).toEqual([]);
  expect(config.edgarFallback).toBe(true);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipVanEck).toBe(false);
  expect(config.offlineSeed).toBe(false);
  expect(config.aumRange).toBeUndefined();
  expect(config.secUa).not.toMatch(/^$/);
  expect(file().SEC_UA).toBe('');
});

test('config keys, CONTROL_NAMES, --help and README rows stay in sync', () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  expect(Object.values(file()).every((v) => typeof v === 'string')).toBe(true);
  const doc = read('README.md');
  const src = read('scripts/update-data.ts');
  const usage = src.slice(src.indexOf('const USAGE = `'), src.indexOf('`;', src.indexOf('const USAGE = `')));
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(TENOR);
    // README and --help list the PERFORMANCE_* / TOTAL_RETURN_* tenors on one row each
    expect(doc).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
    if (tenor) expect(doc).toContain('`' + tenor[1] + '_YTD`');
    expect(usage).toContain(tenor ? tenor[1] + '_YTD|1Y|3Y|5Y|10Y' : name);
  }
  expect(doc).toContain('scripts/update-data.config.json');
});

test('workflow: inputs map to controls, fixed output dir, shared resolver, no direct interpolation', () => {
  const yml = read('.github/workflows/update-data.yml');
  const block = yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:'));
  const names = [...block.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(block).toMatch(/advanced:[\s\S]*default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
  expect(yml).toContain("cron: '0 0 * * 0'");
  expect(yml).not.toMatch(/^  push:/m);
  expect(yml).toContain('toJSON(inputs)');
  expect(yml).toContain('resolveControls');
  expect(yml).not.toMatch(/\$\{\{\s*inputs\./);
  expect(yml).toContain('git add api/vaneck');
  expect(yml).not.toMatch(/git add (?!api\/vaneck)/);
  expect(yml).not.toContain('OUTPUT_DIR');
  expect(yml).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
  expect(yml).not.toContain('bunx tsc');
});
