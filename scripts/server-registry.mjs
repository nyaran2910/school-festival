import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';

// Creation time prevents a stale PID file from targeting a reused PID.
export function identity(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CreationDate.ToUniversalTime().Ticks; $p.CommandLine }`], { encoding: 'utf8', windowsHide: true })
    : spawnSync('ps', ['-p', String(pid), '-o', 'lstart=,command='], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (process.platform !== 'win32' && result.status === 1) return null;
    throw new Error('Cannot inspect server process identity');
  }
  return result.stdout.trim() || null;
}

export function remember(file, pid, group = false) {
  if (!file || !pid) return;
  const signature = identity(pid);
  if (signature) appendFileSync(file, JSON.stringify({ pid, group, signature }) + '\n', { mode: 0o600 });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function terminate(record) {
  if (identity(record.pid) !== record.signature) return false;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 && identity(record.pid) === record.signature) throw new Error(`Cannot stop server process ${record.pid}`);
  } else {
    const target = record.group ? -record.pid : record.pid;
    try { process.kill(target, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (let attempt = 0; attempt < 40; attempt++) {
      if (identity(record.pid) !== record.signature) return true;
      await delay(100);
    }
    if (identity(record.pid) === record.signature) {
      try { process.kill(target, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  return true;
}

export async function stopRegistered(file, lock) {
  let records = [];
  try { records = (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Support servers launched before process registration was introduced.
  let owner;
  try {
    const pid = Number(await readFile(lock, 'utf8'));
    const signature = identity(pid);
    if (signature) {
      if (!/(?:^|[\s/\\])scripts[/\\]server\.mjs(?:\s|$)/.test(signature))
        throw new Error('Server lock belongs to a different process; refusing to stop it');
      owner = { pid, signature, group: false };
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let stopped = 0;
  // Let the parent perform its normal cleanup, then sweep any surviving children.
  if (owner && await terminate(owner)) stopped++;
  for (const record of records) {
    if (await terminate(record)) stopped++;
  }
  await rm(file, { force: true });
  await rm(lock, { force: true });
  return stopped;
}
