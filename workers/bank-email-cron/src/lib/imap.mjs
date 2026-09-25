import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { config } from '../config/index.mjs';

export class ImapClient {
  constructor() {
    this.imap = new Imap({
      user: config.gmail.user,
      password: config.gmail.password,
      host: config.gmail.host,
      port: config.gmail.port,
      tls: config.gmail.tls,
      tlsOptions: { rejectUnauthorized: true },
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', resolve);
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  disconnect() {
    this.imap.end();
  }

  async openFolder(folder) {
    return new Promise((resolve, reject) => {
      this.imap.openBox(folder, true, (err, box) => {
        if (err) reject(err);
        else resolve(box);
      });
    });
  }

  async fetchMessagesSince(uid) {
    const fetchQuery = uid > 0 ? `${uid + 1}:*` : '1:*';
    
    return new Promise((resolve, reject) => {
      const messages = [];
      const fetch = this.imap.seq.fetch(fetchQuery, {
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
    await client.connect();
    const box = await client.openFolder(config.gmail.folder);
    
    if (!box || box.messages.total === 0) {
      console.log('No messages in folder');
      return { uidvalidity: box?.uidvalidity || null, messages: [] };
    }

    const rawMessages = await client.fetchMessagesSince(lastUid);
    const messages = await client.parseMessages(rawMessages);
    
    return {
      uidvalidity: box.uidvalidity,
      messages: messages.filter(m => m.uid > lastUid),
    };
  } finally {
    client.disconnect();
  }
}
