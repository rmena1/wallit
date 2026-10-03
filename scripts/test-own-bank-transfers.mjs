// Integration test using only the real private corpus and a disposable local DB.
// Usage: node scripts/test-own-bank-transfers.mjs /private/dataset postgresql://127.0.0.1:55439/wallit_own_transfers_test
import assert from 'node:assert/strict';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import postgres from 'postgres';
import { convert } from '../workers/bank-email-cron/node_modules/html-to-text/lib/html-to-text.mjs';
const [root, databaseUrl] = process.argv.slice(2);
if (!root || !databaseUrl) throw new Error('Private dataset path and disposable database URL required');
const url = new URL(databaseUrl);
if (!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Use a local disposable database ending in _test');
Object.assign(process.env, {DATABASE_URL:databaseUrl, GMAIL_USER:'test@example.com',GMAIL_APP_PASSWORD:'test',
  WALLIT_BASE_URL:'https://test.invalid',WALLIT_IMPORT_TOKEN:'test',WALLIT_USER_ID:'test',
  USD_CLP_EXCHANGE_RATE_X100:'94650',TYPESAFE_API_KEY:'test',OPENAI_API_KEY:'test',ACCOUNT_BCI_CHECKING_ID:'test-bci-checking',
  ACCOUNT_TENPO_VISTA_ID:'test-tenpo-vista',ACCOUNT_BCI_CLP_ID:'test-bci-clp',ACCOUNT_BCI_USD_ID:'test-bci-usd',ACCOUNT_TENPO_CREDIT_ID:'test-tenpo-credit',ACCOUNT_MERCADOPAGO_ID:'test-mp'});
const outdir=resolve('node_modules/.cache/own-bank-transfer-tests');
await mkdir(outdir,{recursive:true});
await build({entryPoints:['src/lib/domain/email-import-service.ts'],outfile:`${outdir}/service.mjs`,bundle:true,platform:'node',format:'esm',packages:'external'});
const {importEmailTransaction}=await import(pathToFileURL(`${outdir}/service.mjs`));
const {parseOwnBankTransfer}=await import('../workers/bank-email-cron/src/parsers/own-bank-transfer.mjs');
const {buildImportPayload}=await import('../workers/bank-email-cron/src/lib/import-client.mjs');
const emails=JSON.parse(await readFile(`${root}/own-bank-transfers/emails.json`,'utf8'));
const ids=['1a0df6c8c7093749','1a05f243a632e0bc','1a05f2449a45eed5','1a0f40f8a8a67049','1a05fadc8443d71d',
  '1a05fe581d134483','19fd8be25c2bbde3','19fd8ceb08f8780a','19ff2159e4e2ac27','19cfc0ee0b36f6d2','1a07e056c0027006'];
const sql=postgres(databaseUrl,{max:2});
const userIds=[];
try {
  for(const order of ['legacy-after-outgoing','legacy-before-outgoing','legacy-before-incoming','legacy-transfer','forward','reverse','concurrent']) {
    const userId=`own-transfer-test-${randomUUID()}`;
    userIds.push(userId);
    const personal=`${userId}-personal`, casa=`${userId}-casa`;
    const bci=`${userId}-bci`,tenpo=`${userId}-tenpo`,mp=`${userId}-mp`;
    const now=new Date();
    await sql`insert into users (id,email,password_hash,created_at,updated_at) values (${userId},${userId+'@example.test'},'test',${now},${now})`;
    for(const [id,name] of [[personal,'Personal'],[casa,'Casa']]) {
      await sql`insert into spaces (id,name,normalized_name,emoji,created_by_user_id,created_at,updated_at) values (${id},${name},${name.toLowerCase()},'🏦',${userId},${now},${now})`;
      await sql`insert into space_memberships (id,space_id,user_id,role,created_at) values (${randomUUID()},${id},${userId},'owner',${now})`;
    }
    for(const [id,space,bank,last4] of [[bci,personal,'BCI','8080'],[tenpo,casa,'Tenpo','0146'],[mp,personal,'Mercado Pago','6991']]) {
      await sql`insert into accounts (id,space_id,created_by_user_id,bank_name,account_type,last_four_digits,created_at,updated_at) values (${id},${space},${userId},${bank},'Vista',${last4},${now},${now})`;
    }
    const payloads=ids.map(id=>{
      const email=emails.find(e=>e.gmailId===id);
      assert.ok(email,`Missing real message ${id}`);
      const textBody=email.textBody || convert(email.htmlBody,{wordwrap:false,selectors:[{selector:'a',options:{ignoreHref:true}},{selector:'img',format:'skip'}]});
      const parsed=parseOwnBankTransfer({...email,textBody});
      assert.ok(parsed,`No own transfer ${id}`);
      const payload=buildImportPayload(parsed,null,email.messageId);
      payload.userId=userId;
      for(const end of [payload.from,payload.to]) {
        if(end.accountId) end.accountId=({'test-bci-checking':bci,'test-tenpo-vista':tenpo,'test-mp':mp})[end.accountId];
      }
      return payload;
    });
    if(order==='legacy-transfer') {
      // Case 1 may already be a proper transfer under the previous importer.
      const payload=payloads[0];
      const existing=await importEmailTransaction({ ...payload, kind:'transfer',
        fromAccountId:payload.from.accountId, toAccountId:payload.to.accountId });
      assert.equal(existing.success,true);
      const linked=await importEmailTransaction(payload);
      assert.equal(linked.success,true);
      assert.equal(linked.transferId,existing.transferId);
      assert.equal((await importEmailTransaction(payload)).duplicate,true);
      assert.equal((await sql`select id from transfers where created_by_user_id=${userId}`).length,1);
      assert.equal((await sql`select id from movements where created_by_user_id=${userId}`).length,2);
      console.log('legacy-transfer: real case 1 reuses the existing transfer and both ledger sides');
      continue;
    }
    if(order.startsWith('legacy-')) {
      // Reuse case 2 unchanged. Only the prior database/import order varies.
      const outgoing=payloads.find(p=>p.sourceEmailProvider==='bci' && p.amount===248506000);
      const incoming=payloads.find(p=>p.sourceEmailProvider==='tenpo' && p.amount===248506000);
      const snapshot=async()=>({
        movements:await sql`select * from movements where created_by_user_id=${userId} order by id`,
        transfers:await sql`select * from transfers where created_by_user_id=${userId} order by id`,
        imports:await sql`select * from own_bank_transfer_imports where created_by_user_id=${userId} order by id`,
        receipts:await sql`select * from own_bank_transfer_receipts where created_by_user_id=${userId} order by id`,
      });
      if(order==='legacy-after-outgoing') assert.equal((await importEmailTransaction(outgoing)).success,true);
      const legacy=await importEmailTransaction({ ...incoming, kind:'movement', accountId:tenpo,
        name:incoming.originalName, type:'income' });
      assert.equal(legacy.success,true);
      const before=await snapshot();
      const attempt=order==='legacy-before-outgoing'?outgoing:incoming;
      for(let retry=0;retry<2;retry++) {
        const result=await importEmailTransaction(attempt);
        assert.equal(result.success,false,`${order}: existing income must require reconciliation`);
        assert.deepEqual(await snapshot(),before,'Rejected import must not change any ledger/evidence rows');
      }
      console.log(`${order}: existing real Tenpo income requires reconciliation; retries leave ledger and receipts unchanged`);
      continue;
    }
    if(order==='reverse') payloads.reverse();
    let results=[];
    if(order==='concurrent') results=await Promise.all(payloads.map(p=>importEmailTransaction(p)));
    else for(const p of payloads) results.push(await importEmailTransaction(p));
    for(const r of results) assert.equal(r.success,true,JSON.stringify(r));
    assert.equal(results.filter(r=>r.duplicate).length,1);
    for(const p of payloads) {
      const r=await importEmailTransaction(p);
      assert.equal(r.success,true);assert.equal(r.duplicate,true);
    }
    const records=await sql`select * from own_bank_transfer_imports where created_by_user_id=${userId}`;
    assert.equal(records.length,10);
    assert.equal(records.filter(r=>r.status==='linked').length,9);
    assert.equal(records.filter(r=>r.status==='pending_accounts').length,1);
    assert.equal(records.filter(r=>r.amount==='248506000').length,1);
    const receipts=await sql`select * from own_bank_transfer_receipts where created_by_user_id=${userId}`;
    assert.equal(receipts.length,11);
    const transfers=await sql`select * from transfers where created_by_user_id=${userId}`;
    assert.equal(transfers.length,9);
    const movements=await sql`select * from movements where created_by_user_id=${userId}`;
    assert.equal(movements.length,18);
    for(const movement of movements) assert.ok(transfers.some(t=>t.source_movement_id===movement.id || t.destination_movement_id===movement.id));
    for(const r of records.filter(r=>r.from_number?.endsWith('6991') || r.to_number?.endsWith('6991'))) {
      assert.equal(r.from_bank==='mercadopago'?r.from_account_id:r.to_account_id,mp);
    }
    // The real September 30 receipt now verifies the same-Space product case.
    const september30=records.find(r=>r.amount==='270641800' && r.date==='2026-09-30');
    assert.equal(september30.from_account_id,bci);
    assert.equal(september30.to_account_id,mp);
    const sameSpace=transfers.find(t=>t.id===september30.transfer_id);
    assert.equal(sameSpace.source_space_id,personal);
    assert.equal(sameSpace.destination_space_id,personal);
    for(const transfer of transfers) {
      const crossSpace=transfer.source_space_id!==transfer.destination_space_id;
      for(const id of [transfer.source_movement_id,transfer.destination_movement_id]) {
        const movement=movements.find(m=>m.id===id);
        assert.equal(movement.reportable,crossSpace);
        assert.equal(movement.needs_review,crossSpace);
      }
    }
    assert.equal(records.find(r=>r.status==='pending_accounts').from_bank,'mach');
    console.log(`${order}: 11 real notices, 10 bank transfers, 9 linked, 1 MACH pending; same/cross-Space flags and retries verified`);
  }
} finally {
  for(const id of userIds) {
    await sql`delete from movements where created_by_user_id=${id}`;
    await sql`delete from users where id=${id}`;
  }
  await sql.end();
  await rm(outdir,{recursive:true,force:true});
}
