import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
async function works(file) {
  try {
    const { stdout } = await run(file, ['--version'], { timeout: 5000, windowsHide: true });
    return /cloudflared version \d+\.\d+\.\d+/.test(stdout);
  } catch { return false; }
}

// Pin a local binary so Wrangler never needs its update service to start it.
export async function findCloudflared({ env = process.env, home = os.homedir(), platform = process.platform,
  validate = works } = {}) {
  if (env.CLOUDFLARED_PATH) {
    if (!await validate(env.CLOUDFLARED_PATH)) throw new Error(`Cannot run CLOUDFLARED_PATH: ${env.CLOUDFLARED_PATH}`);
    return env.CLOUDFLARED_PATH;
  }
  const binary = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const directories = (env.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  if (platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin');
  for (const directory of new Set(directories)) {
    const file = path.resolve(directory, binary);
    if (await validate(file)) return file;
  }
  const config = env.XDG_CONFIG_HOME ?? (platform === 'darwin' ? path.join(home, 'Library/Preferences') :
    platform === 'win32' ? path.join(env.APPDATA ?? path.join(home, 'AppData/Roaming'), 'xdg.config') : path.join(home, '.config'));
  const roots = new Set([path.join(home, '.wrangler'), path.join(config, '.wrangler'), path.join(home, '.config/.wrangler')]);
  const candidates = [];
  for (const root of roots) {
    const cache = path.join(root, 'cloudflared');
    let entries;
    try { entries = await readdir(cache, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name)) {
        candidates.push({ version: entry.name, file: path.join(cache, entry.name, binary) });
      }
    }
  }
  candidates.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
  for (const { file } of candidates) if (await validate(file)) return file;
  // A fresh machine still uses Wrangler's normal download flow.
  return undefined;
}
