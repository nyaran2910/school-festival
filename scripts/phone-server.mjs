import { openPhoneTunnel, phoneTunnelConfig, writeTunnelToken } from './phone-tunnel.mjs';
// Foreground, cross-platform launcher. No tmux, Python or OpenSSL required.
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireLock, start, completed, stop, waitHealth } from './server-process.mjs';
import { findCloudflared } from './cloudflared.mjs';

const root = fileURLToPath(new URL('../apps/phone/', import.meta.url));
const state = path.join(root, '.local');
const children = new Set();
const tokenFile = path.join(state, 'fixed-tunnel-token');
let release;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map(stop));
  if (release) {
    await rm(tokenFile, { force: true });
    await release();
  }
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
  const config = phoneTunnelConfig();
  const serviceEnv = { ...process.env };
  delete serviceEnv.CLOUDFLARE_TUNNEL_TOKEN;
  const tunnelEnv = { ...serviceEnv, CI: '1', NO_COLOR: '1' };
  const cloudflared = await findCloudflared();
  if (cloudflared) {
    tunnelEnv.CLOUDFLARED_PATH = cloudflared;
    console.log(`Using local cloudflared: ${cloudflared}`);
  }
  let tunnel, publicUrl;
  if (config.mode === 'named') {
    if (!cloudflared) throw new Error('Install cloudflared or set CLOUDFLARED_PATH to run the fixed tunnel.');
    await writeTunnelToken(tokenFile, config.token);
    publicUrl = config.publicUrl;
  } else {
    ({ tunnel, publicUrl } = await openPhoneTunnel({
      startTunnel: () => child(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'tunnel', 'quick-start', `http://127.0.0.1:${port}`],
        { env: tunnelEnv, stdio: ['ignore', 'pipe', 'pipe'] }),
      stopTunnel: stop,
      stateFile: path.join(state, 'tunnel-retry.json')
    }));
  }
  // Rotate freely: games obtain the current key through LAN discovery.
  const hostKey = randomBytes(32).toString('hex');
  const server = child(process.execPath, ['dist/src/index.js'], { env: { ...serviceEnv,
    HOST_KEY: hostKey, PUBLIC_BASE_URL: publicUrl, PORT: String(port) } });
  if (config.mode === 'named') {
    tunnel = child(cloudflared, ['tunnel', '--no-autoupdate', 'run', '--token-file', tokenFile], { env: tunnelEnv });
    console.log(`Fixed HTTPS tunnel: ${publicUrl}`);
  }
  for (const service of [tunnel, server]) service.once('exit', () => {
    if (!stopping) { console.error('Phone service stopped. Run the command again.'); void shutdown(1); }
  });
  await waitHealth(`http://127.0.0.1:${port}/healthz`, [server, tunnel]);
  let publicReady = true;
  try { await waitHealth(`${publicUrl}/healthz`, [server, tunnel], 90000); }
  catch (error) {
    if ([server, tunnel].some(service => service.exitCode !== null || service.signalCode !== null)) throw error;
    publicReady = false;
    console.error('Phone LAN server and tunnel are running, but public HTTPS could not be verified. Check Cloudflare DNS and browser-challenge rules. Services will remain running.');
  }
  await writeFile(path.join(state, 'public-url'), publicUrl);
  console.log(`${publicReady ? "Phone server ready" : "Phone LAN ready; public HTTPS unverified"}: ${publicUrl}\nGames discover it automatically. Keep this window open; Ctrl+C stops the server.`);
} catch (error) { console.error(error.message); await shutdown(1); }
