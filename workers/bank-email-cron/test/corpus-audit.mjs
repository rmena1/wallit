// Private corpus stays external to the checkout. No real bodies/values printed.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseRawMessage } from '../src/lib/imap.mjs';
import { parseBci } from '../src/parsers/bci.mjs';
import { parseTenpo } from '../src/parsers/tenpo.mjs';
import { parseMercadoPago } from '../src/parsers/mercadopago.mjs';
import { config } from '../src/config/index.mjs';
import { createEmailProcessor } from '../src/lib/process-email.mjs';
if (process.env.WALLIT_TEST_NETWORK_DISABLED !== '1') throw new Error('Isolation preload required');
const dir = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const files = (await readdir(join(dir, 'cases'))).filter(file => file.endsWith('.json')).sort();
const results = [], providers = {}, identities = new Set(), rfcIds = new Set();
const noLog = { log() {}, warn() {}, error() {} };
for (let index = 0; index < files.length; index++) {
  const c = JSON.parse(await readFile(join(dir, 'cases', files[index]), 'utf8'));
  const gt = c.ground_truth;
  const key = `${c.source.account}:${c.source.gmail_id}`;
  if (identities.has(key)) throw new Error('Duplicate account+Gmail identity'); identities.add(key);
  const path = c.raw_path.startsWith('/') ? c.raw_path : join(dir, c.raw_path);
  const bytes = await readFile(path);
  const email = await parseRawMessage({ uid: index + 1, raw: bytes }, 999);
  if (rfcIds.has(email.messageId)) throw new Error('Duplicate RFC Message-ID'); rfcIds.add(email.messageId);
  providers[gt.provider] = (providers[gt.provider] || 0) + 1;
  const checks = {}, failures = [];
  let parsed = null, parserError = null;
  try { parsed = { bci: parseBci, tenpo: parseTenpo, mercadopago: parseMercadoPago }[gt.provider](email); }
  catch { parserError = 'parser_error'; }
  checks.auth = email.authentication?.verified === true;
  if (gt.expected_parse_disposition === 'accept' && !gt.requires_route_review) {
    checks.parsed = Boolean(parsed && !parserError);
    if (parsed) {
      const wantedType = gt.expected_wallit_type ?? (gt.type === 'transfer' ? gt.movement_direction === 'incoming' ? 'income' : 'expense' : gt.type);
      for (const [field, expected, actual] of [
        ['provider', gt.provider, parsed.provider], ['currency', gt.currency, parsed.currency],
        ['amount_minor', gt.expected_wallit_amount_minor ?? (gt.amount_minor * (gt.currency_minor_digits === 0 ? 100 : 1)), parsed.currency === 'USD' ? parsed.amountUsd : parsed.amount],
        ['date', gt.date || gt.date_time?.slice(0, 10), parsed.date], ['time', (gt.time || gt.date_time?.slice(11, 16))?.slice(0,5), parsed.time ?? null], ['type', wantedType, parsed.type],
        ['card_last4', gt.transaction_subtype === 'credit_card_repayment' ? null : gt.card_last4, parsed.last4 ?? null],
      ]) if (expected !== undefined && expected !== null) checks[field] = expected === actual;
    }
  }
  if (parsed && gt.merchant) checks.merchant = String(gt.merchant).normalize('NFC').replace(/\s+/g, ' ').trim() === parsed.originalName.normalize('NFC').replace(/\s+/g, ' ').trim();
  let payload = null;
  const processor = createEmailProcessor({
    isTransaction: async () => gt.transaction_valid === true, chooseCategory: async () => null,
    importToWallit: async value => { payload = value; return { success: true, duplicate: false }; },
    logProcessing: async () => {}, logger: noLog,
  });
  const outcome = await processor(email);
  const invalid = gt.expected_import_disposition === 'do_not_import' || gt.transaction_valid === false;
  checks.import_safety = invalid || gt.requires_route_review ? payload === null : payload !== null;
  if (gt.requires_route_review) checks.route_review_blocked = outcome.advance === false;
  if (payload && !gt.requires_route_review) {
    const repayment = gt.transaction_subtype === 'credit_card_repayment';
    const target = gt.expected_target_provider;
    const expectedAccount = target === 'bci' ? gt.currency === 'USD' ? config.accounts.bciUsd : config.accounts.bciClp
      : target === 'tenpo' ? (repayment || gt.routing_class === 'credit_card') ? config.accounts.tenpoCredit : config.accounts.tenpoVista
      : target === 'mercadopago' ? config.accounts.mercadopago : null;
    if (expectedAccount) checks.account_routing = expectedAccount === (repayment ? payload.toAccountId : payload.accountId || payload.fromAccountId);
    if (repayment) checks.repayment_is_transfer = payload.kind === 'transfer';
  }
  for (const [name, pass] of Object.entries(checks)) if (!pass) failures.push(name);
  results.push({ case_id: c.case_id, provider: gt.provider, expected_parse_disposition: gt.expected_parse_disposition,
    requires_route_review: gt.requires_route_review, raw_sha256: createHash('sha256').update(bytes).digest('hex'),
    checks, failures, observed: { parsed: Boolean(parsed), outcome: outcome.reason || outcome.error || 'blocked',
      imported: Boolean(payload), kind: payload?.kind || null, own_card_payment: parsed?.ownCardPayment === true, source_product: parsed?.sourceProduct || null, has_explicit_source: parsed?.sourceAccount !== undefined, text_length: email.textBody.length, transfer_heading: /Ya\s+enviamos/i.test(email.textBody), beneficiary_labels: /Nombre\s+y\s+apellido/i.test(email.textBody), has_dollar: /\$/.test(email.textBody), has_pagaste: /Pagaste/i.test(email.textBody) } });
}
const summary = { count: results.length, genuine_messages: results.length, synthetic_messages: 0,
  unique_account_gmail_ids: identities.size, unique_rfc_message_ids: rfcIds.size,
  providers, passed: results.filter(r => !r.failures.length).length,
  failed: results.filter(r => r.failures.length).length, isolation: 'all socket/HTTP/IMAP/DB transports blocked; imports/classifiers/logs injected doubles' };
await writeFile(join(dir, 'audit-results.json'), JSON.stringify({ summary, results }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summary));
console.log(JSON.stringify(results.filter(r => r.failures.length).map(r => ({ case_id: r.case_id, provider: r.provider, failures: r.failures, observed: r.observed }))));
process.exitCode = summary.failed || summary.count !== 100 || manifest.count !== 100 ? 1 : 0;
