import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const sharingHelp = 'システム設定 → 一般 → 共有 → インターネット共有で、共有元をWi-Fi（sirius）、共有先をルーターにつないだ有線LANにしてください。ルーターをAP／ブリッジモードにする場合はDHCPをオフにし、MacをLANポートへ接続してください。';

export function selectMacNetwork(hardware, config, interfaces, env = {}) {
  const ports = [...hardware.matchAll(/Hardware Port: (.+)\r?\nDevice: (\S+)/g)]
    .map(([, label, device]) => ({ label, device }));
  const blocks = new Map([...config.matchAll(/^(\S+):[^\n]*\n([\s\S]*?)(?=^\S+:|$(?![\s\S]))/gm)]
    .map(([, name, body]) => [name, body]));
  const active = name => /status: active/.test(blocks.get(name) ?? '');
  const addresses = name => (interfaces[name] ?? []).filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  const wifiPorts = ports.filter(p => /Wi-Fi|AirPort/i.test(p.label));
  const wifi = wifiPorts.filter(p => (!env.KOSEN_WIFI_ADAPTER || p.device === env.KOSEN_WIFI_ADAPTER) && active(p.device) && addresses(p.device).length === 1);
  if (wifi.length !== 1) throw new Error('siriusへWi-Fi接続してください。複数ある場合はKOSEN_WIFI_ADAPTERにデバイス名（例 en0）を指定してください。');
  const ethernet = ports.filter(p => !/Wi-Fi|AirPort/i.test(p.label) && !/^bridge/.test(p.device) && active(p.device));
  const lanNames = new Set();
  for (const port of ethernet) {
    if (addresses(port.device).length) lanNames.add(port.device);
    for (const [name, body] of blocks) {
      if (/^bridge/.test(name) && active(name) && new RegExp(`member: ${port.device}\\s`).test(body) && addresses(name).length) lanNames.add(name);
    }
  }
  const candidates = [...lanNames].filter(name => !env.KOSEN_LAN_ADAPTER || name === env.KOSEN_LAN_ADAPTER ||
    [...(blocks.get(name) ?? '').matchAll(/member: (\S+)/g)].some(([, member]) => member === env.KOSEN_LAN_ADAPTER));
  if (candidates.length !== 1 || addresses(candidates[0]).length !== 1) {
    throw new Error(`有線LANのIPv4アドレスを特定できません。ケーブルとUSB LANアダプターを確認してください。複数ある場合はKOSEN_LAN_ADAPTERにデバイス名を指定してください。\n${sharingHelp}`);
  }
  const lan = addresses(candidates[0])[0];
  const upstream = addresses(wifi[0].device)[0];
  const number = ip => ip.split('.').reduce((n, octet) => (n * 256 + Number(octet)) >>> 0, 0);
  const overlaps = (a, b) => ((number(a.address) & number(a.netmask) & number(b.netmask)) >>> 0) === ((number(b.address) & number(a.netmask) & number(b.netmask)) >>> 0);
  if (overlaps(lan, upstream)) throw new Error('Wi-Fiと有線LANのIPv4範囲が重複しています。有線ルーター側を別のIP帯にしてください。');
  return { wifiAlias: wifi[0].device, lanAlias: candidates[0], lanAddress: lan.address };
}

const validMac = value => typeof value === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(value) &&
  value !== '00:00:00:00:00:00' && value !== '02:00:00:00:00:00' && !(parseInt(value.slice(0, 2), 16) & 1);
const configBlock = (config, name) => [...config.matchAll(/^(\S+):[^\n]*\n([\s\S]*?)(?=^\S+:|$(?![\s\S]))/gm)]
  .find(([, candidate]) => candidate === name)?.[2] ?? '';
const macOf = config => config.match(/\bether ([0-9a-f:]{17})\b/i)?.[1].toLowerCase();

