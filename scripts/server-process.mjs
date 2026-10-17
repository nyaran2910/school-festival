import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export async function acquireLock(file) {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(file, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(file, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error(`Invalid lock file: ${file}`);
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      await rm(file);
      return acquireLock(file);
    }
    throw new Error(`Already running (PID ${pid}). Close the existing server first.`);
  }
  return () => rm(file, { force: true });
}

export function start(command, args, options = {}) {
  return spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32', ...options });
}
export function completed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Process failed (${code ?? signal})`)));
  });
}
export async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    // Kill the complete owned process tree, including Wrangler's cloudflared.
    await completed(start('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })).catch(() => {});
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  let timer;
  try {
    await Promise.race([exited, new Promise(resolve => {
      timer = setTimeout(() => {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
        resolve();
      }, 3000);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}
export async function health(url, timeout = 3000) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(timeout) }); return response.ok; }
  catch { return false; }
}
export async function waitHealth(url, children, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (children.some(child => child.exitCode !== null || child.signalCode !== null)) throw new Error(`Server stopped while waiting for ${url}`);
    if (await health(url)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not become ready: ${url}`);
}
