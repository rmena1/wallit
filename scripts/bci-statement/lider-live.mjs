import { fileURLToPath } from 'node:url';
import { runLider } from './lider-session.mjs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--from' || args[2] !== '--to') {
    process.stderr.write('Uso: node lider-live.mjs --from YYYY-MM-DD --to YYYY-MM-DD\n'); process.exitCode = 1;
  } else {
    try { process.stdout.write(JSON.stringify(await runLider({ from: args[1], to: args[3] }), null, 2) + '\n'); }
    catch (error) { process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'LIDER_FAILED' } }) + '\n'); process.exitCode = 1; }
  }
}