export function findMacBridgeMember(network, hardware, config) {
  if (!/^bridge\d+$/.test(network.lanAlias)) return null;
  const members = [...configBlock(config, network.lanAlias).matchAll(/member: (\S+)\s/g)].map(([, name]) => name);
  const asix = [...hardware.matchAll(/Hardware Port: ([^\n]+)\r?\nDevice: (\S+)/g)]
    .filter(([, label, device]) => /\bAX88179\b/i.test(label) && members.includes(device)).map(([, , device]) => device);
  if (!asix.length) return null;
  if (members.length !== 1 || asix.length !== 1 || !/^en\d+$/.test(asix[0]))
    throw new Error('AX88179共有LANの構成を一意に特定できません。MAC補正を中止します。');
  return asix[0];
}

export function planMacBridgeRepair(network, member, bridgeConfig, memberConfig) {
  if (!/^bridge\d+$/.test(network.lanAlias) || !/^en\d+$/.test(member)) throw new Error('Invalid bridge repair interface');
  const originalMac = macOf(bridgeConfig), targetMac = macOf(memberConfig);
  if (!validMac(originalMac) || !validMac(targetMac)) throw new Error('共有LANの実MACアドレスを読み取れません。MAC補正を中止します。');
  if (originalMac === targetMac) return null;
  return { bridge: network.lanAlias, member, lanAddress: network.lanAddress, originalMac, targetMac };
}

export function applyMacBridgeRepair(repair, { stateDir, run, readBridge }) {
  if (!repair) return false;
  if (!stateDir) throw new Error('MAC補正のバックアップ保存先がありません。');
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(path.join(stateDir, 'mac-bridge-backups.jsonl'),
    JSON.stringify({ ...repair, time: new Date().toISOString() }) + '\n', { mode: 0o600 });
  try {
    run(repair.bridge, repair.targetMac);
    const actual = readBridge();
    if (macOf(actual) !== repair.targetMac || !actual.includes(`inet ${repair.lanAddress} `))
      throw new Error('補正後のMACまたはLANアドレスを確認できません。');
  } catch (error) {
    try {
      run(repair.bridge, repair.originalMac);
      if (macOf(readBridge()) !== repair.originalMac) throw new Error('復元後のMACが一致しません。');
    } catch (restoreError) {
      throw new Error(`共有LANのMAC補正と復元に失敗しました: ${error.message}; ${restoreError.message}`);
    }
    throw new Error(`共有LANのMAC補正に失敗し、元のMACへ復元しました: ${error.message}`);
  }
  return true;
}

function privilegedIfconfig(args) {
  const command = '/sbin/ifconfig';
  const sudoOptions = { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } };
  if (process.getuid?.() === 0) return execFileSync(command, args, { encoding: 'utf8' });
  try { return execFileSync('/usr/bin/sudo', ['-n', command, ...args], { ...sudoOptions, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) {
    // Only retry an authentication failure. A failed network operation must be
    // reported and rolled back rather than executed a second time.
    if (!/password is required|a terminal is required|no tty present/i.test(error.stderr?.toString() ?? '')) throw error;
    console.log('AX88179共有LANのMAC確認・補正に管理者権限が必要です。');
    return execFileSync('/usr/bin/sudo', [command, ...args], { ...sudoOptions, stdio: ['inherit', 'pipe', 'inherit'] });
  }
}

export function configureMacNetwork({ stateDir } = {}) {
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
  const hardware = run('/usr/sbin/networksetup', ['-listallhardwareports']);
  const config = run('/sbin/ifconfig', []);
  const network = selectMacNetwork(hardware, config, networkInterfaces(), process.env);
  const member = findMacBridgeMember(network, hardware, config);
  if (member && stateDir) {
    // macOS masks MACs for unprivileged processes, so inspect only these two
    // interfaces with sudo; the Node servers continue running as the user.
    const readBridge = () => privilegedIfconfig([network.lanAlias]);
    const repair = planMacBridgeRepair(network, member, readBridge(), privilegedIfconfig([member]));
    if (applyMacBridgeRepair(repair, { stateDir, readBridge,
      run: (bridge, mac) => privilegedIfconfig([bridge, 'ether', mac]) }))
      console.log(`共有LANのMACを補正しました: ${repair.bridge} → ${repair.targetMac} (${repair.member})`);
  }
  return network;
}
