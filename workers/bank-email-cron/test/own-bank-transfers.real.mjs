// Run explicitly with --real-transfers /private/dataset. No synthetic email cases.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convert } from 'html-to-text';
import { parseOwnBankTransfer } from '../src/parsers/own-bank-transfer.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';
import { verifyGmailAuthentication } from '../src/lib/sender-auth.mjs';
import { resolveTransferAccount } from '../src/lib/account-resolver.mjs';
import { config } from '../src/config/index.mjs';
const root = process.env.WALLIT_REAL_TRANSFER_DATASET;
if (!root) throw new Error('Pass --real-transfers /absolute/private/dataset');
const emails = JSON.parse(await readFile(`${root}/own-bank-transfers/emails.json`, 'utf8'));
const authHeaders=JSON.parse(await readFile(`${root}/own-bank-transfers/auth-headers.json`, 'utf8'));
function materialize(email) {
  return { ...email, textBody: email.textBody || convert(email.htmlBody, { wordwrap: false,
    selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }] }) };
}
const cases = [
  ['1a0df6c8c7093749',131000,'2026-09-26','tenpo','0146','bci','8080',true,true],
  ['1a05f243a632e0bc',2485060,'2026-09-01','bci','8080','tenpo','0146',true,true],
  ['1a05f2449a45eed5',2485060,'2026-09-01','bci','8080','tenpo','0146',true,true],
  ['1a0f40f8a8a67049',2706418,'2026-09-30','bci','8080','mercadopago','6991',true,true],
  ['1a05fadc8443d71d',1200000,'2026-09-01','tenpo','0146','mercadopago','6991',true,true],
  ['1a05fe581d134483',1379688,'2026-09-01','mercadopago','6991','tenpo','0146',true,true],
  ['19fd8be25c2bbde3',2500000,'2026-08-06','mercadopago','6991','bci','8080',true,true],
  ['19fd8ceb08f8780a',1194905,'2026-08-06','mercadopago','6991','tenpo','0146',true,true],
  ['19ff2159e4e2ac27',500000,'2026-08-11','mercadopago','6991','bci','8080',true,true],
  ['19cfc0ee0b36f6d2',50000,'2026-03-17','mach',null,'bci','8080',false,true],
  ['1a07e056c0027006',500000,'2026-09-07','tenpo','0146','bci','8080',true,true],
];
const logger = { log(){}, error(){} };
for (const [id,pesos,date,fromBank,fromNumber,toBank,toNumber,fromMapped,toMapped] of cases) {
  test(`real own transfer ${id}`, async () => {
    const email = materialize(emails.find(e=>e.gmailId===id));
    let payload;
    const processor = createEmailProcessor({ isTransaction: async()=>{throw new Error('Own transfer must not depend on model');},
      chooseCategory: async()=>{throw new Error('No category for bank transfers');},
      importToWallit: async p=>{payload=p; return {success:true};}, logProcessing:async()=>{}, logger });
    const outcome=await processor({...email,uid:1,authentication:verifyGmailAuthentication(authHeaders[email.gmailId],email.from)});
    assert.equal(outcome.success,true);
    assert.equal(payload.kind,'own-bank-transfer');
    assert.equal(payload.amount,pesos*100);
    assert.equal(payload.date,date);
    assert.equal(payload.from.number?.slice(-4) ?? null,fromNumber);
    assert.equal(payload.to.number?.slice(-4) ?? null,toNumber);
    assert.equal(Boolean(payload.from.accountId),fromMapped);
    assert.equal(Boolean(payload.to.accountId),toMapped);
    if (fromMapped) assert.equal(payload.from.accountId,({bci:config.accounts.bciChecking,tenpo:config.accounts.tenpoVista,mercadopago:config.accounts.mercadopago})[fromBank]);
    if (toMapped) assert.equal(payload.to.accountId,({bci:config.accounts.bciChecking,tenpo:config.accounts.tenpoVista,mercadopago:config.accounts.mercadopago})[toBank]);
    assert.equal('type' in payload,false);
    if (id==='1a0f40f8a8a67049') {
      assert.equal(payload.to.number,'1058236991');
      assert.equal(resolveTransferAccount('Mercado Pago','CLP','6991'),config.accounts.mercadopago);
      assert.equal(resolveTransferAccount('Mercado Pago','CLP','6969'),null);
    }
  });
}
test('real two-bank notices have the same operation facts',()=>{
  const bci=parseOwnBankTransfer(materialize(emails.find(e=>e.gmailId==='1a05f243a632e0bc')));
  const tenpo=parseOwnBankTransfer(materialize(emails.find(e=>e.gmailId==='1a05f2449a45eed5')));
  assert.equal(bci.ownBankTransfer.operationTime,'18:43:21');
  assert.equal(tenpo.ownBankTransfer.operationTime,'18:43:21');
  assert.equal(bci.amount,tenpo.amount);
  assert.equal(bci.date,tenpo.date);
  assert.equal(bci.ownBankTransfer.from.accountId,tenpo.ownBankTransfer.from.accountId);
  assert.equal(bci.ownBankTransfer.to.accountId,tenpo.ownBankTransfer.to.accountId);
});
test('real credit-card payment remains outside own bank transfer classification',async()=>{
  const email=materialize(emails.find(e=>e.gmailId==='1a0df70ee0f62dbc'));
  assert.equal(parseOwnBankTransfer(email),null);
  let payload;
  const processor=createEmailProcessor({isTransaction:async()=>true,chooseCategory:async()=>null,
    importToWallit:async p=>{payload=p;return {success:true};},logProcessing:async()=>{},logger});
  assert.equal((await processor({...email,uid:1,authentication:{verified:true}})).success,true);
  assert.equal(payload.kind,'transfer'); // existing repayment behavior, deliberately unchanged
  assert.equal(payload.fromAccountId,config.accounts.bciChecking);
  assert.equal(payload.toAccountId,config.accounts.bciClp);
});
test('real salary remains income',async()=>{
  const [email]=JSON.parse(await readFile(`${root}/own-bank-transfers/negatives.json`,'utf8'));
  assert.match(email.textBody,/Sueldo agosto/);
  assert.equal(parseOwnBankTransfer(email),null);
  let payload;
  const processor=createEmailProcessor({isTransaction:async()=>true,chooseCategory:async()=>null,
    importToWallit:async p=>{payload=p;return {success:true};},logProcessing:async()=>{},logger});
  assert.equal((await processor({...email,uid:1,authentication:{verified:true}})).success,true);
  assert.equal(payload.kind,'movement');
  assert.equal(payload.type,'income');
});
test('existing real gold corpus purchases and third-party payments do not enter own-bank path',async()=>{
  const {readdir}=await import('node:fs/promises');
  const {parseBci}=await import('../src/parsers/bci.mjs');
  const {parseTenpo}=await import('../src/parsers/tenpo.mjs');
  const {parseMercadoPago}=await import('../src/parsers/mercadopago.mjs');
  let purchases=0,thirdParty=0;
  for(const filename of await readdir(`${root}/emails`)) {
    const email=JSON.parse(await readFile(`${root}/emails/${filename}`,'utf8'));
    if(email._stub) continue;
    const parsed=parseBci(email) || parseTenpo(email) || parseMercadoPago(email);
    if(!parsed || parsed.ownCardPayment) continue;
    if(parsed.beneficiary && /raimundo\s+mena/i.test(parsed.beneficiary)) continue;
    assert.equal(parseOwnBankTransfer(email),null,filename);
    if(parsed.beneficiary) thirdParty++; else purchases++;
  }
  assert.ok(purchases>0);
  assert.ok(thirdParty>0);
});
