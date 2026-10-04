/** Reads only the currently authenticated Líder page and its public UI controls. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BankError, bankMoney, leaderRows, period, setHumanControlHandler } from './live.mjs';
import { humanControlWaiter, humanEvent, humanCondition, humanReadClick } from './lider-session.mjs';
const execute = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const nextDay = date => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
function requireBank(ok, code) { if (!ok) throw new BankError(code, 'lider.extraction', 'No se pudo validar la extracción completa de Líder.'); }

export async function extractLider(page, directory, requested, log = console.error) {
  period(requested.from, requested.to);
  const wait = humanControlWaiter(log);
  setHumanControlHandler(page.context(), wait);
  await wait(page);
  requireBank(!/Tu sesión ha finalizado/.test(await page.locator('body').innerText()), 'SESSION_EXPIRED');
  requireBank(page.url().startsWith('https://www.liderbciserviciosfinancieros.cl/private-home/'), 'LIDER_NOT_AUTHENTICATED');
  requireBank(/Tarjeta N°\s*X[\sX]*9015/.test(await page.locator('body').innerText()), 'WRONG_CARD');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const click = async name => {
    await wait(page);
    requireBank(!/Tu sesión ha finalizado/.test(await page.locator('body').innerText()), 'SESSION_EXPIRED');
    await humanReadClick(page,wait,page.getByText(name, { exact: typeof name === 'string' }).filter({ visible:true }));
  };
  const offer = page.locator('ngx-smart-modal[identifier="personalizedOfferModal"] button[aria-label="Close"]:visible');
  if (await offer.count()) await humanReadClick(page,wait,offer);
  if (!await page.getByText('Saldos', { exact: true }).filter({ visible: true }).count()) {
    await humanReadClick(page,wait,page.locator('span[routerlink="../my-card/movements"]'));
  }
  if (new URL(page.url()).pathname.endsWith('/balances')) await click('Movimientos');
  const balanceQuery = await humanEvent(page, wait, 'response',
    r => new URL(r.url()).pathname.endsWith('/api/consultasaldos'), () => click('Saldos'));
  requireBank(balanceQuery.ok(), 'BALANCE_QUERY_FAILED');
  const bankBalances = await balanceQuery.json();
  await page.waitForTimeout(500);
  await humanCondition(page, wait, () => page.evaluate(() => [...document.querySelectorAll('table')].some(t => /Internacional/.test(t.innerText) && /Disponible/.test(t.innerText))));
  const balances = await page.locator('table:visible').evaluateAll(ts => ts.map(t => Array.from(t.rows, r => Array.from(r.cells, c => c.textContent.trim()))));
  const balanceTable = balances.find(rows => rows[0].includes('Disponible') && rows.some(r => r.includes('Internacional')));
  requireBank(balanceTable, 'MISSING_BALANCES');
  const index = balanceTable[0].indexOf('Disponible');
  const available = Object.fromEntries(['CLP', 'USD'].map(currency => [currency, bankMoney(balanceTable.find(r => r[0] === (currency === 'CLP' ? 'Nacional' : 'Internacional'))[index], currency)]));
  requireBank(bankMoney(String(bankBalances.cupodisppesos), 'CLP') === available.CLP && bankMoney(String(bankBalances.cupodispdolar), 'USD') === available.USD, 'BALANCE_NOT_RENDERED');
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const stamp = (await page.locator('body').innerText()).match(/Disponibles al (\d{1,2}) de (\w+) de (\d{4})/);
  requireBank(stamp && months.includes(stamp[2]), 'MISSING_BANK_DATE');
  const bankDate = `${stamp[3]}-${String(months.indexOf(stamp[2]) + 1).padStart(2,'0')}-${stamp[1].padStart(2,'0')}`;
  requireBank(requested.to <= bankDate, 'FUTURE_PERIOD');
  const capturedAt = new Date().toISOString();
  log('lider.balances.verified');
  await click('Movimientos');
  await click(/^Por facturar\s*$/);
  const current = {};
  // Selecting both currencies generates their own read-only bank queries.
  for (const currency of ['USD', 'CLP']) {
    const endpoint = currency === 'USD' ? '/api/movfacturardolar' : '/api/movfacturarpesos';
    const observed = await humanEvent(page, wait, 'response',
      r => new URL(r.url()).pathname.endsWith(endpoint), () => click(currency === 'USD' ? 'Internacionales' : 'Nacionales'));
    requireBank(observed.ok(), 'BANK_QUERY_FAILED');
    const data = await observed.json();
    requireBank(Array.isArray(data.movimiento), 'MOVEMENT_SCHEMA_CHANGED');
    await page.waitForTimeout(500);
    const view = await leaderRows(page, currency, 'unbilled');
    requireBank(view.movements.length === data.movimiento.length, 'INCOMPLETE_PAGINATION');
    current[currency] = { ...view, response_row_count: data.movimiento.length };
  }
  log('lider.unbilled.verified');
  await click('Estados de cuenta');
  const select = page.locator('select:visible');
  await humanCondition(page, wait, () => select.isVisible());
  await humanCondition(page, wait, () => page.evaluate(() => [...document.querySelectorAll("select option")].some(o => /^\d{2}\/\d{4}$/.test(o.value))));
  const options = (await select.locator('option').evaluateAll(es => es.filter(e => !e.disabled).map(e => e.value)))
    .filter(v => /^\d{2}\/\d{4}$/.test(v)).sort((a,b) => (b.slice(3)+b.slice(0,2)).localeCompare(a.slice(3)+a.slice(0,2)));
  const documents = [];
  for (const option of options) {
    await wait(page);
    await select.selectOption(option);
    // Both summary and PDF may briefly still show the previous selection.
    await humanCondition(page, wait, () => page.evaluate(value => {
      const dates = document.body.innerText.match(/Fecha Estado de Cuenta \d{2}\/\d{2}\/\d{4}/g);
      return dates?.length >= 3 && dates.every(d => d.endsWith(value));
    }, option), { timeout:60000 });
    const name = `${option.slice(3)}-${option.slice(0,2)}.pdf`;
    const download = await humanEvent(page, wait, 'download', () => true, () => click('Descargar estado de cuenta'), {timeout:30000});
    await download.saveAs(join(directory, name));
    await chmod(join(directory, name), 0o600);
    const parsed = JSON.parse((await execute('python3', [join(HERE,'lider_pdf.py'), join(directory,name)], { maxBuffer: 4*1024*1024 })).stdout);
    requireBank(['CLP','USD'].every(c => parsed[c].billing_date.slice(0,7) === name.slice(0,7)), 'WRONG_STATEMENT_MONTH');
    documents.push({ file: name, ...parsed });
    log('lider.statement.' + name.slice(0,7) + '.reconciled');
    if (['CLP','USD'].every(c => parsed[c].from <= requested.from)) break;
  }
  const accounts = ['CLP','USD'].map(currency => {
    const history = documents.map(d => d[currency]).sort((a,b) => a.from.localeCompare(b.from));
    requireBank(history.length && history[0].from <= requested.from, 'PERIOD_NOT_COVERED');
    for (let i=1;i<history.length;i++) requireBank(nextDay(history[i-1].to) === history[i].from, 'STATEMENT_GAP');
    const movements = [...history.flatMap(h => h.movements), ...current[currency].movements];
    return {
      id: 'lider_card_' + currency.toLowerCase(), last_four: '9015', currency,
      available: available[currency], available_as_of: bankDate,
      identity_evidence: { portal_last_four:'9015', statement_last_fours:[...new Set(history.map(h => h.document_last_four))], source:'paired-statements-downloaded-from-the-same-card-session' },
      movements: movements.filter(m => requested.from <= m.date && m.date <= requested.to),
      outside_requested_period_current: current[currency].movements.filter(m => m.date > requested.to),
      coverage: { complete:true, source:'bank-export-and-portal', date_basis:'billing-cycle', filter_date_basis:'date-published-in-each-source',
        intervals:[...history.map(h => ({from:h.from,to:h.to})),{from:nextDay(history.at(-1).to),to:bankDate}],
        bank_query_date:bankDate, method:'reconciled-monthly-statements-and-all-current-unbilled-rows' },
      statements:history.map(({movements,...evidence}) => evidence), current_view:current[currency],
    };
  });
  const result = { mode:'live', complete:true, ready:available.CLP==='1003523' && available.USD==='522.40', banks:['lider'], period:requested, captured_at:capturedAt, accounts,
    sources:documents.map(d => ({file:d.file,sha256:d.sha256})),
    signs:'bank statement signs unchanged', amount_unit:'CLP pesos / USD dollars; exact decimal strings',
    acceptance:{matches_original_available:available.CLP==='1003523' && available.USD==='522.40',expected:{CLP:'1003523',USD:'522.40'},actual:available} };
  await writeFile(join(directory,'resultado.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  return result;
}
