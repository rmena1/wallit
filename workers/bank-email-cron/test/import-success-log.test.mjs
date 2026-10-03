import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailProcessor } from '../src/lib/process-email.mjs';

const cases = [
  ['transfer success', 'transfer', { transferId: 'xfer-1', sourceMovementId: 'src-1', destinationMovementId: 'dst-1' }, 'xfer-1'],
  ['transfer without transferId', 'transfer', { sourceMovementId: 'src-1' }, 'src-1'],
  ['movement success', 'movement', { movementId: 'mvt-1' }, 'mvt-1'],
  ['no ids', 'transfer', {}, 'unknown-id'],
  ['movementId takes precedence', 'movement', { movementId: 'mvt-1', transferId: 'xfer-1', sourceMovementId: 'src-1' }, 'mvt-1'],
  ['unusable ids', 'transfer', { movementId: '', transferId: null, sourceMovementId: ' ' }, 'unknown-id'],
];

for (const [name, kind, ids, expectedId] of cases) {
  test(`success log: ${name}`, async (t) => {
    const messages = [];
    t.mock.method(console, 'log', message => messages.push(message));
    const processEmail = createEmailProcessor({
      isTransaction: async () => true,
      chooseCategory: async () => null,
      logProcessing: async () => {},
      importToWallit: async payload => {
        assert.equal(payload.kind, kind);
        return { success: true, ...ids };
      },
    });
    const result = await processEmail({
      authentication: { verified: true }, uid: 42,
      messageId: 'synthetic-success-log',
      from: 'no-reply@tenpo.cl',
      textBody: `Has realizado una transferencia
Monto transferencia: $10.000
Nombre del destinatario: ${kind === 'transfer' ? 'Raimundo Mena' : 'Ana Perez'}
Banco de destino: BCI
Nº cuenta de destino: ****1164
Fecha: 26/09/2026
Hora: 12:00`,
    });

    assert.equal(result.success, true); assert.equal(result.advance, true); assert.equal(result.skip, false);
    assert.deepEqual(messages, ['UID 42: imported, advancing cursor']);
  });
}
