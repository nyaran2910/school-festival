import { spawnSync } from 'node:child_process';
import { readFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acquireLock, start, stop, waitHealth } from './server-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = path.join(root, '.server');
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
const quote = value => `'${value.replaceAll("'", "''")}'`;
function configureNetwork() {
  const script = path.join(root, 'scripts/server-network.ps1');
  const output = path.join(state, 'network.json');
  const command = `& ${quote(script)} -NodePath ${quote(process.execPath)} -OutputPath ${quote(output)}` +
    (process.env.KOSEN_WIFI_ADAPTER ? ` -WifiAlias ${quote(process.env.KOSEN_WIFI_ADAPTER)}` : '') +
    (process.env.KOSEN_LAN_ADAPTER ? ` -LanAlias ${quote(process.env.KOSEN_LAN_ADAPTER)}` : '');
  const ps = body => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  let result = ps(`${command} -CheckOnly; exit $LASTEXITCODE`);
  if (result.status === 10) {
    console.log('Accept the Windows administrator prompt: share school Wi-Fi to Ethernet and allow the two LAN servers.');
    const encoded = Buffer.from(`${command}; $resultCode=$LASTEXITCODE; if ($resultCode -ne 0) { [void](Read-Host 'Network setup failed. Press Enter to close') }; exit $resultCode`, 'utf16le').toString('base64');
    result = ps(`$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}'; exit $p.ExitCode } catch { Write-Error $_; exit 1 }`);
    if (result.status !== 0) throw new Error('Windows network setup failed or was cancelled. Check the administrator window.');
    result = ps(`${command} -CheckOnly; exit $LASTEXITCODE`);
  }
  if (result.status !== 0) throw new Error(`Cannot prepare Windows network: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`);
  return output;
}
function launch(script, env) {
  const child = start(process.execPath, [script], { cwd: root, env });
  children.add(child);
  child.once('error', error => { console.error(error.message); void shutdown(1); });
  child.once('exit', code => {
    children.delete(child);
    if (!stopping) { console.error(`A server stopped (${code}). Stopping the other services.`); void shutdown(1); }
  });
  return child;
}
try {
  if (process.platform !== 'win32') throw new Error('just server configures a Windows parent PC. On this OS use just phone-start and just score-server.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Install Node.js 24 or newer.');
  release = await acquireLock(path.join(state, 'server.lock'));
  await access(path.join(root, 'apps/phone/package-lock.json'));
  await access(path.join(root, 'apps/score-server/src/index.mjs'));
  const network = JSON.parse((await readFile(configureNetwork(), 'utf8')).replace(/^\uFEFF/, ''));
  console.log(`Internet: ${network.wifiAlias} -> LAN: ${network.lanAlias} (${network.lanAddress})`);
  console.log('Router must be in AP/bridge mode with DHCP off; connect the parent to a LAN port.');
  const env = { ...process.env, PHONE_LAN_ADDRESS: network.lanAddress, LOCAL_PORT: '8080', PHONE_DISCOVERY_PORT: '42045',
    PORT: '8080', SCORE_PORT: '3080', SCORE_DISCOVERY_PORT: '42044', SCORE_HOST: '0.0.0.0', KOSEN_SERVER_NETWORK_READY: '1' };
  // These ports are also configured by the elevated helper.
  delete env.PHONE_HOST;
  await rm(path.join(root, 'apps/phone/.local/public-url'), { force: true });
  const phone = launch('scripts/phone-server.mjs', env);
  const score = launch('apps/score-server/src/index.mjs', env);
  await waitHealth('http://127.0.0.1:3080/health', [phone, score]);
  console.log('Score server ready. Phone dependency installation and HTTPS startup continue in this window.');
  // phone-server prints ready only after both local and public checks pass.
  console.log('Keep this window open. Ctrl+C stops all server processes. Network sharing remains enabled.');
} catch (error) { console.error(error.message); await shutdown(1); }
