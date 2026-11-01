import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { remember, identity, stopRegistered } from '../server-registry.mjs';
import { start, stop } from '../server-process.mjs';

test('stop cleans up a registered orphan and is safe to repeat', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-stop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = path.join(directory, 'processes.jsonl');
  const lock = path.join(directory, 'server.lock');
  const child = start(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => stop(child));
  await once(child.stdout, 'data');
  remember(registry, child.pid, process.platform !== 'win32');
  assert.equal(await stopRegistered(registry, lock), 1);
  assert.equal(identity(child.pid), null);
  assert.equal(await stopRegistered(registry, lock), 0);
});

test('a reused PID in the registry never stops a different process', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-stop-stale-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = path.join(directory, 'processes.jsonl');
  remember(registry, process.pid);
  const record = JSON.parse((await readFile(registry, 'utf8')).trim());
  record.signature = 'old process creation time';
  await writeFile(registry, JSON.stringify(record) + '\n');
  assert.equal(await stopRegistered(registry, path.join(directory, 'server.lock')), 0);
  assert(identity(process.pid));
});

test('a lock belonging to an unrelated process is rejected', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-stop-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = path.join(directory, 'server.lock');
  await writeFile(lock, String(process.pid));
  await assert.rejects(stopRegistered(path.join(directory, 'processes.jsonl'), lock), /different process/);
  assert(identity(process.pid));
});
