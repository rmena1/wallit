import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BankError, bankMoney, bankDate, credentials, period, run, login, main, assertPeriodCoverage, navigateChecking, navigateCards, selectCardCurrency, download, mergeStatementRows } from './live.mjs';
delete process.env.DEBUG;
delete process.env.PWDEBUG;
const { chromium } = await import('playwright');

const here = dirname(fileURLToPath(import.meta.url));
// Positive data is always read from the real bank captures, never fabricated.
const captured = spawnSync('python3', [join(here, 'statement.py'), '--captures',
  process.env.BCI_CAPTURE_DIR ?? '/workspace/bci-daily-2026-10-02', '--from', '2026-08-18', '--to', '2026-10-02', '--allow-incomplete-replay'], { encoding: 'utf8' });
assert.equal(captured.status, 0, 'The actual bank corpus must be available');
const realAccounts = JSON.parse(captured.stdout).accounts;

function browserEnvironment() {
  const env = { ...process.env };
  for (const key of ['BCI_PERSONAS_RUT', 'BCI_PERSONAS_CLAVE', 'BCI_LIDER_RUT', 'BCI_LIDER_CLAVE']) delete env[key];
  delete env.DEBUG; delete env.PWDEBUG; return env;
}

test('missing environment credentials fail before launching a browser, stdout is empty', async () => {
  await assert.rejects(run({ from: '2026-08-18', to: '2026-10-02', env: {}, launch: () => { assert.fail('Must not launch'); } }), { code: 'MISSING_CREDENTIALS' });
  const result = spawnSync(process.execPath, [join(here, 'live.mjs'), '--from', '2026-08-18', '--to', '2026-10-02'], { env: browserEnvironment(), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).error.code, 'MISSING_CREDENTIALS');
});

test('dates and localized amounts agree with the real captures', () => {
  for (const a of realAccounts) {
    for (const amount of [a.available, ...a.movements.map(m => m.amount)]) {
      const localized = (a.currency === 'USD' ? 'US$' : '$') + amount.replace('.', ',');
      assert.equal(bankMoney(localized, a.currency), amount);
      if (a.currency === 'USD') assert.equal(bankMoney('USD ' + amount, a.currency), amount);
    }
    for (const m of a.movements) assert.equal(bankDate(m.date.split('-').reverse().join('/')), m.date);
  }
  assert.throws(() => period('2026-02-30', '2026-10-02'), { code: 'INVALID_PERIOD' });
  assert.throws(() => period('2026-10-03', '2026-10-02'), { code: 'INVALID_PERIOD' });
});

function fakeBrowser() {
  const contexts = []; let closed = false;
  return {
    contexts,
    get closed() { return closed; },
    async newContext() {
      const context = { closed: false, setDefaultTimeout() {}, async close() { this.closed = true; } };
      contexts.push(context); return context;
    },
    async close() { closed = true; },
  };
}

test('a later page failure discards earlier real accounts and closes contexts and temporary downloads', async () => {
  const browser = fakeBrowser(); let temporary;
  const adapters = {
    async login() { return { isClosed: () => true }; },
    async readPersonas(page, directory) { temporary = directory; return structuredClone(realAccounts.slice(0, 3)); },
    async readLider() { throw new BankError('BANK_HTTP_ERROR', 'lider.balances', 'HTTP 503'); },
  };
  // Credentials are inherited from the runner even in orchestration tests.
  // Their values are never compared in assertion output or persisted in fixtures.
  credentials(process.env);
  await assert.rejects(run({ from: '2026-08-18', to: '2026-10-02', launch: async () => browser, adapters }), { code: 'BANK_HTTP_ERROR' });
  assert.ok(browser.closed); assert.ok(browser.contexts.every(c => c.closed));
  await assert.rejects(access(temporary));
});

