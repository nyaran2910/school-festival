import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopRegistered } from './server-registry.mjs';

const state = fileURLToPath(new URL('../.server/', import.meta.url));
try {
  const stopped = await stopRegistered(path.join(state, 'processes.jsonl'), path.join(state, 'server.lock'));
  console.log(stopped ? 'Parent servers and remaining child processes stopped.' : 'No parent server is running.');
  console.log('Network sharing remains enabled.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
