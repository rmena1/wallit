import net from 'node:net';

// The driver replaces the socket with a TLS wrapper when needed. Destroying the
// tracked underlying socket also closes that wrapper, without changing TLS policy.
export function createSocketTracker({ createSocket = () => new net.Socket() } = {}) {
  const sockets = new Set(); let attempt = 0;
  return {
    connect(options) {
      const wire = createSocket(); sockets.add(wire);
      wire.on('error', () => {}); // Safe during the connect-to-driver handoff.
      wire.once('close', () => sockets.delete(wire));
      const index = attempt++ % options.host.length;
      wire.host = options.host[index];
      return new Promise((resolve, reject) => {
        const ready = () => { cleanup(); resolve(wire); };
        const fail = () => { cleanup(); reject(new Error('database_connect_failed')); };
        const cleanup = () => { wire.removeListener('connect', ready); wire.removeListener('error', fail); wire.removeListener('close', fail); };
        wire.once('connect', ready); wire.once('error', fail); wire.once('close', fail);
        try { options.path ? wire.connect(options.path) : wire.connect(options.port[index], wire.host); }
        catch { fail(); wire.destroy(); }
      });
    },
    destroy() { for (const wire of sockets) wire.destroy(); sockets.clear(); },
  };
}

export function withDatabaseDeadline(operation, { timeoutMs = 20_000, onTimeout = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return; finished = true;
      try { onTimeout(); } catch { /* Still fail closed; no external error text. */ }
      reject(new Error('database_transport_timeout'));
    }, timeoutMs);
    Promise.resolve().then(operation).then(value => {
      if (finished) return; finished = true; clearTimeout(timer); resolve(value);
    }, error => {
      if (finished) return; finished = true; clearTimeout(timer); reject(error);
    });
  });
}