test('real captures without period evidence cannot become successful live output', async () => {
  // Includes the reproduced bug: January previously returned five empty accounts.
  for (const requested of [{ from: '2026-08-18', to: '2026-10-02' }, { from: '2026-01-01', to: '2026-01-31' }]) {
    const browser = fakeBrowser(); let temporary; const received = [];
    const adapters = {
      async login() { return { isClosed: () => true }; },
      async readPersonas(page, directory, log, query) { temporary = directory; received.push(query); return structuredClone(realAccounts.slice(0, 3)); },
      async readLider(page, log, query) { received.push(query); return structuredClone(realAccounts.slice(3)); },
    };
    let stdout = ''; let stderr = '';
    const code = await main(['--from', requested.from, '--to', requested.to], {
      launch: async () => browser, adapters,
      stdout: { write: chunk => { stdout += chunk; } },
      stderr: { write: chunk => { stderr += chunk; } },
    });
    assert.equal(code, 1); assert.equal(stdout, '');
    assert.equal(JSON.parse(stderr).error.code, 'PERIOD_NOT_VERIFIED');
    assert.deepEqual(received, [requested, requested]);
    assert.ok(browser.closed); assert.ok(browser.contexts.every(c => c.closed));
    await assert.rejects(access(temporary));
  }
});

test('coverage interval contract rejects gaps and posting-date bounds', () => {
  // Interval arithmetic only, not fabricated movement rows or bank evidence.
  const requested = { from: '2026-08-18', to: '2026-10-02' };
  const account = intervals => ({ coverage: { complete: true, source: 'bank-export', date_basis: 'transaction-date', intervals } });
  assert.doesNotThrow(() => assertPeriodCoverage([account([requested])], requested));
  const adjacent = [{ from: '2026-08-18', to: '2026-09-17' }, { from: '2026-09-18', to: '2026-10-02' }];
  assert.doesNotThrow(() => assertPeriodCoverage([account(adjacent.toReversed())], requested));
  for (const intervals of [
    [{ from: '2026-08-19', to: '2026-10-02' }],
    [{ from: '2026-08-18', to: '2026-10-01' }],
    [adjacent[0], { from: '2026-09-19', to: '2026-10-02' }],
  ]) assert.throws(() => assertPeriodCoverage([account(intervals)], requested), { code: 'PERIOD_NOT_COVERED' });
  const posting = account([requested]); posting.coverage.date_basis = 'posting-date';
  assert.throws(() => assertPeriodCoverage([posting], requested), { code: 'PERIOD_NOT_VERIFIED' });
  assert.throws(() => assertPeriodCoverage([account([requested]), {}], requested), { code: 'PERIOD_NOT_VERIFIED' });
  assert.throws(() => assertPeriodCoverage([account([{ from: 'invalid', to: requested.to }])], requested), { code: 'PERIOD_NOT_VERIFIED' });
});

test('login rejection is recognized by the browser with no retry or external requests', async () => {
  const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
  let submissions = 0;
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      if (route.request().method() === 'POST') {
        submissions++; await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p>Clave incorrecta</p>' });
      } else if (new URL(route.request().url()).pathname === '/personas') {
        // The real public entry is an anchor with role=button, not role=link.
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<a role="button" href="/login-form">Banco en Línea</a>' });
      } else {
        // Structural failure fixture only: no invented bank movements or credentials.
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<form action="/auth-test" method="post"><input name="rut_aux" placeholder="Ingresa tu RUT"><input name="clave" type="password"><button>Ingresar</button></form>' });
      }
    });
    await assert.rejects(login(context, 'personas', credentials(process.env)), { code: 'LOGIN_REJECTED' });
    assert.equal(submissions, 1);
  } finally { await browser.close(); }
});

test('bank HTTP failure stops the browser before sending credentials', async () => {
  const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
  let submissions = 0;
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      if (route.request().method() === 'POST') submissions++;
      await route.fulfill({ status: 503, body: 'Service unavailable' });
    });
    await assert.rejects(login(context, 'personas', credentials(process.env)), { code: 'BANK_HTTP_ERROR' });
    assert.equal(submissions, 0);
  } finally { await browser.close(); }
});

