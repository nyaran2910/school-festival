import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findCloudflared } from '../cloudflared.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'sf-cloudflared-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, env: { PATH: '' }, platform: 'linux' };
}

test('explicit path takes priority and an invalid override fails clearly', async t => {
  const options = await fixture(t);
  options.env.CLOUDFLARED_PATH = '/chosen/cloudflared';
  assert.equal(await findCloudflared({ ...options, validate: async () => true }), '/chosen/cloudflared');
  await assert.rejects(findCloudflared({ ...options, validate: async () => false }), /Cannot run CLOUDFLARED_PATH/);
});

test('PATH installation is selected before cached versions', async t => {
  const options = await fixture(t);
  options.env.PATH = '/broken:/installed';
  assert.equal(await findCloudflared({ ...options, validate: async file => file === '/installed/cloudflared' }), '/installed/cloudflared');
});

test('cache selection sorts versions numerically and skips broken binaries', async t => {
  const options = await fixture(t);
  const cache = path.join(options.home, '.config/.wrangler/cloudflared');
  for (const version of ['2026.9.3', '2026.10.1', '2026.10.2', 'not-a-version']) {
    await mkdir(path.join(cache, version), { recursive: true });
  }
  assert.equal(await findCloudflared({ ...options, validate: async file => !file.includes('2026.10.2') }),
    path.join(cache, '2026.10.1/cloudflared'));
});

test('Windows XDG cache uses the executable suffix', async t => {
  const options = await fixture(t);
  options.platform = 'win32';
  options.env.XDG_CONFIG_HOME = path.join(options.home, 'config');
  const binary = path.join(options.env.XDG_CONFIG_HOME, '.wrangler/cloudflared/2026.10.1/cloudflared.exe');
  await mkdir(path.dirname(binary), { recursive: true });
  assert.equal(await findCloudflared({ ...options, validate: async file => file === binary }), binary);
});

test('macOS finds Homebrew even when it is absent from PATH', async t => {
  const options = await fixture(t);
  assert.equal(await findCloudflared({ ...options, platform: 'darwin', validate: async file => file === '/opt/homebrew/bin/cloudflared' }),
    '/opt/homebrew/bin/cloudflared');
});

test('missing local binaries leave the normal Wrangler download available', async t => {
  const options = await fixture(t);
  assert.equal(await findCloudflared({ ...options, validate: async () => false }), undefined);
});
