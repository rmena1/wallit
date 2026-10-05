/** Deterministic, read-only portal automation. No model/client/database imports. */
import { mkdtemp, rm, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CREDENTIAL_KEYS = ['BCI_PERSONAS_RUT', 'BCI_PERSONAS_CLAVE', 'BCI_LIDER_RUT', 'BCI_LIDER_CLAVE'];
const ROOTS = { personas: 'https://www.bci.cl/personas', lider: 'https://www.liderbciserviciosfinancieros.cl/' };
const WAIT = 20000;
const PAGE_WAIT = 60000; // Observed card iframe can keep loading beyond 20 seconds.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Opt-in for the separate visible Líder session; Personas keeps its original policy.
const humanControls = new WeakMap();
export function setHumanControlHandler(context, handler) { humanControls.set(context, handler); }
export class BankError extends Error {
  constructor(code, stage, message) { super(message); this.code = code; this.stage = stage; }
}
function fail(code, stage, message) { throw new BankError(code, stage, message); }
export function credentials(env, bank = 'all') {
  const keys = bank === 'personas' ? CREDENTIAL_KEYS.filter(k => k.startsWith('BCI_PERSONAS_')) : bank === 'lider' ? CREDENTIAL_KEYS.filter(k => k.startsWith('BCI_LIDER_')) : CREDENTIAL_KEYS;
  const missing = keys.filter(k => !env[k]?.trim());
  if (missing.length) fail('MISSING_CREDENTIALS', 'configuration', `Faltan variables: ${missing.join(', ')}`);
  return Object.fromEntries(keys.map(k => [k, env[k]]));
}
export function period(from, to) {
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
      fail('INVALID_PERIOD', 'configuration', 'Use fechas válidas YYYY-MM-DD.');
  }
  if (from > to) fail('INVALID_PERIOD', 'configuration', 'El inicio es posterior al fin.');
  return { from, to };
}
export function assertPeriodCoverage(accounts, requested) {
  // Bounds need a complete bank query or a verified chain of billing documents.
  // Billing dates remain explicitly identified as such; transaction dates are
  // used to filter the rows, not invented as server-side query parameters.
  for (const account of accounts) {
    const coverage = account.coverage;
    const billingChain = coverage?.date_basis === 'billing-cycle' &&
      coverage.method === 'billing-statements-and-current-unbilled' && coverage.filter_date_basis === 'transaction-date' &&
      coverage.source === 'bank-export' && account.statements?.length && account.unbilled_period &&
      JSON.stringify(coverage.intervals) === JSON.stringify([
        ...account.statements.map(p => ({ from: p.from, to: p.billing_date })),
        { from: account.unbilled_period.from, to: coverage.bank_query_date },
      ]);
    if (coverage?.complete !== true || !(coverage.date_basis === 'transaction-date' || billingChain) ||
        !['bank-portal', 'bank-export'].includes(coverage.source) ||
        !Array.isArray(coverage.intervals) || !coverage.intervals.length) {
      fail('PERIOD_NOT_VERIFIED', 'coverage', 'La consulta del portal no acredita el período completo de todas las cuentas consultadas; no se devuelve un resultado parcial.');
    }
    const ranges = coverage.intervals.map(range => {
      try { period(range?.from, range?.to); }
      catch { fail('PERIOD_NOT_VERIFIED', 'coverage', 'Los límites del período consultado al banco no son válidos.'); }
      return [Date.parse(range.from), Date.parse(range.to)];
    }).sort((a, b) => a[0] - b[0]);
    let cursor = Date.parse(requested.from);
    const end = Date.parse(requested.to);
    for (const [from, to] of ranges) {
      if (from > cursor) break;
      cursor = Math.max(cursor, to + 86400000);
      if (cursor > end) break;
    }
    if (cursor <= end) fail('PERIOD_NOT_COVERED', 'coverage', 'El historial consultado al banco no cubre todo el período solicitado; no se devuelve un resultado parcial.');
  }
}
export function bankDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) { const day = value.trim(); period(day, day); return day; }
  const m = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!m) fail('INVALID_DATE', 'extraction', 'Fecha bancaria no reconocida.');
  const day = `${m[3].length === 2 ? '20' : ''}${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  period(day, day); return day;
}
export function bankMoney(value, currency) {
  let s = value.trim().replace(/(?:US\$|USD|CLP|\$)/gi, '').replace(/\s/g, '').replace(/−/g, '-');
  if (currency === 'USD' && /^-?(?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2}$/.test(s)) s = s.replaceAll(',', '');
  else {
    if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s)) fail('INVALID_AMOUNT', 'extraction', 'Monto bancario no reconocido.');
    s = s.replaceAll('.', '').replace(',', '.');
  }
  if (currency === 'CLP' && s.includes('.')) fail('INVALID_AMOUNT', 'extraction', 'Pesos con decimales inesperados.');
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace(/^-/, '').split('.');
  const units = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return `${negative && units !== 0n ? '-' : ''}${units / 100n}${currency === 'USD' ? '.' + (units % 100n).toString().padStart(2, '0') : ''}`;
}
const visible = async loc => { const found = []; for (let i = 0; i < await loc.count(); i++) if (await loc.nth(i).isVisible()) found.push(loc.nth(i)); return found; };
function portalFrames(page) {
  return page.frames().filter(f => !f.isDetached() && (f === page.mainFrame() || trusted(f.url(), 'personas') || trusted(f.url(), 'lider')));
}
async function find(page, build) {
  const hits = [];
  for (const frame of portalFrames(page)) {
    try { hits.push(...await visible(build(frame))); }
    catch (error) { if (!frame.isDetached()) throw error; }
  }
  return hits;
}
async function one(page, build, stage, optional = false) {
  const deadline = Date.now() + PAGE_WAIT;
  do {
    await checkPage(page, stage);
    const hits = await find(page, build);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) fail('PAGE_CHANGED', stage, 'Control ambiguo; se detuvo la navegación.');
    if (optional) return null;
    await pause(300);
  } while (Date.now() < deadline);
  fail('PAGE_CHANGED', stage, 'El control requerido no apareció dentro del plazo.');
}
async function textControl(page, pattern, stage, optional = false) {
  const titled = await one(page, f => f.locator('a,button').and(f.getByTitle(pattern, { exact: true })), stage, true);
  if (titled) return titled;
  const padded = new RegExp(pattern.source.replace(/^\^/, '^\\s*').replace(/\$$/, '\\s*$'), pattern.flags);
  return one(page, f => f.getByText(padded, { exact: true }), stage, optional);
}
async function clickText(page, pattern, stage, optional = false) {
  const control = await textControl(page, pattern, stage, optional);
  if (!control) return false;
  await control.click({ timeout: WAIT }); await settle(page, stage); return true;
}
async function settle(page, stage) {
  await page.waitForLoadState('domcontentloaded', { timeout: WAIT });
  await checkPage(page, stage);
  // The sites keep analytics connections open: networkidle is not a readiness signal.
  await pause(700);
  for (const frame of portalFrames(page)) {
    const spinners = frame.locator('ngx-spinner .loading-text:visible, .ngx-spinner-overlay:visible, [aria-busy="true"]:visible');
    try { if (await spinners.count()) await spinners.first().waitFor({ state: 'hidden', timeout: WAIT }); }
    catch (error) { if (!frame.isDetached()) throw error; }
  }
  const loading = await find(page, f => f.getByText(/^(Cargando|Espera un momento)$/i, { exact: true }));
  for (const indicator of loading) await indicator.waitFor({ state: 'hidden', timeout: WAIT });
  await checkPage(page, stage);
}
async function bodyTexts(page) {
  return Promise.all(portalFrames(page).map(f => f.locator('body').innerText({ timeout: 1500 }).catch(() => '')));
}
async function checkPage(page, stage) {
  const humanControl = humanControls.get(page.context());
  if (humanControl) await humanControl(page);
  const texts = await bodyTexts(page);
  const robotControls = await find(page, f => f.locator('input[name="cf-turnstile-response"], input[name="g-recaptcha-response"], .h-captcha, .cf-turnstile, .g-recaptcha, iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"]').filter({ visible: true }));
  const challengeFields = await Promise.all(portalFrames(page).map(f => f.locator('input[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="h-captcha-response"]').count()));
  if (!humanControl && (robotControls.length || challengeFields.some(Boolean) || texts.some(t => /no soy un robot|i.m not a robot|verifica que eres humano|verify you are human/i.test(t))))
    fail('LOGIN_CHALLENGE', stage, 'El banco exige un control de robot o Turnstile; se detuvo la sesión sin resolverlo ni reintentar el ingreso.');
  if (texts.some(t => /sesión (?:ha )?(?:expirad|caducad)|sesi[oó]n finalizada|session expired/i.test(t)))
    fail('SESSION_EXPIRED', stage, 'La sesión bancaria expiró.');
  if (texts.some(t => /servicio (?:no disponible|temporalmente)|ocurri[oó] un error|intente m[aá]s tarde|access denied|^Forbidden$|p[aá]gina no encontrada/i.test(t)))
    fail('BANK_PAGE_ERROR', stage, 'El banco mostró un error de página o servicio.');
  if (texts.some(t => /request rejected|requested url was rejected|support id|verify you are human|checking your browser|just a moment/i.test(t)))
    fail('BANK_ACCESS_CHALLENGE', stage, 'El acceso del banco fue interceptado por una validación de seguridad.');
}
function trusted(url, bank) {
  try { const u = new URL(url); return u.protocol === 'https:' && (bank === 'personas' ? (u.hostname === 'bci.cl' || u.hostname.endsWith('.bci.cl')) : u.hostname === 'www.liderbciserviciosfinancieros.cl'); } catch { return false; }
}
export async function goto(page, url, stage) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: WAIT });
  const humanControl = humanControls.get(page.context());
  if (humanControl) await humanControl(page);
  if (!response || response.status() >= 400) fail('BANK_HTTP_ERROR', stage, `El portal no respondió correctamente (HTTP ${response?.status() ?? 'sin respuesta'}).`);
  await settle(page, stage);
}
export async function login(context, bank, creds, log = () => {}) {
  let page = await context.newPage(); const stage = `${bank}.login`;
  log(stage);
  await goto(page, ROOTS[bank], stage);
  log(`${stage}.discover-form`);
  // Discover the public entrypoint from its semantic controls, not a private URL/session.
  let passwords = []; let links = [];
  const formDeadline = Date.now() + WAIT;
  while (Date.now() < formDeadline) {
    await checkPage(page, stage);
    passwords = await find(page, f => f.locator('input[type="password"]'));
    links = await find(page, f => f.locator('a').filter({ hasText: /^\s*(Banco\s+en\s+L[ií]nea|Ingresa a tu cuenta|Ingresar|Sucursal virtual)\s*$/i }));
    if (passwords.length || links.length) break;
    await pause(300);
  }
  if (!passwords.length) {
    log(`${stage}.discover-entry`);
    const entries = [];
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && href !== '#' && trusted(new URL(href, page.url()).href, bank)) entries.push(link);
    }
    const targets = new Set(await Promise.all(entries.map(e => e.getAttribute('href'))));
    if (targets.size !== 1) fail('LOGIN_ENTRY_CHANGED', stage, 'No se identificó un acceso público único al banco.');
    const link = entries[0];
    const href = await link.getAttribute('href');
    if (href && href !== '#') {
      const target = new URL(href, page.url()).href;
      if (!trusted(target, bank)) fail('UNTRUSTED_LOGIN', stage, 'El acceso descubierto no pertenece al banco.');
      // Follow the bank's own control, preserving its click handler/referrer.
      await link.click({ timeout: WAIT });
      await pause(300);
      const bankPages = context.pages().filter(p => !p.isClosed() && trusted(p.url(), bank));
      page = bankPages.at(-1) ?? page;
      await settle(page, stage);
    } else { await link.click(); await settle(page, stage); }
    passwords = await find(page, f => f.locator('input[type="password"]'));
  }
  if (passwords.length !== 1 || !trusted(page.url(), bank)) fail('LOGIN_FORM_CHANGED', stage, 'No se identificó un formulario único y seguro de ingreso.');
  const password = passwords[0];
  const owner = await password.evaluate(el => ({ action: el.form?.action || location.href, origin: location.href }));
  if (!trusted(owner.action, bank) || !trusted(owner.origin, bank)) fail('UNTRUSTED_LOGIN', stage, 'El formulario de ingreso apunta fuera del banco.');
  const form = password.locator('xpath=ancestor::form[1]');
  const rutFields = await visible(form.locator('input[placeholder*="RUT" i], input[name="rut_aux"], input[autocomplete="username"]'));
  if (rutFields.length !== 1) fail('LOGIN_FORM_CHANGED', stage, 'No se identificó el campo RUT del formulario de ingreso.');
  const rut = rutFields[0];
  const prefix = bank === 'personas' ? 'BCI_PERSONAS' : 'BCI_LIDER';
  await checkPage(page, stage);
  log(`${stage}.fill-rut`);
  await rut.fill(creds[prefix + '_RUT']); await rut.press('Tab');
  log(`${stage}.fill-password`);
  await password.fill(creds[prefix + '_CLAVE']); await password.press('Tab');
  log(`${stage}.submit`);
  const submit = await one(page, f => f.getByRole('button', { name: /^Ingresar$/i }), stage);
  if (await password.inputValue() !== creds[prefix + '_CLAVE']) fail('LOGIN_FORM_CHANGED', stage, 'El formulario alteró la clave; no se envió el ingreso.');
  const hiddenRut = form.locator('input[type="hidden"][name="rut"]');
  if (await hiddenRut.count()) {
    const cleanRut = creds[prefix + '_RUT'].replace(/[^\dkK]/g, '').toUpperCase();
    const hiddenDv = form.locator('input[type="hidden"][name="dig"]');
    if (await hiddenRut.inputValue() !== cleanRut.slice(0, -1) || !(await hiddenDv.count()) || (await hiddenDv.inputValue()).toUpperCase() !== cleanRut.slice(-1))
      fail('LOGIN_FORM_CHANGED', stage, 'El formulario no preparó el RUT correctamente; no se envió el ingreso.');
  }
  const deadline = Date.now() + WAIT;
  while (!(await submit.isEnabled()) && Date.now() < deadline) { await checkPage(page, stage); await pause(300); }
  await checkPage(page, stage);
  if (!(await submit.isEnabled())) {
    if ((await visible(form.locator('input.ng-invalid:not([type="hidden"]), input:invalid:not([type="hidden"])'))).length)
      fail('LOGIN_FORM_REJECTED', stage, 'El formulario del banco no validó los campos de ingreso.');
    const challenge = page.locator('input[name="cf-turnstile-response"]');
    if (await challenge.count() && !(await challenge.first().inputValue()))
      fail('LOGIN_CHALLENGE', stage, 'El banco exige completar Turnstile; no se enviaron las credenciales.');
    fail('LOGIN_FORM_REJECTED', stage, 'El banco no habilitó el formulario de ingreso.');
  }
  // Exactly one login submission; no password retries that could lock the account.
  let failedStatus = null;
  const responseListener = response => {
    if (trusted(response.url(), bank) && response.request().isNavigationRequest() && response.status() >= 400) failedStatus = response.status();
  };
  context.on('response', responseListener);
  await submit.click({ timeout: WAIT });
  log(`${stage}.wait-authentication`);
  const loginDeadline = Date.now() + WAIT;
  let selectedOwner = false; let followedHandoff = false; let skippedDeviceRegistration = false;
  let lastState = 'unknown';
  while (Date.now() < loginDeadline) {
    await pause(350);
    if (failedStatus) fail('LOGIN_HTTP_ERROR', stage, `El acceso del banco respondió HTTP ${failedStatus}.`);
    const pages = context.pages().filter(p => !p.isClosed() && trusted(p.url(), bank));
    page = pages.at(-1) ?? page;
    if (!trusted(page.url(), bank)) continue;
    const texts = await bodyTexts(page);
    await checkPage(page, stage);
    // Actual authentication_service alternative: optional trusted-device enrollment.
    // Skip only this identified optional prompt; never enroll or approve a challenge.
    if (!skippedDeviceRegistration && new URL(page.url()).hostname === 'login.bci.cl' &&
        texts.some(t => /Registra tu Dispositivo de confianza/i.test(t) && /proceso opcional/i.test(t))) {
      const skip = await one(page, f => f.getByRole('button', { name: /^Omitir$/i }), stage);
      skippedDeviceRegistration = true;
      await skip.click({ timeout: WAIT });
      await settle(page, stage);
      log(`${stage}.skip-optional-device-registration`);
      continue;
    }
    // Some versions of the public authentication endpoint return a JSON handoff.
    // Only follow a bank-owned redirect, never a URL supplied by arbitrary page text.
    if (!followedHandoff && new URL(page.url()).hostname === 'login.bci.cl') {
      const payloads = [...texts, ...await page.locator('pre').allTextContents()].filter(t => /^\s*\{/.test(t));
      for (const text of payloads) {
        let payload; try { payload = JSON.parse(text); } catch { continue; }
        if (payload.error || payload.success === false) fail('LOGIN_REJECTED', stage, 'El servicio de autenticación rechazó el ingreso.');
        const data = payload.data ?? payload;
        const target = data.redirectUrl ?? data.urlRedirect ?? data.urlRedireccion ?? data.redirect ?? data.url;
        if (typeof target === 'string' && trusted(target, bank)) {
          await goto(page, target, stage); followedHandoff = true; log(`${stage}.follow-bank-handoff`); break;
        }
        // Schema only: never expose response values, tokens or credentials.
        const keys = Object.keys(payload).filter(k => /^[a-z_]{1,30}$/i.test(k) && !Object.values(creds).includes(k));
        fail('LOGIN_RESPONSE_UNSUPPORTED', stage, `El servicio de autenticación respondió sin redirección reconocida (campos: ${keys.join(', ')}).`);
      }
      const handoffs = await page.locator('form').evaluateAll(forms => forms.map((f, index) => ({
        index, action: f.action, method: f.method,
        hiddenOnly: Array.from(f.elements).every(e => e.type === 'hidden' || e.type === 'submit'),
        names: Array.from(f.elements, e => e.name || '')
      })));
      const candidates = handoffs.filter(f => trusted(f.action, bank) && f.method.toLowerCase() === 'post' && f.hiddenOnly &&
        /\/(?:nuevaWeb|bciWeb|cl\/bci\/aplicaciones\/seguridad\/autenticacion)(?:\/|$)/.test(new URL(f.action).pathname) &&
        f.names.some(n => /token|jwt|ticket/i.test(n)) && !f.names.some(n => /monto|destino|amount|transfer/i.test(n)));
      if (candidates.length === 1) {
        followedHandoff = true; log(`${stage}.follow-bank-handoff`);
        await page.locator('form').nth(candidates[0].index).evaluate(f => f.requestSubmit());
        continue;
      }
    }
    if (!selectedOwner && texts.some(t => /Seleccione si desea consultar como adicional o titular/i.test(t))) {
      const owner = await one(page, f => f.locator('input[value*="Titular"], input[value*="titular"]'), stage);
      await owner.click(); selectedOwner = true; log(`${stage}.select-account-owner`); continue;
    }
    if (texts.some(t => /(?:clave|rut|credenciales).{0,35}(?:incorrect|inv[aá]lid|bloquead)|intentos (?:restantes|fallidos)/i.test(t)))
      fail('LOGIN_REJECTED', stage, 'El banco rechazó las credenciales o bloqueó el ingreso.');
    if (texts.some(t => /ingresa (?:el )?c[oó]digo|autoriza.{0,25}(?:app|bcipass)|verificaci[oó]n en dos pasos/i.test(t)))
      fail('LOGIN_CHALLENGE', stage, 'El banco exige una validación adicional al RUT y clave.');
    const hasPassword = (await find(page, f => f.locator('input[type="password"]'))).length > 0;
    const bankMenu = await find(page, f => f.getByText(/^(Mi\s*Banco|Mi\s*Cuenta|Mis\s*movimientos|Tarjetas)$/i));
    const signedIn = bank === 'lider' ? new URL(page.url()).pathname.startsWith('/private-home') && texts.some(t => /Mi Tarjeta|Resumen|Saldos/i.test(t)) : !hasPassword && (bankMenu.length > 0 || texts.some(t => /(?:8080|1164)/.test(t) && /(?:Cerrar sesi[oó]n|Mis productos|Saldo disponible)/i.test(t)));
    if (signedIn) { context.off('response', responseListener); await settle(page, stage); log(`${bank}.authenticated`); return page; }
    const route = new URL(page.url());
    const locationKind = route.hostname === 'login.bci.cl' ? 'authentication_service' : route.pathname.startsWith('/nuevaWeb') ? 'personas_app' : route.pathname.startsWith('/cl/bci') ? 'legacy_app' : 'other_bank_route';
    lastState = (await find(page, f => f.locator('input[type="password"]'))).length ? 'login_form_still_visible' : texts.every(t => !t.trim()) ? 'empty_page' : `unrecognized_bank_page:${locationKind}`;
  }
  fail('LOGIN_FAILED', stage, `El banco no confirmó el ingreso dentro del plazo (${lastState}).`);
}
async function identity(page, lastFour, stage) {
  const deadline = Date.now() + PAGE_WAIT;
  while (Date.now() < deadline) {
    await checkPage(page, stage);
    if ((await bodyTexts(page)).some(t => new RegExp(`(?:[*•xX\\s.-]|\\d)${lastFour}(?!\\d)`).test(t))) return;
    await pause(300);
  }
  fail('ACCOUNT_NOT_VERIFIED', stage, `No se confirmó la cuenta terminada en ${lastFour}.`);
}
async function parseDownload(path, kind, currency, state) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [join(HERE, 'bridge.py'), kind, path, currency, state], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), WAIT);
    child.on('error', () => { clearTimeout(timer); reject(new BankError('PARSER_FAILED', 'download', 'No se pudo ejecutar el lector de cartolas.')); });
    child.on('close', code => { clearTimeout(timer); try { const data = JSON.parse(out); if (code || data.error) throw Error(); resolve(data); } catch { reject(new BankError('INVALID_DOWNLOAD', 'download', 'La descarga no es una cartola bancaria válida.')); } });
  });
}
export async function download(page, directory, kind, currency = 'CLP', state = '', seq = 0) {
  const stage = `personas.${kind}.${currency}.${state}.download`;
  let button; const deadline = Date.now() + PAGE_WAIT;
  while (!button && Date.now() < deadline) {
    await checkPage(page, stage);
    button = await one(page, f => f.getByText(/^Descargar Excel$/i), stage, true);
    if (!button) button = await one(page, f => f.locator('a,button').filter({ hasText: /^\s*Descargar Excel\s*(?:cloud_download|download)\s*$/i }), stage, true);
    if (!button) button = await one(page, f => f.locator('a[title*="Excel" i], button[title*="Excel" i], [aria-label*="Excel" i], a[download$="xlsx"], a[download$="xls"], [title*="exportar" i], [aria-label*="exportar" i]'), stage, true);
    if (!button && kind === 'checking') {
      button = await one(page, f => f.locator('li#exportarExcel').filter({ hasText: /Exportar a excel/i }), stage, true);
    }
    if (!button && kind === 'checking') {
      // Document icon on the bank's current-account movement header.
      button = await one(page, f => f.locator('a,button').filter({ has: f.locator('[class*="excel" i], [class*="export" i], [class*="file" i]') }), stage, true);
    }
    if (!button) await pause(300);
  }
  if (!button) fail('DOWNLOAD_CONTROL_MISSING', stage, 'El portal no ofrece un control inequívoco de descarga Excel.');
  let rejectHTTP;
  const failedHTTP = new Promise((_, reject) => { rejectHTTP = reject; });
  const responseCheck = response => {
    if (trusted(response.url(), 'personas') && /\/(?:excel|reporte)$/.test(new URL(response.url()).pathname) && !response.ok())
      rejectHTTP(new BankError('BANK_HTTP_ERROR', stage, `Falló la descarga bancaria (HTTP ${response.status()}).`));
  };
  page.on('response', responseCheck);
  let file;
  try {
    const waiting = page.waitForEvent('download', { timeout: WAIT });
    [file] = await Promise.race([Promise.all([waiting, button.click({ timeout: WAIT })]), failedHTTP]);
  } catch (error) {
    await checkPage(page, stage);
    if (error instanceof BankError) throw error;
    fail('DOWNLOAD_FAILED', stage, 'El banco no completó la descarga de la cartola dentro del plazo.');
  } finally { page.off('response', responseCheck); }
  if (await file.failure()) fail('DOWNLOAD_FAILED', stage, 'Falló la descarga de la cartola.');
  const path = join(directory, `${kind}-${currency}-${state}-${seq}.xlsx`);
  await file.saveAs(path); await chmod(path, 0o600);
  return parseDownload(path, kind, currency, state);
}
export async function navigateChecking(page, log = () => {}) {
  const stage = 'personas.checking.navigation'; log(stage);
  await clickText(page, /^Mi Banco$/i, stage, true);
  // The modern dashboard loads after the menu. Its account-specific shortcut
  // avoids the duplicated Mi Cuenta entry belonging to Cuenta Familia.
  const legacyMovements = await find(page, f => f.getByText(/^\s*Últimos Movimientos\s*$/i, { exact: true }));
  if (!legacyMovements.length) {
    // A legacy menu can live on the same host as the modern dashboard. Open
    // its unique account section before assuming a dashboard must be present.
    let accountSections = await find(page, f => f.locator('a,button').and(f.getByTitle(/^Mi Cuenta$/i, { exact: true })));
    if (!accountSections.length) accountSections = await find(page, f => f.getByText(/^\s*Mi Cuenta\s*$/i, { exact: true }));
    if (accountSections.length === 1) {
      await accountSections[0].click({ timeout: WAIT }); await settle(page, stage);
      await clickText(page, /^Últimos Movimientos$/i, stage);
      return;
    }
  }
  if (new URL(page.url()).hostname === 'personas.bci.cl' && legacyMovements.length !== 1) {
    await page.locator('a[title="Ir a Últimos Movimientos" i]').or(page.getByText(/^Ir a [úu]ltimos Movimientos$/i, { exact: true })).waitFor({ state: 'visible', timeout: WAIT });
  }
  const dashboard = await one(page, f => f.locator('a[title="Ir a Últimos Movimientos" i]').or(f.getByText(/^Ir a [úu]ltimos Movimientos$/i, { exact: true })), stage, true);
  if (dashboard) {
    const account = await one(page, f => f.locator('select[name="account_selector"]'), stage);
    const options = await account.locator('option').evaluateAll(es => es.filter(e => /Corriente.*8080/.test(e.textContent)).map(e => e.value));
    if (options.length !== 1) fail('ACCOUNT_NOT_VERIFIED', stage, 'No se identificó la cuenta corriente en el resumen.');
    await account.selectOption(options[0]); await settle(page, stage);
    await dashboard.click({ timeout: WAIT }); await settle(page, stage);
  } else {
    await clickText(page, /^Mi Cuenta$/i, stage, true);
    await clickText(page, /^Últimos Movimientos$/i, stage);
  }
}
export async function navigateCards(page, log = () => {}) {
  const stage = 'personas.card.navigation'; log(stage);
  await clickText(page, /^Tarjetas$/i, stage);
  const cardMovements = await textControl(page, /^Mis movimientos$/i, stage);
  try { await cardMovements.click({ trial: true, timeout: 1500 }); }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    await checkPage(page, stage);
    // Observed modern sidebar: clipped children become clickable via its
    // own Expandir Todo control. The direct route above remains unchanged.
    const expand = await textControl(page, /^Expandir Todo$/i, stage);
    await expand.click({ timeout: WAIT }); await settle(page, stage);
  }
  await clickText(page, /^Mis movimientos$/i, stage);
}
export async function navigateCardHistory(page, log = () => {}) {
  const stage = 'personas.card.history'; log(stage);
  await clickText(page, /^Estado de cuenta$/i, stage);
  await identity(page, '1164', stage);
}
export async function selectCardCurrency(page, currency, log = () => {}) {
  const stage = `personas.card.${currency}.currency`; log(stage);
  const label = currency === 'CLP' ? /^Nacional\s*\$$/i : /^Internacional\s*USD$/i;
  let tab = await textControl(page, label, stage, true);
  // Some loads stop at the card selector before creating the currency tabs.
  // Explicitly selecting the existing card completes that intermediate step;
  // the already-working direct tab path remains first.
  if (!tab && currency === 'CLP') {
    const deadline = Date.now() + 10000;
    while (!tab && Date.now() < deadline) {
      await checkPage(page, stage); await pause(300);
      tab = await textControl(page, label, stage, true);
    }
    if (!tab) {
      const selectors = [];
      for (const control of await find(page, f => f.locator('select'))) {
        const options = await control.locator('option').evaluateAll(es => es.filter(e => /\*{4}\s*1164\s*$/.test(e.textContent)).map(e => e.value));
        if (options.length === 1) selectors.push({ control, value: options[0] });
      }
      if (selectors.length === 1) {
        log(`${stage}.select-card`);
        await selectors[0].control.selectOption(selectors[0].value, { timeout: WAIT });
        await settle(page, stage);
      }
    }
  }
  await clickText(page, label, stage);
}
async function downloadHistoricalPDF(page, directory, currency, sequence) {
  const stage = `personas.card.history.${currency}.pdf`;
  await checkPage(page, stage);
  const pages = new Set(page.context().pages());
  const waiting = page.waitForResponse(r => trusted(r.url(), 'personas') && new URL(r.url()).pathname.endsWith('/estado-cuenta-tc/pdf'), { timeout: WAIT });
  const [response] = await Promise.all([waiting, clickText(page, /^Revisar documento$/i, stage)]);
  if (!response.ok()) fail('BANK_HTTP_ERROR', stage, 'El banco no pudo entregar el estado de cuenta PDF.');
  const content = (await response.text()).trim();
  if (content.length > 40_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(content)) fail('INVALID_DOWNLOAD', stage, 'El banco no devolvió un PDF válido.');
  const bytes = Buffer.from(content, 'base64');
  if (bytes.subarray(0, 5).toString() !== '%PDF-') fail('INVALID_DOWNLOAD', stage, 'El documento bancario no es un PDF.');
  const path = join(directory, `card-${currency}-history-${sequence}.pdf`);
  await writeFile(path, bytes, { mode: 0o600 });
  for (const popup of page.context().pages()) if (!pages.has(popup)) await popup.close();
  await checkPage(page, stage);
  return parseDownload(path, 'card-pdf', currency, 'billed');
}
async function readCardHistory(page, directory, accounts, requested, log) {
  await navigateCardHistory(page, log);
  for (const currency of ['CLP', 'USD']) {
    const stage = `personas.card.history.${currency}`; log(stage);
    const type = await one(page, f => f.locator('select[formcontrolname="selectTipoCuenta"]'), stage);
    await type.selectOption({ label: currency === 'CLP' ? 'Nacional' : 'Internacional' });
    await settle(page, stage);
    let selector; let options;
    const deadline = Date.now() + PAGE_WAIT;
    do {
      await checkPage(page, stage);
      for (const control of await find(page, f => f.locator('select'))) {
        const dates = await control.locator('option').evaluateAll(es => es.filter(e => !e.disabled && /^\s*(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*$/.test(e.textContent)).map(e => ({value:e.value,label:e.textContent.trim()})));
        if (dates.length) { selector = control; options = dates; break; }
      }
      if (!selector) await pause(300);
    } while (!selector && Date.now() < deadline);
    if (!selector) fail('PAGE_CHANGED', stage, 'No aparecieron los períodos históricos de la tarjeta.');
    const account = accounts.find(a => a.currency === currency && a.last_four === '1164');
    account.statements ??= [];
    options.sort((a,b) => bankDate(b.label).localeCompare(bankDate(a.label)));
    for (let i = 0; i < Math.min(options.length, 36); i++) {
      if (account.statements.some(p => p.billing_date === bankDate(options[i].label))) continue;
      await selector.selectOption(options[i].value); await settle(page, stage);
      let result;
      if (/^\d{4}-\d{2}-\d{2}$/.test(options[i].label)) {
        // This observed history variant returns the latest Excel regardless of
        // the ISO period selection. Its PDF control honors the selected cycle.
        log(`${stage}.pdf-selected-period`);
        result = await downloadHistoricalPDF(page, directory, currency, i);
      } else {
        result = await download(page, directory, 'card', currency, 'billed', `history-${i}`);
        if (result.statement_period.billing_date !== bankDate(options[i].label)) {
          log(`${stage}.pdf-selected-period`);
          result = await downloadHistoricalPDF(page, directory, currency, i);
        }
      }
      if (result.statement_period.billing_date !== bankDate(options[i].label)) fail('WRONG_STATEMENT', stage, 'La descarga no corresponde al período seleccionado.');
      account.statements.push(result.statement_period);
      account.movements = mergeStatementRows(account.movements, result.movements);
      log(`${stage}.downloaded.${result.statement_period.from}.${result.statement_period.billing_date}`);
      if (result.statement_period.from <= requested.from) break;
    }
  }
}
export function mergeStatementRows(existing, incoming) {
  const key = m => JSON.stringify([m.reference, m.date, m.name, m.amount]);
  const counts = new Map(); const used = new Map();
  for (const row of existing) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...existing, ...incoming.filter(row => {
    const k = key(row); const n = (used.get(k) ?? 0) + 1; used.set(k, n);
    return n > (counts.get(k) ?? 0);
  })];
}
function observePersonasQueries(page) {
  const evidence = {}; const pending = new Set();
  const listener = response => {
    const url = new URL(response.url());
    if (!trusted(url.href, 'personas')) return;
    const kind = url.pathname.endsWith('/cuentas-movimientos/por-numero-cuenta') ? 'checking' :
      url.pathname.endsWith('/mov-tdc/informacion-tdc') ? 'card' : null;
    if (!kind) return;
    const task = (async () => {
      if (!response.ok()) { evidence[kind] = null; return; }
      try {
        const data = await response.json();
        // Keep only the query evidence needed for completeness, never auth data.
        evidence[kind] = kind === 'checking' ? { order: data.ordenadoPor, dates: data.movimientos?.map(m => m.fechaMovimiento) } : {
          date: data.fechaActual,
          errors: [data.errorNacional, data.errorInternacional, data.errorNoFacturados],
          views: { CLP: { billed: data.facturadosNacionales?.length, unbilled: data.noFacturadosNacional?.length },
            USD: { billed: data.facturadosInternacionales?.length, unbilled: data.noFacturadosInternacional?.length } },
        };
      } catch { evidence[kind] = null; }
    })();
    pending.add(task); task.finally(() => pending.delete(task));
  };
  page.on('response', listener);
  return { evidence, async flush() { await Promise.all(pending); }, close() { page.off('response', listener); } };
}
export function establishPersonasCoverage(accounts, evidence) {
  if (!evidence.card?.date || !Array.isArray(evidence.card.errors) || evidence.card.errors.some(e => e === undefined || Boolean(e)))
    fail('PERIOD_NOT_VERIFIED', 'coverage', 'No se confirmó la consulta vigente de tarjetas con todas sus vistas.');
  const through = bankDate(evidence.card.date);
  const checking = accounts.find(a => a.id === 'bci_checking_clp');
  const query = evidence.checking;
  if (query?.order !== 'FECHA_TRANSACCION' || !Array.isArray(query.dates) || !query.dates.length)
    fail('PERIOD_NOT_VERIFIED', 'coverage', 'El banco no confirmó el orden por fecha de transacción de los últimos movimientos.');
  const dates = query.dates.map(d => bankDate(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(d) ? d.slice(0, 10) : d));
  if (dates.some((d, i) => i > 0 && d > dates[i - 1])) fail('PERIOD_NOT_VERIFIED', 'coverage', 'La respuesta no respeta el orden declarado por el banco.');
  const exported = checking.movements.map(m => m.date).sort();
  if (JSON.stringify(dates.toSorted()) !== JSON.stringify(exported))
    fail('INCOMPLETE_DOWNLOAD', 'coverage', 'El Excel no contiene todos los movimientos de la consulta bancaria.');
  // This is a bounded latest-N query, not an arbitrary collection of old rows.
  // Exclude its boundary day: additional transactions on that day may be truncated.
  const from = new Date(Date.parse(exported[0]) + 86400000).toISOString().slice(0, 10);
  checking.coverage = { complete: true, date_basis: 'transaction-date', source: 'bank-portal',
    method: 'latest-transactions-complete-export', order: query.order, returned_rows: dates.length,
    boundary_day_excluded: exported[0], intervals: [{ from, to: through }] };
  for (const account of accounts.filter(a => a.last_four === '1164')) {
    if (!account.unbilled_period || !account.statements?.length)
      fail('PERIOD_NOT_VERIFIED', 'coverage', 'Faltan cartolas de facturación o la consulta vigente.');
    for (const view of ['billed', 'unbilled']) {
      const count = evidence.card.views?.[account.currency]?.[view];
      if (!Number.isInteger(count) || count !== account.current_views?.[view]) fail('INCOMPLETE_DOWNLOAD', 'coverage', 'Las filas de la tarjeta no coinciden con la consulta bancaria completa.');
    }
    account.coverage = { complete: true, date_basis: 'billing-cycle', filter_date_basis: 'transaction-date', source: 'bank-export',
      method: 'billing-statements-and-current-unbilled', bank_query_date: through,
      intervals: [...account.statements.map(p => ({ from: p.from, to: p.billing_date })),
        { from: account.unbilled_period.from, to: through }] };
  }
}
export async function readPersonas(page, directory, log, requested) {
  const observed = observePersonasQueries(page);
  try {
  await navigateChecking(page, log);
  let stage = 'personas.checking.navigation';
  await identity(page, '8080', stage);
  const checking = await download(page, directory, 'checking');
  const accounts = [{ id: 'bci_checking_clp', last_four: '8080', currency: 'CLP', ...checking }];
  stage = 'personas.card.navigation';
  await navigateCards(page, log);
  await identity(page, '1164', stage);
  for (const currency of ['CLP', 'USD']) {
    stage = `personas.card.${currency}`; log(stage);
    await selectCardCurrency(page, currency, log);
    let movements = []; const statements = []; const current_views = {}; let unbilled_period; let available; let name;
    for (const billed of [false, true]) {
      const state = billed ? 'billed' : 'unbilled';
      log(`${stage}.${state}`);
      await clickText(page, billed ? /^Facturados$/i : /^No facturados$/i, stage);
      // Discover billing-period dropdowns by option text, excluding card and page-size selectors.
      const choices = await find(page, f => f.locator('select'));
      const periods = [];
      for (const control of choices) {
        const opts = await control.locator('option').evaluateAll(es => es.filter(e => !e.disabled && e.value).map(e => ({ value: e.value, label: e.textContent.trim() })));
        if (opts.some(o => /(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\d{1,2}[/-]\d{1,2}[/-]\d{4})/i.test(o.label))) periods.push({ control, opts });
      }
      if (periods.length > 1) fail('AMBIGUOUS_PERIOD', stage, 'Más de un selector de período; no se pudo asegurar la búsqueda.');
      const options = periods[0]?.opts ?? [null];
      if (options.length > 36) fail('PERIOD_LIMIT', stage, 'El portal excedió el límite de períodos de consulta.');
      for (let i = 0; i < options.length; i++) {
        if (options[i]) { await periods[0].control.selectOption(options[i].value); await settle(page, stage); }
        const result = await download(page, directory, 'card', currency, state, i);
        if (i === 0) current_views[state] = result.movements.length;
        name = result.name;
        if (!billed) { available = result.available; unbilled_period = result.statement_period; }
        else statements.push(result.statement_period);
        movements = mergeStatementRows(movements, result.movements.map(m => ({ ...m, statement: options[i]?.label ?? state })));
      }
    }
    if (available === undefined || available === null) fail('MISSING_BALANCE', stage, 'No se obtuvo el disponible de la tarjeta.');
    accounts.push({ id: 'bci_card_' + currency.toLowerCase(), last_four: '1164', currency, name, available, statements, unbilled_period, current_views,
      movements });
  }
  // Until the portal query establishes its bounds, these default downloads
  // cannot certify an arbitrary requested period, regardless of row dates.
  if (accounts.some(a => a.statements?.every(p => p.from > requested.from))) await readCardHistory(page, directory, accounts, requested, log);
  await observed.flush(); establishPersonasCoverage(accounts, observed.evidence);
  assertPeriodCoverage(accounts, requested);
  return accounts;
  } finally { observed.close(); }
}
export async function leaderBalances(page) {
  const stage = 'lider.balances';
  await goto(page, ROOTS.lider + 'private-home/my-card/balances', stage);
  if (!new URL(page.url()).pathname.startsWith('/private-home')) fail('SESSION_EXPIRED', stage, 'Líder redirigió al ingreso.');
  await identity(page, '9015', stage);
  const candidates = await page.locator('table:visible').evaluateAll(tables => tables.map(t => Array.from(t.rows, r => Array.from(r.cells, c => c.innerText.trim()))));
  const balances = {};
  for (const rows of candidates) {
    const header = rows.find(r => r.some(c => /^Disponible$/i.test(c)) && r.some(c => /Autorizado/i.test(c)));
    if (!header) continue;
    const idx = header.findIndex(c => /^Disponible$/i.test(c));
    for (const row of rows) {
      const currency = row.some(c => /Internacional|USD/i.test(c)) ? 'USD' : row.some(c => /Nacional|CLP/i.test(c)) ? 'CLP' : null;
      if (currency && row[idx]) balances[currency] = bankMoney(row[idx], currency);
    }
  }
  // Responsive balance component uses divs rather than a native table.
  if (!balances.CLP || !balances.USD) {
    const texts = await bodyTexts(page);
    for (const currency of ['CLP', 'USD']) {
      const label = currency === 'CLP' ? /(?:^|\n)Nacional(?:es)?\b([\s\S]*?)(?=\nInternacional|$)/i : /(?:^|\n)Internacional(?:es)?\b([\s\S]*?)(?=\nValor del d[oó]lar|$)/i;
      const sections = texts.map(t => t.match(label)?.[1]).filter(Boolean);
      const values = sections.map(s => s.match(/Disponible\s*\n?\s*((?:US\$|USD|\$)\s*-?[\d.,]+)/i)?.[1]).filter(Boolean);
      if (values.length === 1) balances[currency] = bankMoney(values[0], currency);
    }
  }
  if (!balances.CLP || !balances.USD) fail('MISSING_BALANCE', stage, 'No se identificaron ambos disponibles en Saldos de Líder.');
  return balances;
}
export async function leaderRows(page, currency, billing) {
  const stage = `lider.${currency}.${billing}`;
  const all = []; const visited = new Set(); let explicitEmpty = false;
  for (let p = 1; p <= 100; p++) {
    await settle(page, stage);
    const tables = await visible(page.locator('app-movements table'));
    if (tables.length !== 1) fail('PAGE_CHANGED', stage, 'Tabla de movimientos Líder ausente o ambigua.');
    const table = tables[0];
    const rows = await table.locator('tr').evaluateAll(es => es.filter(e => e.getBoundingClientRect().height && !e.closest('tfoot')).map(r => Array.from(r.children, c => c.textContent.trim())));
    const header = rows.find(r => r.includes('Fecha') && r.includes('Monto'));
    if (!header || !header.some(c => /Descripci[oó]n/i.test(c))) fail('PAGE_CHANGED', stage, 'Cabecera de movimientos Líder cambió.');
    const fingerprint = JSON.stringify(rows);
    if (visited.has(fingerprint)) fail('PAGINATION_STUCK', stage, 'La paginación repitió una página.');
    visited.add(fingerprint);
    for (const cells of rows.slice(rows.indexOf(header) + 1)) {
      if (cells.some(c => /^Sin movimientos para mostrar$/i.test(c))) { explicitEmpty = true; continue; }
      if (cells.length !== header.length) fail('INCOMPLETE_ROW', stage, 'Fila de cartola Líder incompleta.');
      const name = cells[header.findIndex(c => /Descripci[oó]n/i.test(c))];
      if (!name) fail('INCOMPLETE_ROW', stage, 'Movimiento Líder sin descripción.');
      all.push({ date: bankDate(cells[header.indexOf('Fecha')]), name,
        amount: bankMoney(cells[header.indexOf('Monto')], currency), billing, page: p, source: 'bank-portal' });
    }
    if (explicitEmpty && all.length) fail('CONTRADICTORY_EMPTY', stage, 'El banco mostró filas y estado vacío simultáneamente.');
    // Published portal component has numbered pages; arrows only appear above 4 pages.
    const nextNumber = table.locator('.paginationNumber').filter({ hasText: new RegExp(`^\\s*${p + 1}\\s*$`) });
    const numbered = await visible(nextNumber);
    if (numbered.length === 1) { await numbered[0].click(); continue; }
    const arrow = await visible(table.locator('.cubeArrow').filter({ has: page.locator('.arrow-right') }));
    if (arrow.length === 1) { await arrow[0].click(); continue; }
    if (!all.length && !explicitEmpty) fail('UNCONFIRMED_EMPTY', stage, 'Tabla vacía sin confirmación del banco.');
    return { movements: all, explicit_empty: explicitEmpty, pages: p };
  }
  fail('PAGINATION_LIMIT', stage, 'La paginación excedió el límite de seguridad.');
}
export async function readLider(page, log, requested) {
  log('lider.balances'); const balances = await leaderBalances(page);
  await goto(page, ROOTS.lider + 'private-home/my-card/movements', 'lider.movements');
  const accounts = [];
  for (const currency of ['CLP', 'USD']) {
    const stage = `lider.${currency}`; log(stage);
    await clickText(page, currency === 'CLP' ? /^Nacionales$/i : /^Internacionales$/i, stage);
    const movements = []; const views = [];
    for (const billing of ['unbilled', 'billed']) {
      await clickText(page, billing === 'unbilled' ? /^Por facturar\s*$/i : /^Último periodo facturado$/i, stage);
      const result = await leaderRows(page, currency, billing);
      movements.push(...result.movements); views.push({ billing, pages: result.pages, explicit_empty: result.explicit_empty });
    }
    accounts.push({ id: 'lider_card_' + currency.toLowerCase(), last_four: '9015', currency, available: balances[currency], movements, views });
  }
  // Current/unbilled plus latest billed is not necessarily the entire request.
  assertPeriodCoverage(accounts, requested);
  return accounts;
}
export async function run({ from, to, bank = 'all', env = process.env, launch, headless = true, log = () => {}, adapters = { login, readPersonas, readLider } }) {
  if (bank === 'lider') return (await import('./lider-session.mjs')).runLider({ from, to, env, log });
  if (!['all', 'personas'].includes(bank)) fail('INVALID_BANK', 'configuration', 'Banco no admitido.');
  const banks = bank === 'personas' ? ['personas'] : ['personas', 'lider'];
  const requested = period(from, to); const creds = credentials(env, bank);
  let browser; let directory; const contexts = []; let stage = 'browser.start'; let expired = false;
  let timer;
  const close = async () => { for (const context of contexts) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); };
  const interrupted = () => { expired = true; void close(); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    // Do not enable Playwright API logging: fill() arguments contain secrets.
    delete process.env.DEBUG; delete process.env.PWDEBUG;
    const launchBrowser = launch ?? (await import('playwright')).chromium.launch.bind((await import('playwright')).chromium);
    const browserEnv = { ...process.env }; for (const key of CREDENTIAL_KEYS) delete browserEnv[key];
    browser = await launchBrowser({ headless, env: browserEnv });
    timer = setTimeout(interrupted, 300000);
    directory = await mkdtemp(join(tmpdir(), 'bci-statement-')); await chmod(directory, 0o700);
    const accounts = [];
    for (const bank of banks) {
      stage = `${bank}.session`;
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 }, locale: 'es-CL', timezoneId: 'America/Santiago', serviceWorkers: 'block' });
      contexts.push(context); context.setDefaultTimeout(WAIT);
      const progress = value => { stage = value; log(value); };
      let page;
      try {
        page = await adapters.login(context, bank, creds, progress);
        accounts.push(...await (bank === 'personas' ? adapters.readPersonas(page, directory, progress, requested) : adapters.readLider(page, progress, requested)));
      } finally {
        if (page && !page.isClosed()) {
          // Logout is best effort if the bank page itself failed; closing the
          // isolated browser context is unconditional below and in outer cleanup.
          try {
            const exits = await find(page, f => f.getByText(/^(Cerrar sesi[oó]n|Salir)$/i, { exact: true }));
            if (exits.length === 1) await exits[0].click({ timeout: 3000 });
          } catch { /* Never replace the original bank error with a logout error. */ }
        }
        await context.close().catch(() => {});
      }
    }
    if (accounts.length !== (bank === 'personas' ? 3 : 5)) fail('INCOMPLETE_RESULT', stage, 'No se extrajeron todas las cuentas del alcance solicitado.');
    assertPeriodCoverage(accounts, requested);
    for (const account of accounts) account.movements = account.movements.filter(m => from <= m.date && m.date <= to);
    return { mode: 'live', banks, period: requested, captured_at: new Date().toISOString(), accounts,
      amount_unit: 'CLP pesos / USD dollars; exact decimal strings', signs: { bci: 'credits positive, charges negative', lider: 'bank statement signs unchanged' } };
  } catch (error) {
    if (expired) fail('RUN_INTERRUPTED', stage, 'La corrida se interrumpió o excedió cinco minutos; no se devuelven datos.');
    if (error instanceof BankError) throw error;
    const category = ['TimeoutError', 'TypeError', 'Error'].includes(error?.name) ? error.name : 'Error';
    const network = String(error?.message).match(/net::ERR_[A-Z_]+/)?.[0];
    fail('BANK_PAGE_FAILED', stage, `No se pudo completar la página bancaria (${network ?? category}); no se devuelven datos.`);
  } finally {
    clearTimeout(timer); await close();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  }
}
export async function main(args = process.argv.slice(2), { launch, adapters, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = args.slice(4);
    if (args[0] !== '--from' || args[2] !== '--to' ||
        options.some((value, i) => value !== '--headed' && !(value === '--bank' && ['personas', 'lider'].includes(options[i + 1])) && !(['personas', 'lider'].includes(value) && options[i - 1] === '--bank')) ||
        options.filter(v => v === '--headed').length > 1 || options.filter(v => v === '--bank').length > 1)
      fail('INVALID_ARGUMENTS', 'configuration', 'Uso: node live.mjs --from YYYY-MM-DD --to YYYY-MM-DD [--headed] [--bank personas|lider]');
    const result = await run({ from: args[1], to: args[3], bank: options.includes('--bank') ? options[options.indexOf('--bank') + 1] : 'all', launch, adapters, headless: !options.includes('--headed'), log: stage => stderr.write((stage.startsWith('LIDER_CONTROL_URL ') ? stage : JSON.stringify({ stage })) + '\n') });
    stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0;
  } catch (error) {
    const e = error instanceof BankError ? error : new BankError('RUN_FAILED', 'runtime', 'Falló la extracción completa.');
    stderr.write(JSON.stringify({ error: { code: e.code, stage: e.stage, message: e.message } }) + '\n'); return 1;
  }
}
// Finish evaluating this module before the Líder session imports its helpers
// back from here. Awaiting main at top level deadlocks that dynamic import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(code => { process.exitCode = code; });
}
