import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ImapClient } from '../src/lib/imap.mjs';
import { config } from '../src/config/index.mjs';

function setup(outcome, random = 0.5) {
  const clients = [];
  const delays = [];
  const logs = [];
  const client = new ImapClient({
    createImap() {
      const socket = new EventEmitter();
      const index = clients.length;
      socket.connect = () => queueMicrotask(() => {
        const result = outcome(index);
        if (result === 'close' || result === 'end') socket.emit(result);
        else if (result) socket.emit('error', result);
        else socket.emit('ready');
      });
      socket.destroy = () => { socket.destroyed = true; socket.emit('error', new Error('late socket error')); };
      socket.end = () => { socket.ended = true; };
      clients.push(socket);
      return socket;
    },
    sleep: async ms => { delays.push(ms); },
    random: () => random,
    logger: { log: message => logs.push(message), warn: message => logs.push(message) },
  });
  return { client, clients, delays, logs };
}

test('transient auth timeouts retry with fresh clients and exponential jitter, then succeed', async () => {
  const { client, clients, delays, logs } = setup(i => i < 2 ? new Error('Timed out while authenticating with server') : null);
  await client.connect();
  assert.equal(clients.length, 3);
  assert.ok(clients[0].destroyed && clients[1].destroyed);
  assert.equal(client.imap, clients[2]);
  assert.deepEqual(delays, [750, 1500]);
  assert.equal(logs.filter(line => /Connect attempt \d\//.test(line)).length, 3);
  client.disconnect();
  assert.equal(clients[2].ended, true);
});

for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN']) {
  test(`persistent ${code} exhausts retries and rejects`, async () => {
    const { client, clients, delays } = setup(() => Object.assign(new Error('network failure'), { code }));
    await assert.rejects(client.connect(), /failed after 4 attempt/);
    assert.equal(clients.length, config.gmail.connectMaxRetries + 1);
    assert.equal(delays.length, config.gmail.connectMaxRetries);
    assert.ok(clients.every(socket => socket.destroyed));
    assert.equal(client.imap, null);
    client.disconnect();
  });
}

for (const error of [new Error('Invalid credentials'), new Error('AUTHENTICATIONFAILED'), new Error('certificate has expired')]) {
  test(`${error.message} fails immediately`, async () => {
    const { client, clients, delays } = setup(() => error);
    await assert.rejects(client.connect(), /failed after 1 attempt/);
    assert.equal(clients.length, 1);
    assert.deepEqual(delays, []);
  });
}

for (const result of ['end', 'close', new Error('socket hang up'), new Error('connection ended unexpectedly')]) {
  test(`interrupted connect (${result}) retries`, async () => {
    const { client, clients } = setup(i => i === 0 ? result : null);
    await client.connect();
    assert.equal(clients.length, 2);
    assert.equal(clients[0].listenerCount('ready'), 0);
    assert.equal(clients[0].listenerCount('close'), 0);
    assert.equal(clients[0].listenerCount('end'), 0);
  });
}

test('connection diagnostics never expose raw server errors or credentials', async () => {
  const secret = `${config.gmail.user} ${config.gmail.password} ${config.wallit.importToken}`;
  const { client, logs } = setup(() => new Error(`Invalid credentials: ${secret}`));
  await assert.rejects(client.connect(), error => !error.message.includes(secret) && !error.cause);
  assert.ok(logs.every(line => !line.includes(secret)));
});

test('zero retries disables backoff', async () => {
  const previous = config.gmail.connectMaxRetries;
  config.gmail.connectMaxRetries = 0;
  try {
    const { client, clients, delays } = setup(() => new Error('timeout'));
    await assert.rejects(client.connect(), /failed after 1 attempt/);
    assert.equal(clients.length, 1);
    assert.deepEqual(delays, []);
  } finally {
    config.gmail.connectMaxRetries = previous;
  }
});

test('jitter varies delay and backoff is capped at 30 seconds', async () => {
  for (const random of [0, 0.99]) {
    const { client, delays } = setup(i => i === 0 ? new Error('timeout') : null, random);
    await client.connect();
    assert.equal(delays[0], Math.round(config.gmail.connectBaseDelayMs * (1 + random)));
  }
  const previous = config.gmail.connectBaseDelayMs;
  config.gmail.connectBaseDelayMs = 30_000;
  try {
    const { client, delays } = setup(i => i < 2 ? new Error('timeout') : null);
    await client.connect();
    assert.deepEqual(delays, [30_000, 30_000]);
  } finally {
    config.gmail.connectBaseDelayMs = previous;
  }
});
