import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openPhoneTunnel, waitTunnelUrl, TunnelRateLimitError, phoneTunnelConfig, writeTunnelToken } from '../phone-tunnel.mjs';

function child(message, success = false) {
  const process = new EventEmitter(); process.stdout = new EventEmitter(); process.stderr = new EventEmitter();
  queueMicrotask(() => { process.stderr.emit('data', Buffer.from(message)); if (!success) process.emit('exit', 1); });
  return process;
}
async function stateFile(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-tunnel-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'retry.json');
}
test('429 is distinct from a failed tunnel process', async () => {
  await assert.rejects(waitTunnelUrl(child('quick tunnel provisioning failed with status 429'), { output() {} }), TunnelRateLimitError);
  await assert.rejects(waitTunnelUrl(child('quick tunnel provisioning failed with status 503'), { output() {} }), error => !(error instanceof TunnelRateLimitError));
});
test('429 retries with bounded backoff, persists cooldown before waiting and clears it on success', async t => {
  const file = await stateFile(t); let clock = 1000, attempts = 0, stopped = 0; const waits = [];
  const result = await openPhoneTunnel({ stateFile: file, now: () => clock, log() {}, output() {},
    startTunnel: () => ++attempts <= 4 ? child('quick tunnel provisioning failed with status 429') : child('https://phone-ready.trycloudflare.com', true),
    stopTunnel: async () => { stopped++; },
    wait: async ms => { assert.equal(JSON.parse(await readFile(file, 'utf8')).retryAt, clock + ms); waits.push(ms); clock += ms; }
  });
  assert.equal(result.publicUrl, 'https://phone-ready.trycloudflare.com');
  assert.deepEqual(waits, [60000, 120000, 300000, 300000]); assert.equal(stopped, 4);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});
test('restarting the launcher respects the existing cooldown before making a request', async t => {
  const file = await stateFile(t); let clock = 1000, waited = false;
  await writeFile(file, JSON.stringify({ retryAt: 91000, attempts: 2 }));
  await openPhoneTunnel({ stateFile: file, now: () => clock, log() {}, output() {},
    wait: async ms => { assert.equal(ms, 90000); clock += ms; waited = true; },
    startTunnel: () => { assert(waited); return child('https://after-cooldown.trycloudflare.com', true); },
    stopTunnel: async () => assert.fail('healthy tunnel must remain running')
  });
});
test('a non-429 failure stops the attempt and is reported without repeated requests', async t => {
  let attempts = 0, stopped = 0;
  await assert.rejects(openPhoneTunnel({ stateFile: await stateFile(t), output() {},
    startTunnel: () => { attempts++; return child('network unavailable'); },
    stopTunnel: async () => { stopped++; }, wait: async () => assert.fail('must not retry')
  }), /exited/);
  assert.equal(attempts, 1); assert.equal(stopped, 1);
});


test('fixed tunnel uses the configured HTTPS origin; unset settings preserve quick mode', () => {
  assert.deepEqual(phoneTunnelConfig({}), { mode: 'quick' });
  assert.deepEqual(phoneTunnelConfig({ CLOUDFLARE_TUNNEL_TOKEN: ' test-token ', PUBLIC_BASE_URL: 'https://phone.example.com/' }),
    { mode: 'named', token: 'test-token', publicUrl: 'https://phone.example.com' });
});
test('incomplete or invalid fixed tunnel settings fail without exposing the token', () => {
  const secret = 'private-test-tunnel-token';
  for (const url of [undefined, 'invalid', 'http://phone.example.com', 'https://phone.example.com/path', 'https://user:pass@phone.example.com', 'https://phone.example.com/?q=1']) {
    assert.throws(() => phoneTunnelConfig({ CLOUDFLARE_TUNNEL_TOKEN: secret, PUBLIC_BASE_URL: url }),
      error => !error.message.includes(secret) && /PUBLIC_BASE_URL/.test(error.message));
  }
  assert.throws(() => phoneTunnelConfig({ PUBLIC_BASE_URL: 'https://phone.example.com' }), /CLOUDFLARE_TUNNEL_TOKEN/);
});
test('fixed tunnel credentials are stored in an owner-only file', async t => {
  const file = await stateFile(t);
  await writeFile(file, 'old', { mode: 0o644 });
  await writeTunnelToken(file, 'private-test-tunnel-token');
  assert.equal(await readFile(file, 'utf8'), 'private-test-tunnel-token\n');
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
