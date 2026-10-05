import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const liveUrl = new URL('./live.mjs', import.meta.url).href;
const dataUrl = source => 'data:text/javascript,' + encodeURIComponent(source);
// Replace Playwright at module resolution: no installed browser, network,
// credentials, or existing bank session is used by these subprocesses.
const playwright = dataUrl(`
  import assert from 'node:assert/strict';
  import { BankError, CREDENTIAL_KEYS } from ${JSON.stringify(liveUrl)};
  export const chromium = { async launch(options) {
    assert.equal(options.headless, false);
    assert.match(new Error().stack, /at (?:Module[.])?runLider /);
    for (const key of CREDENTIAL_KEYS) assert.equal(options.env[key], undefined);
    throw new BankError('TEST_BROWSER_BLOCKED', 'lider.browser.start', 'Browser launch intercepted by startup test.');
  } };
`);
const loader = dataUrl(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'playwright') return { url: ${JSON.stringify(playwright)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`);
const preload = dataUrl(`import { register } from 'node:module'; register(${JSON.stringify(loader)});`);

function cli(entry, overrides = {}) {
  return spawnSync(process.execPath, [
    '--import', preload, `scripts/bci-statement/${entry}`,
    '--from', '2026-08-18', '--to', '2026-10-02',
    ...(entry === 'live.mjs' ? ['--bank', 'lider'] : []),
  ], {
    cwd: root,
    // Deliberately exclude inherited credentials, NODE_OPTIONS and DISPLAY.
    env: { BCI_LIDER_RUT: 'test-only', BCI_LIDER_CLAVE: 'test-only', DISPLAY: ':test-only', ...overrides },
    encoding: 'utf8', timeout: 10000,
  });
}

function expectError(result, code, stage) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, code);
  if (stage) assert.equal(error.stage, stage);
}

test('documented Líder CLI reaches the same visible launch as lider-live without opening Chromium', () => {
  expectError(cli('lider-live.mjs'), 'TEST_BROWSER_BLOCKED');
  expectError(cli('live.mjs'), 'TEST_BROWSER_BLOCKED', 'lider.browser.start');
});

test('documented Líder CLI reports missing credentials before browser launch', () => {
  expectError(cli('live.mjs', { BCI_LIDER_CLAVE: '' }), 'MISSING_CREDENTIALS', 'configuration');
});

test('documented Líder CLI reports missing DISPLAY before browser launch', () => {
  expectError(cli('live.mjs', { DISPLAY: '' }), 'MISSING_DISPLAY', 'configuration');
});