for (const variant of ['direct', 'optional-device', 'json-handoff', 'hidden-handoff', 'titular']) {
  test(`login preserves the ${variant} route without a second credential submission`, async () => {
    const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
    let submissions = 0; let enrollment = 0;
    try {
      const context = await browser.newContext();
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        let body;
        if (url.pathname === '/personas') body = '<form action="https://login.bci.cl/authentication_service" method="post"><input name="rut_aux" placeholder="RUT"><input type="password" name="clave"><button>Ingresar</button></form>';
        else if (url.pathname === '/authentication_service') {
          submissions++;
          if (variant === 'optional-device') body = '<h1>Registra tu Dispositivo de confianza</h1><p>Es un proceso opcional a partir de las nuevas normativas de la CMF.</p><button onclick="location.href=\'/home\'">Omitir</button><button onclick="location.href=\'/register\'">Ir a registrar</button>';
          else if (variant === 'json-handoff') body = '<pre>{"redirectUrl":"https://login.bci.cl/home"}</pre>';
          else if (variant === 'hidden-handoff') body = '<form action="https://www.bci.cl/nuevaWeb/home" method="post"><input type="hidden" name="ticket"></form>';
          else if (variant === 'titular') body = '<p>Seleccione si desea consultar como adicional o titular</p><input type="button" value="Titular" onclick="location.href=\'/home\'">';
          else body = '<nav>Mi Banco</nav>';
        } else if (url.pathname === '/register') { enrollment++; body = 'Unexpected enrollment'; }
        else body = '<nav>Mi Banco</nav>';
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      });
      const page = await login(context, 'personas', credentials(process.env));
      assert.equal(await page.getByText('Mi Banco', { exact: true }).count(), 1);
      assert.equal(submissions, 1); assert.equal(enrollment, 0);
    } finally { await browser.close(); }
  });
}

for (const challenge of ['<input type="hidden" name="cf-turnstile-response">', '<p>No soy un robot</p>', '<textarea hidden name="g-recaptcha-response"></textarea>', '<textarea hidden name="h-captcha-response"></textarea>']) {
  test(`robot control stops before credentials: ${challenge.split(' ')[0]}`, async () => {
    const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
    let submissions = 0;
    try {
      const context = await browser.newContext();
      await context.route('**/*', async route => {
        if (route.request().method() === 'POST') submissions++;
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<form method="post"><input placeholder="RUT" name="rut_aux"><input type="password"><button>Ingresar</button>${challenge}</form>` });
      });
      await assert.rejects(login(context, 'personas', credentials(process.env)), { code: 'LOGIN_CHALLENGE' });
      assert.equal(submissions, 0);
      assert.equal(await context.pages()[0].locator('input[type=password]').inputValue(), '');
      assert.equal(await context.pages()[0].locator('input[name=rut_aux]').inputValue(), '');
    } finally { await browser.close(); }
  });
}

test('a robot challenge after reading Personas discards all data and closes the session', async () => {
  const browser = fakeBrowser(); let stdout = ''; let stderr = ''; let temporary; let liderCalls = 0;
  const adapters = {
    async login(context, bank) {
      if (bank === 'lider') { liderCalls++; throw new BankError('LOGIN_CHALLENGE', 'lider.login', 'Turnstile'); }
      return { isClosed: () => true };
    },
    async readPersonas(page, directory) { temporary = directory; return structuredClone(realAccounts.slice(0, 3)); },
    async readLider() { assert.fail('Must stop before extraction'); },
  };
  const code = await main(['--from', '2026-08-18', '--to', '2026-10-02'], {
    launch: async () => browser, adapters,
    stdout: { write: chunk => { stdout += chunk; } }, stderr: { write: chunk => { stderr += chunk; } },
  });
  assert.equal(code, 1); assert.equal(stdout, ''); assert.equal(liderCalls, 1);
  assert.equal(JSON.parse(stderr).error.code, 'LOGIN_CHALLENGE');
  assert.ok(browser.closed); assert.ok(browser.contexts.every(c => c.closed));
  await assert.rejects(access(temporary));
});

for (const modern of [false, true]) {
  test(`checking navigation preserves ${modern ? 'delayed dashboard with duplicated menu' : 'legacy menu'} route`, async () => {
    const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
    try {
      const context = await browser.newContext();
      await context.route('**/*', async route => {
        const body = new URL(route.request().url()).pathname === '/movements' ? '<h1>Últimos Movimientos</h1>' : modern
          ? '<a>Mi Banco</a><aside><a>Mi Cuenta</a><a>Últimos Movimientos</a><div>Cuenta Familia<a>Mi Cuenta</a><a>Últimos Movimientos</a></div></aside><main id="dashboard"></main><script>setTimeout(()=>{document.querySelector("main").innerHTML=`<select name="account_selector"><option>Corriente: ****8080</option></select><a href="/movements">Ir a últimos Movimientos</a>`},1400)</script>'
          : '<a>Mi Banco</a><a>Mi Cuenta</a><a href="/movements">Últimos Movimientos</a>';
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      });
      const page = await context.newPage();
      await page.goto(modern ? 'https://personas.bci.cl/comp' : 'https://www.bci.cl/legacy');
      await navigateChecking(page);
      assert.equal(new URL(page.url()).pathname, '/movements');
    } finally { await browser.close(); }
  });
}

for (const icon of [false, true, 'bank-li', 'cloud', 'history']) {
  test(`delayed ${icon || 'text'} download parses the real checking statement`, async () => {
    const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
    const directory = await mkdtemp('/tmp/bci-download-test-');
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      await context.route('**/*', async route => {
        if (new URL(route.request().url()).pathname === '/statement') {
          await route.fulfill({ path: join(process.env.BCI_CAPTURE_DIR ?? '/workspace/bci-daily-2026-10-02', 'personas/CC_ultimos_movimientos.xlsx'), headers: { 'Content-Disposition': 'attachment; filename="statement.xlsx"' } });
        } else {
          const control = icon === 'history' ? '<button onclick="location.href=\'/statement\'">Descargar Excel <span>download</span></button>' : icon === 'cloud' ? '<a href="/statement">Descargar Excel <span>cloud_download</span></a>' : icon === 'bank-li' ? '<li id="exportarExcel" onclick="location.href=\'/statement\'"><span style="display:none">Exportar a excel</span>📄</li>' : icon ? '<a href="/statement"><i class="file-excel"></i>Excel</a>' : '<a href="/statement">Descargar Excel</a>';
          await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main></main><script>setTimeout(()=>document.querySelector('main').innerHTML=${JSON.stringify(control)},1200)</script>` });
        }
      });
      const page = await context.newPage(); await page.goto('https://personas.bci.cl/movements');
      const result = await download(page, directory, 'checking');
      assert.equal(result.available, realAccounts[0].available);
      assert.deepEqual(result.movements.filter(m => '2026-08-18' <= m.date && m.date <= '2026-10-02').map(({date,name,amount})=>({date,name,amount})), realAccounts[0].movements.map(({date,name,amount})=>({date,name,amount})));
    } finally { await browser.close(); await rm(directory, {recursive:true,force:true}); }
  });
}

