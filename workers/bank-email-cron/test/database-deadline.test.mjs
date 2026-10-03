import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import postgres from 'postgres';
import { createSocketTracker, withDatabaseDeadline } from '../src/lib/database-deadline.mjs';
const packet = (type, payload) => { const p = Buffer.from(payload), b = Buffer.alloc(5 + p.length); b[0] = type.charCodeAt(0); b.writeInt32BE(4 + p.length, 1); p.copy(b, 5); return b; };
const ready = packet('Z', Buffer.from('I'));
test('actual postgres driver blackholed response is client-bounded and underlying wire is destroyed', async () => {
  let writes = 0;
  class VirtualPg extends EventEmitter {
    readyState = 'open'; destroyed = false;
    write(data) {
      if (++writes === 1) queueMicrotask(() => this.emit('data', Buffer.concat([packet('R', Buffer.alloc(4)), ready, ready])));
      else if (data[0] === 81 && data.toString().includes('SET statement_timeout')) queueMicrotask(() => this.emit('data', Buffer.concat([packet('C', Buffer.from('SET\0')), ready])));
      return true;
    }
    end() { /* A half-close deliberately does not close this blackholed peer. */ }
    destroy() { this.destroyed = true; this.readyState = 'closed'; queueMicrotask(() => this.emit('close', false)); }
  }
  const wire = new VirtualPg();
  const db = postgres('postgresql://test:test@localhost:5432/test', { max: 1, fetch_types: false, connect_timeout: 1, idle_timeout: 0, max_lifetime: null, socket: () => wire });
  const session = await withDatabaseDeadline(() => db.reserve(), { timeoutMs: 100 });
  await withDatabaseDeadline(() => session.unsafe('SET statement_timeout = 20', [], { simple: true }), { timeoutMs: 100 });
  await assert.rejects(withDatabaseDeadline(() => session.unsafe('SELECT 1', [], { simple: true }), { timeoutMs: 20, onTimeout: () => { wire.destroy(); void db.end({ timeout: 0 }); } }), /database_transport_timeout/);
  assert.equal(wire.destroyed, true); await db.end({ timeout: 0 });
});
test('socket tracker preserves requested host/port and destroys physical transport on timeout', async () => {
  const wires = [];
  const tracker = createSocketTracker({ createSocket: () => {
    const wire = new EventEmitter(); wire.connect = (port, host) => { wire.target = { port, host }; queueMicrotask(() => wire.emit('connect')); };
    wire.destroy = () => { wire.destroyed = true; wire.emit('close'); }; wires.push(wire); return wire;
  } });
  await tracker.connect({ host: ['localhost'], port: [5432] }); assert.deepEqual(wires[0].target, { port: 5432, host: 'localhost' });
  tracker.destroy(); assert.equal(wires[0].destroyed, true);
});
