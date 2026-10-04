/** Separate visible, read-only Líder session. No Personas login and no Wallit client. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BankError, CREDENTIAL_KEYS, goto, period, setHumanControlHandler } from './live.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const RESPONSE_FIELDS = 'input[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="h-captcha-response"]';
const WIDGETS = '.cf-turnstile, .g-recaptcha, .h-captcha, iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"]';

// Pure decision function: a completed provider does not excuse a different,
// visibly pending control. Empty auxiliary fields alone are not new challenges.
export function controlPending({ responses = [], widgets = [], text = '', checked = false }) {
  const success = checked || /(?:^|\n)\s*(?:Success!?|Verification successful|Verificaci[oó]n (?:exitosa|correcta)|[ÉE]xito)\s*(?:$|\n)/i.test(text);
  if (!success && /no soy un robot|i.m not a robot|verifica que eres humano|verifique que es un ser humano|verify you are human|checking your browser|just a moment/i.test(text)) return true;
  const completed = new Set(responses.filter(r => r.completed).map(r => r.provider));
  if (responses.some(r => !r.completed && (r.visibleWidget || !completed.has(r.provider)))) return true;
  return widgets.some(w => w.completed === false || (w.completed === null && !completed.has(w.provider) && !success));
}

export async function hasHumanControl(page) {
  if (page.isClosed?.()) throw new BankError('PAGE_CLOSED', 'lider.control', 'La página de Líder fue cerrada.');
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const text = await frame.locator('body').innerText({ timeout: 1500 });
      const responses = await frame.locator(RESPONSE_FIELDS).evaluateAll(elements => {
        const provider = e => e.name.includes('turnstile') ? 'turnstile' : e.name.includes('h-captcha') ? 'hcaptcha' : 'recaptcha';
        return elements.map(e => {
          const widget = e.closest('.cf-turnstile, .g-recaptcha, .h-captcha');
          const groupComplete = widget && [...widget.querySelectorAll('input[name$="-response"], textarea[name$="-response"]')].some(field => field.value.trim());
          return { provider:provider(e), completed:Boolean(e.value.trim()), visibleWidget:Boolean(widget?.getBoundingClientRect().height) && !groupComplete };
        });
      });
      const widgets = await frame.locator(WIDGETS).filter({ visible:true }).evaluateAll(elements => elements.map(e => {
        const identity = (e.className || '') + ' ' + (e.getAttribute('src') || '');
        const provider = /turnstile|cloudflare/.test(identity) ? 'turnstile' : /h-captcha|hcaptcha/.test(identity) ? 'hcaptcha' : 'recaptcha';
        const fields = [...e.querySelectorAll('input[name$="-response"], textarea[name$="-response"]')];
        return { provider, completed:fields.length ? fields.some(field => field.value.trim()) : null };
      }));
      const checked = await frame.locator('[role="checkbox"][aria-checked="true"]').count() > 0 && /recaptcha|hcaptcha|challenges\.cloudflare/.test(frame.url());
      if (controlPending({responses,widgets,text,checked})) return true;
    } catch (error) {
      if (page.isClosed?.()) throw new BankError('PAGE_CLOSED', 'lider.control', 'La página de Líder fue cerrada.');
      if (!frame.isDetached()) return true; // Unreadable control: wait, never submit.
    }
  }
  return false;
}

export function humanControlWaiter(write = line => process.stderr.write(line + '\n')) {
  const announced = new WeakMap();
  return async page => {
    if (!await hasHumanControl(page)) return;
    if (announced.get(page) !== page.url()) { write('LIDER_CONTROL_URL ' + page.url()); announced.set(page,page.url()); }
    while (await hasHumanControl(page)) await pause(1000);
  };
}

// Finite work budgets exclude human intervention. Start work only after the
// control clears; while it is present, even an already-arrived result waits.
export async function humanOperation(page, wait, start, { timeout = 20000, poll = 100 } = {}) {
  await wait(page);
  const controller = new AbortController();
  let settled = false; let value; let failure;
  const work = Promise.resolve().then(() => start(controller.signal)).then(v => { settled=true; value=v; }, e => { settled=true; failure=e; });
  let elapsed = 0;
  try {
    while (true) {
      await wait(page);
      if (settled) { if (failure) throw failure; return value; }
      if (elapsed >= timeout) throw new BankError('PAGE_TIMEOUT', 'lider.navigation', 'El control bancario no respondió dentro del plazo activo.');
      const started = Date.now();
      await Promise.race([work, pause(Math.min(poll,timeout-elapsed))]);
      elapsed += Date.now() - started;
    }
  } finally { controller.abort(); }
}

export async function humanCondition(page, wait, probe, options) {
  return humanOperation(page, wait, async signal => {
    while (!signal.aborted) {
      await wait(page);
      if (signal.aborted) return;
      const result = await probe();
      if (result) return result;
      await pause(100);
    }
  }, options);
}

// For reversible read-only navigation, retry only an actionability timeout.
// Never use this helper to submit credentials.
export async function humanReadClick(page, wait, locator) {
  return humanCondition(page, wait, async () => {
    try { await locator.click({timeout:250,noWaitAfter:true}); return true; }
    catch (error) { if (error?.name !== 'TimeoutError') throw error; return false; }
  });
}

// Attach the listener after the human wait, with no independent wall-clock
// timeout. Every listener is removed on completion, failure or active timeout.
export async function humanEvent(page, wait, event, predicate, action, options) {
  return humanOperation(page, wait, async signal => {
    let listener; let cancelled;
    const received = new Promise((resolve, reject) => {
      listener = value => { try { if (predicate(value)) resolve(value); } catch (error) { reject(error); } };
      cancelled = () => { page.off(event,listener); resolve(null); };
      page.on(event, listener);
      signal.addEventListener('abort', cancelled, {once:true});
    });
    try { const [value] = await Promise.all([received,action()]); return value; }
    finally { page.off(event,listener); signal.removeEventListener('abort',cancelled); }
  }, options);
}

export async function submissionAlreadyMade(page) {
  return page.evaluate(() => Boolean(window.__bciStatementSubmitted || sessionStorage.getItem('bci-statement.lider.submitted')));
}

async function claimSubmission(page) {
  const claimed = await page.evaluate(() => {
    if (window.__bciStatementSubmitted || sessionStorage.getItem('bci-statement.lider.submitted')) return false;
    sessionStorage.setItem('bci-statement.lider.submitted','1');
    window.__bciStatementSubmitted = true;
    return true;
  });
  if (!claimed) throw new BankError('LOGIN_ALREADY_SUBMITTED','lider.login','No se repite el ingreso de esta sesión.');
}

const submitted = new WeakSet();
export async function resumePreparedLider(page, env = process.env, log = line => process.stderr.write(line + '\n'), wait = humanControlWaiter(log)) {
  await wait(page);
  if (new URL(page.url()).origin !== 'https://www.liderbciserviciosfinancieros.cl') throw new BankError('UNTRUSTED_LOGIN', 'lider.login', 'Origen de ingreso inesperado.');
  if (submitted.has(page) || await submissionAlreadyMade(page)) throw new BankError('LOGIN_ALREADY_SUBMITTED', 'lider.login', 'No se repite el ingreso.');
  const password = page.locator('input[type="password"]:visible');
  if (await password.count() !== 1 || await password.inputValue() !== env.BCI_LIDER_CLAVE) throw new BankError('LOGIN_FORM_CHANGED', 'lider.login', 'El formulario no conserva la clave preparada.');
  const submit = page.getByRole('button', { name: /^Ingresar$/i });
  await humanCondition(page, wait, async () => await submit.isVisible() && await submit.isEnabled());
  await wait(page);
  await claimSubmission(page);
  submitted.add(page);
  // Exactly one issued click; keep monitoring for a control even if it appears
  // during actionability checks. No wall-clock deadline can cut the human wait.
  await humanOperation(page, wait, () => submit.click({ timeout:0, noWaitAfter:true }), {timeout:Infinity});
  log('lider.login.submitted-once');
  let elapsed = 0;
  while (elapsed < 60000) {
    await wait(page); // Human time does not consume the authentication deadline.
    if (new URL(page.url()).pathname.startsWith('/private-home')) { log('lider.authenticated'); return page; }
    const text = await page.locator('body').innerText();
    if (/(?:clave|rut|credenciales).{0,35}(?:incorrect|inv[aá]lid|bloquead)/i.test(text)) throw new BankError('LOGIN_REJECTED', 'lider.login', 'El banco rechazó el ingreso.');
    await pause(500); elapsed += 500;
  }
  throw new BankError('LOGIN_FAILED', 'lider.login', 'El banco no confirmó el ingreso.');
}

export async function loginLider(context, env, log) {
  const page = await context.newPage();
  const wait = humanControlWaiter(log);
  setHumanControlHandler(context, wait);
  await goto(page, 'https://www.liderbciserviciosfinancieros.cl/', 'lider.login');
  if (!await page.locator('input[type="password"]:visible').count()) {
    const link = page.getByRole('link', { name: /^\s*(Ingresa a tu cuenta|Ingresar|Sucursal virtual)\s*$/i });
    const href = await link.first().getAttribute('href');
    if (!href || new URL(href, page.url()).origin !== new URL(page.url()).origin) throw new BankError('UNTRUSTED_LOGIN', 'lider.login', 'Acceso público no identificado.');
    await link.first().click();
  }
  const password = page.locator('input[type="password"]:visible');
  await humanCondition(page, wait, async () => await password.count() === 1 && await password.isVisible());
  const form = password.locator('xpath=ancestor::form[1]');
  const action = await form.evaluate(f => f.action);
  if (new URL(action).origin !== 'https://www.liderbciserviciosfinancieros.cl') throw new BankError('UNTRUSTED_LOGIN', 'lider.login', 'Destino del formulario inesperado.');
  await form.locator('input[placeholder*="RUT" i], input[autocomplete="username"]').fill(env.BCI_LIDER_RUT);
  await password.fill(env.BCI_LIDER_CLAVE);
  await password.press('Tab');
  return resumePreparedLider(page, env, log, wait);
}

export async function runLider({ from, to, env = process.env, log = line => process.stderr.write(line + '\n'), launch, authenticate = loginLider, extract }) {
  const requested = period(from, to);
  const keys = ['BCI_LIDER_RUT', 'BCI_LIDER_CLAVE'];
  if (keys.some(key => !env[key]?.trim())) throw new BankError('MISSING_CREDENTIALS', 'configuration', 'Se requieren BCI_LIDER_RUT y BCI_LIDER_CLAVE.');
  if (!env.DISPLAY) throw new BankError('MISSING_DISPLAY', 'configuration', 'Se requiere DISPLAY para el navegador visible.');
  delete process.env.DEBUG; delete process.env.PWDEBUG;
  const launchBrowser = launch ?? (await import('playwright')).chromium.launch.bind((await import('playwright')).chromium);
  const browserEnv = { ...env };
  for (const key of CREDENTIAL_KEYS) delete browserEnv[key];
  const browser = await launchBrowser({ headless: false, env: browserEnv });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 }, locale: 'es-CL', timezoneId: 'America/Santiago' });
  setHumanControlHandler(context, humanControlWaiter(log));
  try {
    const page = await authenticate(context, env, log);
    const directory = await mkdtemp(join(tmpdir(), 'lider-statements-'));
    const extractPage = extract ?? (await import('./lider-extract.mjs')).extractLider;
    const result = await extractPage(page, directory, requested, log);
    // Keep the visible browser open after emitting the result as well.
    return { ...result, output_directory: directory };
  } catch (error) {
    // Keep this exact session available for inspection; never retry credentials.
    log(JSON.stringify({ error: error instanceof BankError ? { code: error.code, stage: error.stage, message: error.message } : { code: 'LIDER_PAGE_FAILED' }, browser_preserved: true }));
    await new Promise(resolve => browser.once('disconnected', resolve));
    throw new BankError('LIDER_INCOMPLETE', 'lider', 'La sesión terminó sin una extracción completa.');
  }
}
