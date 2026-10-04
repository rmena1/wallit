/** Attach to an explicitly supplied desktop session. Never opens or reloads a page. */
import { fileURLToPath } from 'node:url';
import { BankError, period } from './live.mjs';
import { humanControlWaiter, resumePreparedLider, submissionAlreadyMade } from './lider-session.mjs';
import { extractLider } from './lider-extract.mjs';

export async function resumeExisting({ cdp, from, to, directory, env = process.env, log = console.error }) {
  const requested = period(from,to);
  const endpoint = new URL(cdp);
  if (!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)) throw new BankError('INVALID_CDP','configuration','Se requiere CDP local.');
  if (!directory) throw new BankError('MISSING_DIRECTORY','configuration','Se requiere directorio de salida.');
  delete process.env.DEBUG; delete process.env.PWDEBUG;
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(cdp);
  const pages = browser.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith('https://www.liderbciserviciosfinancieros.cl/'));
  if (pages.length !== 1) throw new BankError('AMBIGUOUS_PAGE','lider.session','No se identificó una única página abierta de Líder.');
  const page = pages[0];
  const wait = humanControlWaiter(log);
  await wait(page);
  if (new URL(page.url()).pathname === '/login') {
    if (!env.BCI_LIDER_RUT?.trim() || !env.BCI_LIDER_CLAVE?.trim()) throw new BankError('MISSING_CREDENTIALS','configuration','Faltan variables de Líder.');
    const password = page.locator('input[type="password"]:visible');
    const form = password.locator('xpath=ancestor::form[1]');
    if (new URL(await form.evaluate(f => f.action)).origin !== new URL(page.url()).origin) throw new BankError('UNTRUSTED_LOGIN','lider.login','Destino de formulario inesperado.');
    if (await submissionAlreadyMade(page)) throw new BankError('LOGIN_ALREADY_SUBMITTED','lider.login','No se repite el ingreso.');
    await page.getByPlaceholder('Rut',{exact:true}).fill(env.BCI_LIDER_RUT);
    await password.fill(env.BCI_LIDER_CLAVE);
    await password.press('Tab');
    await wait(page);
    await resumePreparedLider(page,env,log,wait);
  }
  return extractLider(page,directory,requested,log);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const flags=['--cdp','--from','--to','--output-dir'];
  try {
    if (args.length!==8 || args.some((v,i)=>i%2===0&&!flags.includes(v)) || new Set(args.filter((_,i)=>i%2===0)).size!==4) throw Error('INVALID_ARGUMENTS');
    const options=Object.fromEntries(flags.map(k=>[k,args[args.indexOf(k)+1]]));
    const result=await resumeExisting({cdp:options['--cdp'],from:options['--from'],to:options['--to'],directory:options['--output-dir']});
    await new Promise(resolve=>process.stdout.write(JSON.stringify(result,null,2)+'\n',resolve));
    // Sever this automation connection; no Browser.close or context/page close.
    process.exit(0);
  } catch(error) {
    process.stderr.write(JSON.stringify({error:{code:error.code??'LIDER_EXISTING_FAILED'},browser_preserved:true})+'\n');
    process.exit(1);
  }
}