for (const collapsed of [false, 'all']) {
  test(`credit menu preserves ${collapsed ? 'collapsed group' : 'direct'} route`, async () => {
    const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
    try {
      const context = await browser.newContext();
      await context.route('**/*', async route => {
        const body = new URL(route.request().url()).pathname === '/movements' ? '<h1>Mis movimientos</h1>'
          : `<a title="Tarjetas"> Tarjetas </a>${collapsed === 'all' ? '<span onclick="document.querySelector(\'section\').style.height=\'80px\'">Expandir Todo</span>' : ''}${collapsed ? '<a title="Tarjetas de crédito" '+(collapsed === 'hover' ? 'onmouseenter' : 'onclick')+'="document.querySelector(\'section\').style.height=\'80px\'">Tarjetas de crédito</a>' : ''}<section style="height:${collapsed ? 0 : 80}px;overflow:hidden"><a title="Mis movimientos" href="/movements"> Mis movimientos </a></section>`;
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      });
      const page = await context.newPage(); await page.goto('https://personas.bci.cl/cards');
      await navigateCards(page);
      assert.equal(new URL(page.url()).pathname, '/movements');
    } finally { await browser.close(); }
  });
}

test('legacy account menu on the modern host opens before waiting for a dashboard', async () => {
  const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const body = new URL(route.request().url()).pathname === '/movements'
        ? '<h1>Últimos Movimientos</h1>'
        : '<a title="Mi Banco"> Mi Banco </a><a title="Mi Cuenta" onclick="document.querySelector(\'section\').hidden=false"> Mi Cuenta </a><section hidden><a href="/movements"> Últimos Movimientos </a></section>';
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    const page = await context.newPage(); await page.goto('https://personas.bci.cl/legacy');
    await navigateChecking(page);
    assert.equal(new URL(page.url()).pathname, '/movements');
  } finally { await browser.close(); }
});

