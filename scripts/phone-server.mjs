// Foreground, cross-platform launcher. No tmux, Python or OpenSSL required.
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireLock, start, completed, stop, waitHealth } from './server-process.mjs';
import { findCloudflared } from './cloudflared.mjs';

const root = fileURLToPath(new URL('../apps/phone/', import.meta.url));
const state = path.join(root, '.local');
const children = new Set();
let release;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(stop));
  if (release) await release();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown());
function child(command, args, options = {}) {
  const processChild = start(command, args, { cwd: root, ...options });
  children.add(processChild);
  processChild.once('error', error => { console.error(error.message); void shutdown(1); });
  processChild.once('exit', () => { children.delete(processChild); });
  return processChild;
}
async function npm(args) {
  // Only fixed npm subcommands are passed to cmd.exe.
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const argv = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args;
  await completed(child(command, argv));
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Install Node.js 24 or newer.');
  release = await acquireLock(path.join(state, 'portable.lock'));
  const lock = await readFile(path.join(root, 'package-lock.json'));
  const fingerprint = createHash('sha256').update(lock).update(process.versions.node.split('.')[0]).digest('hex');
  const stamp = path.join(state, 'dependencies');
  let installed = false;
  try {
    installed = (await readFile(stamp, 'utf8')) === fingerprint;
    await access(path.join(root, 'node_modules/wrangler/bin/wrangler.js'));
    await access(path.join(root, 'node_modules/typescript/bin/tsc'));
  } catch { installed = false; }
  if (!installed) { await npm(['ci']); await writeFile(stamp, fingerprint); }
  await npm(['run', 'build']);
  const port = Number(process.env.LOCAL_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LOCAL_PORT');
  const tunnelEnv = { ...process.env, CI: '1', NO_COLOR: '1' };
  const cloudflared = await findCloudflared();
  if (cloudflared) {
    tunnelEnv.CLOUDFLARED_PATH = cloudflared;
    console.log(`Using local cloudflared: ${cloudflared}`);
  }
  const tunnel = child(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'tunnel', 'quick-start', `http://127.0.0.1:${port}`],
    { env: tunnelEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const publicUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('HTTPS tunnel URL timed out. Check the school Wi-Fi login and tunnel access.')), 60000);
    const receive = data => {
      process.stdout.write(data);
      output = (output + data.toString()).slice(-16000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    tunnel.stdout.on('data', receive); tunnel.stderr.on('data', receive);
    tunnel.once('exit', () => { clearTimeout(timer); reject(new Error('HTTPS tunnel exited before publishing a URL.')); });
    tunnel.once('error', error => { clearTimeout(timer); reject(error); });
  });
  // Rotate freely: games obtain the current key through LAN discovery.
  const hostKey = randomBytes(32).toString('hex');
  const server = child(process.execPath, ['dist/src/index.js'], { env: { ...process.env,
    HOST_KEY: hostKey, PUBLIC_BASE_URL: publicUrl, PORT: String(port) } });
  for (const service of [tunnel, server]) service.once('exit', () => {
    if (!stopping) { console.error('Phone service stopped. Run the command again.'); void shutdown(1); }
  });
  await waitHealth(`http://127.0.0.1:${port}/healthz`, [server, tunnel]);
  await waitHealth(`${publicUrl}/healthz`, [server, tunnel], 90000);
  await writeFile(path.join(state, 'public-url'), publicUrl);
  console.log(`Phone server ready: ${publicUrl}\nGames discover it automatically. Keep this window open; Ctrl+C stops the server.`);
} catch (error) { console.error(error.message); await shutdown(1); }
