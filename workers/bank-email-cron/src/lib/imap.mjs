import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { config } from '../config/index.mjs';
import { PROVIDER_FROM_ALLOWLIST } from './account-resolver.mjs';

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
  } = {}) {
    this.createImap = createImap;
    this.sleep = sleep;
    this.random = random;
    this.logger = logger;
    this.imap = null;
  }

  async connect() {
    const { connectMaxRetries: maxRetries, connectBaseDelayMs: baseDelayMs } = config.gmail;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.logger.log(`[IMAP] Connect attempt ${attempt + 1}/${maxRetries + 1}`);
      const imap = this.createImap({
        user: config.gmail.user,
        password: config.gmail.password,
        host: config.gmail.host,
        port: config.gmail.port,
        tls: config.gmail.tls,
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
        imap.destroy();
        const failure = connectFailure(error);
        // Use fixed diagnostic text: server error messages can contain credentials.
        if (!failure.transient || attempt === maxRetries) {
          const message = `[IMAP] Connect failed after ${attempt + 1} attempt(s): ${failure.message}`;
          this.logger.warn(message);
          throw new Error(message);
        }
        const delayMs = Math.min(30_000, Math.round(baseDelayMs * 2 ** attempt * (1 + this.random())));
        this.logger.warn(`[IMAP] Connect attempt ${attempt + 1} failed: ${failure.message}; retrying in ${delayMs}ms`);
        await this.sleep(delayMs);
      }
    }
  }

  disconnect() {
    this.imap?.end();
  }

  async openFolder(folder) {
    return new Promise((resolve, reject) => {
      this.imap.openBox(folder, true, (err, box) => {
        if (err) reject(err);
        else resolve(box);
      });
    });
  }

  async searchBySenderSince(senders, sinceDate) {
    return new Promise((resolve, reject) => {
      let fromCriteria;
      if (senders.length === 1) {
        fromCriteria = ['FROM', senders[0]];
      } else if (senders.length === 2) {
        fromCriteria = ['OR', ['FROM', senders[0]], ['FROM', senders[1]]];
      } else {
        fromCriteria = ['OR', ['FROM', senders[0]], ['OR', ['FROM', senders[1]], ['FROM', senders[2]]]];
      }
      
      const criteria = [fromCriteria];
      
      if (sinceDate) {
        criteria.push(['SINCE', sinceDate]);
      }

      this.imap.search(criteria, (err, uids) => {
        if (err) reject(err);
        else resolve(uids || []);
      });
    });
  }

  async fetchMessagesByUid(uids) {
    if (uids.length === 0) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const messages = [];
      const fetch = this.imap.fetch(uids, {
        bodies: '',
        struct: true,
      });

      fetch.on('message', (msg, seqno) => {
        const messageData = { seqno };

        msg.on('body', (stream) => {
          let buffer = '';
          stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
          });
          stream.once('end', () => {
            messageData.raw = buffer;
          });
        });

        msg.once('attributes', (attrs) => {
          messageData.uid = attrs.uid;
          messageData.attrs = attrs;
        });

        msg.once('end', () => {
          messages.push(messageData);
        });
      });

      fetch.once('error', reject);
      fetch.once('end', () => resolve(messages));
    });
  }

  async fetchMessagesSince(lastUid, initialUid, lookbackDays) {
    const allowedSenders = Object.keys(PROVIDER_FROM_ALLOWLIST);

    console.log(`[IMAP] Searching for messages from allowed senders: ${allowedSenders.join(', ')} (lastUid: ${lastUid})`);

    let sinceDate = null;
    if (lastUid === 0 && lookbackDays > 0) {
      const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
      sinceDate = new Date(Date.now() - lookbackMs);
      console.log(`[IMAP] First run: applying ${lookbackDays}-day lookback (since ${sinceDate.toISOString()})`);
    }

    const matchedUids = await this.searchBySenderSince(allowedSenders, sinceDate);
    console.log(`[IMAP] SEARCH returned ${matchedUids.length} UIDs from allowed senders`);

    const effectiveMinUid = lastUid === 0 ? initialUid : lastUid + 1;
    const uidsToFetch = matchedUids.filter(uid => uid >= effectiveMinUid);
    
    console.log(`[IMAP] Filtered to ${uidsToFetch.length} UIDs >= ${effectiveMinUid}`);

    if (uidsToFetch.length === 0) {
      return [];
    }

    console.log(`[IMAP] Fetching ${uidsToFetch.length} messages by UID`);
    return await this.fetchMessagesByUid(uidsToFetch);
  }

  async parseMessages(rawMessages) {
    const parsed = [];
    for (const raw of rawMessages) {
      try {
        const mail = await simpleParser(raw.raw);
        parsed.push({
          uid: raw.uid,
          messageId: mail.messageId?.replace(/^<|>$/g, '') || null,
          from: mail.from?.text || mail.from?.value?.[0]?.address || '',
          subject: mail.subject || '',
          date: mail.date || new Date(),
          textBody: mail.text || '',
          _raw: raw,
        });
      } catch (error) {
        console.error(`Failed to parse message UID ${raw.uid}:`, error.message);
      }
    }
    return parsed;
  }
}

export async function fetchNewEmails(lastUid) {
  const client = new ImapClient();
  
  try {
    console.log(`[IMAP] Connecting to ${config.gmail.host}:${config.gmail.port} (TLS: ${config.gmail.tls})`);
    await client.connect();
    console.log('[IMAP] Connected successfully');
    
    console.log(`[IMAP] Opening folder: ${config.gmail.folder}`);
    const box = await client.openFolder(config.gmail.folder);
    console.log(`[IMAP] Folder opened: ${box.messages.total} total messages, UIDVALIDITY ${box.uidvalidity}`);
    
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
    const messages = await client.parseMessages(rawMessages);
    const filtered = messages.filter(m => m.uid > lastUid);
    
    console.log(`[IMAP] Returning ${filtered.length} messages after filtering UID > ${lastUid}`);
    
    return {
      uidvalidity: box.uidvalidity,
      messages: filtered,
    };
  } finally {
    console.log('[IMAP] Disconnecting');
    client.disconnect();
  }
}