test('explicit Personas scope never opens Lider and requires only Personas credentials', async () => {
  const browser = fakeBrowser(); const visited = [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('BCI_PERSONAS_')));
  await assert.rejects(run({ from: '2026-08-18', to: '2026-10-02', bank: 'personas', env, launch: async () => browser,
    adapters: {
      async login(context, bank) { visited.push(bank); return { isClosed: () => true }; },
      async readPersonas() { return structuredClone(realAccounts.slice(0, 3)); },
      async readLider() { assert.fail('Lider is outside the requested scope'); },
    },
  }), { code: 'PERIOD_NOT_VERIFIED' });
  assert.deepEqual(visited, ['personas']);
  assert.equal(browser.contexts.length, 1); assert.ok(browser.closed);
});

for (const intermediate of [false, true]) {
  test(`currency selection preserves ${intermediate ? 'card-selector intermediate' : 'direct tabs'} route`, async () => {
    const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
    try {
      const context = await browser.newContext();
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
        `<select onchange="window.selected=(window.selected||0)+1;document.querySelector('section').hidden=false"><option value="1164">BciPlus+ Mastercard Black **** 1164</option></select><section ${intermediate ? 'hidden' : ''}><a onclick="window.currency='CLP'">Nacional $</a><a onclick="window.currency='USD'">Internacional USD</a></section>` })) ;
      const page = await context.newPage(); await page.goto('https://personas.bci.cl/cards');
      await selectCardCurrency(page, 'CLP');
      assert.equal(await page.evaluate(() => window.currency), 'CLP');
      assert.equal(await page.evaluate(() => window.selected || 0), intermediate ? 1 : 0);
      await selectCardCurrency(page, 'USD');
      assert.equal(await page.evaluate(() => window.currency), 'USD');
    } finally { await browser.close(); }
  });
}

test('overlapping statement downloads preserve the multiplicity of actual rows', () => {
  const rows = realAccounts[1].movements;
  assert.deepEqual(mergeStatementRows(rows, rows), rows);
  assert.deepEqual(mergeStatementRows([], rows), rows);
  assert.deepEqual(mergeStatementRows(rows.slice(0, 10), rows), rows);
});

test('live bridge reads billing bounds from the original bank export', () => {
  const result = spawnSync('python3', [join(here, 'bridge.py'), 'card',
    join(process.env.BCI_CAPTURE_DIR ?? '/workspace/bci-daily-2026-10-02', 'personas/TC_1164_nacional_facturados.xls'), 'CLP', 'billed'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).statement_period, { from: '2026-08-21', billing_date: '2026-09-17' });
});

test('the real successful Personas run has a complete chain; removing August creates a gap', async () => {
  const result = JSON.parse(await readFile(join(process.env.BCI_HISTORY_CAPTURE_DIR ?? '/workspace/bci-movimientos/personas-live-2026-10-03', 'resultado.json'), 'utf8'));
  assert.equal(result.mode, 'live'); assert.deepEqual(result.banks, ['personas']);
  assert.deepEqual(result.accounts.map(a => [a.available, a.movements.length]), [['2484842', 25], ['-248236', 83], ['-193.46', 31]]);
  assert.doesNotThrow(() => assertPeriodCoverage(result.accounts, result.period));
  const card = result.accounts.find(a => a.id === 'bci_card_usd');
  assert.equal(card.coverage.date_basis, 'billing-cycle');
  assert.ok(card.movements.some(m => m.date === '2026-08-19' && m.name === 'OPENAI' && m.amount === '-10.00'));
  card.statements = card.statements.filter(p => p.billing_date !== '2026-08-20');
  card.coverage.intervals = card.coverage.intervals.filter(p => p.to !== '2026-08-20');
  assert.throws(() => assertPeriodCoverage(result.accounts, result.period), { code: 'PERIOD_NOT_COVERED' });
});

test('bank HTTP failure during Excel download is reported and produces no file', async () => {
  const browser = await chromium.launch({ headless: true, env: browserEnvironment() });
  const directory = await mkdtemp('/tmp/bci-download-error-');
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).pathname === '/export/excel') return route.fulfill({ status: 503, body: 'Unavailable' });
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button onclick="fetch(\'/export/excel\')">Descargar Excel</button>' });
    });
    const page = await context.newPage(); await page.goto('https://personas.bci.cl/movements');
    await assert.rejects(download(page, directory, 'checking'), { code: 'BANK_HTTP_ERROR' });
    assert.deepEqual(await readdir(directory), []);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
