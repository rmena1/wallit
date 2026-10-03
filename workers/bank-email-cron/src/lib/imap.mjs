import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { requireBudget, boundedTimeout } from './run-budget.mjs';
import { config } from '../config/index.mjs';
import { PROVIDER_FROM_ALLOWLIST, verifyGmailAuthentication } from './sender-auth.mjs';

const TRANSIENT_CONNECT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN']);

function connectFailure(error) {
  const message = error.message || '';
  // Authentication timeouts are transient; explicit credential rejection is not.
  if (/invalid credentials|authentication failed|authenticationfailed|login failed|app(?:lication)?[- ]specific password/i.test(message)) {
    return { transient: false, message: 'authentication rejected' };
  }
  if (TRANSIENT_CONNECT_CODES.has(error.code)) {
    return { transient: true, message: error.code };
  }
  if (/timeout|timed out|socket hang up|connection ended unexpectedly/i.test(message)) {
    return { transient: true, message: 'connection/authentication timeout or interrupted connection' };
  }
  return { transient: false, message: 'non-transient connection failure' };
}

export class ImapClient {
  constructor({
    createImap = options => new Imap(options),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    random = Math.random,
    logger = console,
    runtime = {},
  } = {}) {
    this.runtime = runtime;
    this.createImap = createImap;
    this.sleep = sleep;
    this.random = random;
    this.logger = logger;
    this.imap = null;
  }

  async connect() {
    const { connectMaxRetries: maxRetries, connectBaseDelayMs: baseDelayMs } = config.gmail;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      requireBudget(this.runtime);
      this.logger.log(`[IMAP] Connect attempt ${attempt + 1}/${maxRetries + 1}`);
      const imap = this.createImap({
        user: config.gmail.user,
        password: config.gmail.password,
        host: config.gmail.host,
        port: config.gmail.port,
        tls: config.gmail.tls,
        connTimeout: boundedTimeout(config.gmail.operationTimeoutMs, this.runtime),
        authTimeout: boundedTimeout(config.gmail.operationTimeoutMs, this.runtime),
        socketTimeout: boundedTimeout(config.gmail.operationTimeoutMs, this.runtime),
        tlsOptions: { rejectUnauthorized: config.gmail.tlsRejectUnauthorized },
      });
      this.imap = imap;
      try {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            imap.removeListener('ready', onReady);
            imap.removeListener('end', onEnd);
            imap.removeListener('close', onEnd);
          };
          const onReady = () => { cleanup(); resolve(); };
          const onError = error => { cleanup(); reject(error); };
          const onEnd = () => onError(new Error('Connection ended unexpectedly'));
          imap.once('ready', onReady);
          // Keep an error listener for late socket errors during teardown.
          imap.on('error', onError);
          imap.once('end', onEnd);
          imap.once('close', onEnd);
          try { imap.connect(); } catch (error) { onError(error); }
        });
        return;
      } catch (error) {
        this.imap = null;
        this.abortTransport(imap);
        requireBudget(this.runtime);
        const failure = connectFailure(error);
        // Use fixed diagnostic text: server error messages can contain credentials.
        if (!failure.transient || attempt === maxRetries) {
          const message = `[IMAP] Connect failed after ${attempt + 1} attempt(s): ${failure.message}`;
          this.logger.warn(message);
          throw new Error(message);
        }
        const delayMs = Math.min(30_000, Math.round(baseDelayMs * 2 ** attempt * (1 + this.random())));
        this.logger.warn(`[IMAP] Connect attempt ${attempt + 1} failed: ${failure.message}; retrying in ${delayMs}ms`);
        await this.sleep(Math.min(delayMs, requireBudget(this.runtime)));
      }
    }
  }

  abortTransport(imap = this.imap) {
    // node-imap 0.8.19 destroy() only calls socket.end(). A stalled FETCH or
    // trickling peer must not leave this process alive after rejecting work.
    try { imap?.destroy?.(); } finally { imap?._sock?.destroy(); }
  }

  disconnect() {
    const imap = this.imap;
    this.imap = null;
    if (!imap) return;
    const timer = setTimeout(() => this.abortTransport(imap), 1000);
    timer.unref();
    const closed = () => { clearTimeout(timer); imap.removeListener('end', closed); imap.removeListener('close', closed); };
    imap.once('end', closed); imap.once('close', closed);
    try { imap.end(); } catch { this.abortTransport(imap); }
  }

  operation(label, start) {
    requireBudget(this.runtime);
    return new Promise((resolve, reject) => {
      const imap = this.imap;
      if (!imap) return reject(new Error(`imap_${label}_disconnected`));
      const cleanup = () => {
        clearTimeout(timer);
        for (const event of ['error', 'close', 'end']) imap.removeListener(event, failed);
      };
      const failed = () => { cleanup(); this.abortTransport(imap); reject(new Error(`imap_${label}_failed`)); };
      const done = (error, value) => { if (error) return failed(); cleanup(); resolve(value); };
      const timer = setTimeout(failed, boundedTimeout(config.gmail.operationTimeoutMs, this.runtime));
      for (const event of ['error', 'close', 'end']) imap.once(event, failed);
      try { start(done); } catch { failed(); }
    });
  }

  async openFolder(folder) {
    return this.operation('open', done => this.imap.openBox(folder, true, done));
  }

  async searchBySenderSince(senders, sinceDate, minUid = 1) {
    const fromCriteria = senders.reduceRight((tail, sender) => tail
      ? ['OR', ['FROM', sender], tail] : ['FROM', sender], null);
    const criteria = [fromCriteria, ['UID', `${minUid}:*`]];
    if (sinceDate) criteria.push(['SINCE', sinceDate]);
    return this.operation('search', done => this.imap.search(criteria, (err, uids) => done(err, uids || [])));
  }

  async fetchMessagesByUid(uids) {
    if (!uids.length) return [];
    return this.operation('fetch', done => {
      const messages = [];
      const fetch = this.imap.fetch(uids, { bodies: '', struct: false, markSeen: false });
      let failed = false;
      const fail = () => { failed = true; done(new Error('incomplete_fetch')); };
      fetch.once('error', fail);
      fetch.on('message', (msg, seqno) => {
        const data = { seqno };
        msg.on('body', stream => {
          const chunks = []; let size = 0;
          stream.on('data', chunk => {
            size += chunk.length;
            if (size > config.gmail.maxMessageBytes) data.decodeError = 'message_too_large';
            else chunks.push(Buffer.from(chunk));
          });
          stream.once('error', fail);
          stream.once('end', () => { data.raw = data.decodeError ? null : Buffer.concat(chunks); });
        });
        msg.once('attributes', attrs => { data.uid = attrs.uid; });
        msg.once('error', fail);
        msg.once('end', () => { messages.push(data); });
      });
      fetch.once('end', () => {
        if (failed) return;
        // Missing/partial messages cannot be silently bypassed by later UIDs.
        if (messages.length !== uids.length || new Set(messages.map(m => m.uid)).size !== uids.length || messages.some(m => !uids.includes(m.uid))) return fail();
        done(null, messages);
      });
    });
  }

  async fetchMessagesSince(lastUid, initialUid, lookbackDays) {
    const minUid = lastUid === 0 ? Math.max(1, initialUid) : lastUid + 1;
    const sinceDate = lastUid === 0 && lookbackDays > 0
      ? new Date(Date.now() - lookbackDays * 86400_000) : null;
    const matched = await this.searchBySenderSince(Object.keys(PROVIDER_FROM_ALLOWLIST), sinceDate, minUid);
    const uids = [...new Set(matched)].filter(uid => Number.isSafeInteger(uid) && uid >= minUid)
      .sort((a, b) => a - b).slice(0, config.gmail.batchSize);
    this.logger.log(`[IMAP] Fetching bounded batch of ${uids.length} new UIDs`);
    return this.fetchMessagesByUid(uids);
  }

  async parseMessages(rawMessages, uidvalidity) {
    const parsed = [];
    for (const raw of rawMessages) { requireBudget(this.runtime); parsed.push(await parseRawMessage(raw, uidvalidity)); }
    return parsed;
  }

}

