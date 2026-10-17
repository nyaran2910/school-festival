import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

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

export function configureMacNetwork() {
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
  return selectMacNetwork(run('/usr/sbin/networksetup', ['-listallhardwareports']),
    run('/sbin/ifconfig', []), networkInterfaces(), process.env);
}
