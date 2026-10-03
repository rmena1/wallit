// Imported before application modules in every isolated test process.
// Database, IMAP, HTTP(S), TLS and DNS cannot reach any host, even localhost.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('ISOLATED_TEST_NETWORK_DISABLED'); };
net.Socket.prototype.connect = function () {
  queueMicrotask(() => this.emit('error', new Error('ISOLATED_TEST_NETWORK_DISABLED')));
  return this;
};
net.connect = net.createConnection = deny;
tls.connect = deny;
http.request = http.get = https.request = https.get = deny;
dns.lookup = dns.resolve = deny;
dns.promises.lookup = dns.promises.resolve = async () => deny();
globalThis.fetch = async () => deny();
syncBuiltinESMExports();
process.env.WALLIT_TEST_NETWORK_DISABLED = '1';