export async function fetchNewEmails(lastUid, expectedUidvalidity = null, runtime = {}) {
  const client = new ImapClient({ runtime });
  
  try {
    console.log(`[IMAP] Connecting to ${config.gmail.host}:${config.gmail.port} (TLS: ${config.gmail.tls})`);
    await client.connect();
    console.log('[IMAP] Connected successfully');
    
    console.log(`[IMAP] Opening folder: ${config.gmail.folder}`);
    const box = await client.openFolder(config.gmail.folder);
    console.log(`[IMAP] Folder opened: ${box.messages.total} total messages, UIDVALIDITY ${box.uidvalidity}`);
    
    if (expectedUidvalidity !== null && Number(box.uidvalidity) !== expectedUidvalidity) {
      return { uidvalidity: Number(box.uidvalidity), messages: [] };
    }
    if (!box || box.messages.total === 0) {
      console.log('[IMAP] No messages in folder');
      return { uidvalidity: box?.uidvalidity || null, messages: [] };
    }

    const rawMessages = await client.fetchMessagesSince(
      lastUid,
      config.gmail.initialUid,
      config.gmail.lookbackDays
    );
    
    console.log(`[IMAP] Parsing ${rawMessages.length} fetched messages`);
    const messages = await client.parseMessages(rawMessages, Number(box.uidvalidity));
    const filtered = messages.filter(m => m.uid > lastUid);
    
    console.log(`[IMAP] Returning ${filtered.length} messages after filtering UID > ${lastUid}`);
    
    return {
      uidvalidity: Number(box.uidvalidity),
      messages: filtered,
    };
  } finally {
    console.log('[IMAP] Disconnecting');
    client.disconnect();
  }
}

export async function parseRawMessage(raw, uidvalidity) {
  const base = { uid: raw.uid, uidvalidity };
  if (!raw.raw && !raw.decodeError) return { ...base, decodeError: 'mime_parse_failed' };
  if (raw.decodeError) return { ...base, decodeError: raw.decodeError };
  try {
    const mail = await simpleParser(raw.raw, { skipImageLinks: true, skipTextToHtml: true });
    const senders = mail.from?.value || [];
    const from = senders.length === 1 ? senders[0].address || '' : '';
    const messageIds = (mail.headerLines || []).filter(h => h.key === 'message-id');
    const dates = (mail.headerLines || []).filter(h => h.key === 'date');
    const sourceDate = dates.length === 1 ? dates[0].line.replace(/^Date:\s*/i, '').replace(/\r?\n[ \t]+/g, ' ') : null;
    if (messageIds.length > 1) return { ...base, decodeError: 'mime_parse_failed' };
    return { ...base, messageId: mail.messageId?.replace(/^<|>$/g, '') || null,
      from, subject: mail.subject || '', date: sourceDate,
      textBody: mail.text?.trim() ? mail.text : typeof mail.html === 'string' ? convert(mail.html, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }] }) : '', authentication: verifyGmailAuthentication(mail.headerLines, from) };
  } catch { return { ...base, decodeError: 'mime_parse_failed' }; }
}
