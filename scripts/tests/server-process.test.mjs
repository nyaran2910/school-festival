import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { acquireLock, start, completed, stop, waitHealth } from '../server-process.mjs';

test('one parent owns the lock; a released or crashed process can be restarted', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sf-parent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'server.lock');
  const release = await acquireLock(file);
  await assert.rejects(acquireLock(file), /Already running/);
  await release();
  const dead = start(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = dead.pid; await completed(dead);
  await writeFile(file, String(pid));
  const releaseAfterCrash = await acquireLock(file);
  await releaseAfterCrash();
});

test('readiness waits for the owned HTTP service and stop terminates it', async t => {
  const service = start(process.execPath, ['-e', `
    require('http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',function(){console.log(this.address().port)});
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => stop(service));
  const [output] = await once(service.stdout, 'data');
  await waitHealth(`http://127.0.0.1:${Number(output.toString())}/health`, [service], 3000);
  await stop(service);
  assert(service.exitCode !== null || service.signalCode !== null);
  await assert.rejects(waitHealth('http://127.0.0.1:1', [service], 100), /Server stopped/);
});
