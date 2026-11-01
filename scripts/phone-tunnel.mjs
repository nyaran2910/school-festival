import { readFile, writeFile, chmod, rm } from 'node:fs/promises';

export class TunnelRateLimitError extends Error {}

export function waitTunnelUrl(tunnel, { output = data => process.stdout.write(data), timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let captured = '';
    const timer = setTimeout(() => reject(new Error('HTTPS tunnel URL timed out. Check upstream internet access.')), timeout);
    const receive = data => {
      output(data);
      captured = (captured + data.toString()).slice(-16000);
      const match = captured.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    };
    tunnel.stdout.on('data', receive); tunnel.stderr.on('data', receive);
    tunnel.once('exit', () => {
      clearTimeout(timer);
      reject(/quick tunnel provisioning failed with status 429/i.test(captured)
        ? new TunnelRateLimitError('Cloudflare quick tunnel rate limit (429)')
        : new Error('HTTPS tunnel exited before publishing a URL.'));
    });
    tunnel.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

export async function openPhoneTunnel({ startTunnel, stopTunnel, stateFile,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  log = console.log, output, timeout } = {}) {
  let state = { retryAt: 0, attempts: 0 };
  try {
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    if (Number.isFinite(saved.retryAt) && saved.retryAt >= 0 && Number.isInteger(saved.attempts) && saved.attempts >= 0)
      state = saved;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  while (true) {
    const remaining = Math.min(300000, Math.max(0, state.retryAt - now()));
    if (remaining) {
      log(`Cloudflareの429制限でスマホHTTPSは待機中です。${Math.ceil(remaining / 1000)}秒後に自動再試行します。スコアは継続します。`);
      await wait(remaining);
    }
    const tunnel = startTunnel();
    try {
      const publicUrl = await waitTunnelUrl(tunnel, { output, timeout });
      await rm(stateFile, { force: true });
      return { tunnel, publicUrl };
    } catch (error) {
      await stopTunnel(tunnel);
      if (!(error instanceof TunnelRateLimitError)) throw error;
      const attempts = Math.min(state.attempts + 1, 3);
      const delay = [0, 60000, 120000, 300000][attempts];
      state = { retryAt: now() + delay, attempts };
      await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    }
  }
}


export function phoneTunnelConfig(env = process.env) {
  const token = (env.CLOUDFLARE_TUNNEL_TOKEN ?? '').trim();
  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? '').trim();
  if (!token && !publicBaseUrl) return { mode: 'quick' };
  if (!token || !publicBaseUrl) throw new Error('Set both CLOUDFLARE_TUNNEL_TOKEN and PUBLIC_BASE_URL for a fixed tunnel.');
  let url;
  try { url = new URL(publicBaseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be an HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin without a path or credentials.');
  return { mode: 'named', token, publicUrl: url.origin };
}

export async function writeTunnelToken(file, token) {
  await writeFile(file, token + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
}
