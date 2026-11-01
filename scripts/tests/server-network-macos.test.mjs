import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectMacNetwork, findMacBridgeMember, planMacBridgeRepair, applyMacBridgeRepair } from '../server-network-macos.mjs';
const hardware = 'Hardware Port: Wi-Fi\nDevice: en0\n\nHardware Port: USB LAN\nDevice: en7\n\nHardware Port: USB LAN 2\nDevice: en9\n';
const address = (ip, netmask = '255.255.255.0') => [{ family: 'IPv4', internal: false, address: ip, netmask }];
const wifi = { en0: address('172.20.10.2', '255.255.255.240') };
const config = 'en0: flags=up\n\tstatus: active\nen7: flags=up\n\tstatus: active\nen9: flags=up\n\tstatus: inactive\n';
test('wired router LAN is advertised instead of the tethering address', () => {
  assert.deepEqual(selectMacNetwork(hardware, config, { ...wifi, en7: address('192.168.0.100') }),
    { wifiAlias: 'en0', lanAlias: 'en7', lanAddress: '192.168.0.100' });
});
test('Internet Sharing bridge address is selected through its Ethernet member', () => {
  const bridged = config + 'bridge100: flags=up\n\tmember: en7 flags=3\n\tstatus: active\n';
  const interfaces = { ...wifi, bridge100: address('192.168.2.1') };
  assert.equal(selectMacNetwork(hardware, bridged, interfaces).lanAlias, 'bridge100');
  assert.equal(selectMacNetwork(hardware, bridged, interfaces, { KOSEN_LAN_ADAPTER: 'en7' }).lanAddress, '192.168.2.1');
});
test('missing cable or DHCP address does not fall back to upstream Wi-Fi', () => {
  assert.throws(() => selectMacNetwork(hardware, config, wifi), /有線LAN/);
  assert.throws(() => selectMacNetwork(hardware, config, { ...wifi, en7: address('169.254.2.3') }), /有線LAN/);
});
test('ambiguous Ethernet requires explicit adapter selection', () => {
  const both = config.replace('status: inactive', 'status: active');
  const interfaces = { ...wifi, en7: address('192.168.0.100'), en9: address('192.168.1.100') };
  assert.throws(() => selectMacNetwork(hardware, both, interfaces), /有線LAN/);
  assert.equal(selectMacNetwork(hardware, both, interfaces, { KOSEN_LAN_ADAPTER: 'en9' }).lanAlias, 'en9');
});
test('overlapping upstream and downstream ranges are rejected', () => {
  assert.throws(() => selectMacNetwork(hardware, config, { ...wifi, en7: address('172.20.10.4') }), /重複/);
});

const network = { lanAlias: 'bridge100', lanAddress: '192.168.2.1' };
const asixHardware = hardware.replace('USB LAN\nDevice: en7', 'AX88179\nDevice: en7');
const originalMac = 'ae:07:75:c2:59:64', targetMac = '04:ab:18:fa:3d:1f';
const bridgeState = mac => `bridge100: flags=up\n\tether ${mac}\n\tinet 192.168.2.1 netmask 0xffffff00 broadcast 192.168.2.255\n\tmember: en7 flags=3\n\tstatus: active\n`;
const memberState = `en7: flags=up\n\tether ${targetMac}\n\tstatus: active\n`;
const repair = () => planMacBridgeRepair(network, 'en7', bridgeState(originalMac), memberState);

test('only a single AX88179 member of the selected shared bridge is repaired', () => {
  assert.equal(findMacBridgeMember(network, asixHardware, bridgeState(originalMac)), 'en7');
  assert.equal(findMacBridgeMember(network, hardware, bridgeState(originalMac)), null);
  assert.equal(findMacBridgeMember({ lanAlias: 'en7' }, asixHardware, bridgeState(originalMac)), null);
  assert.throws(() => findMacBridgeMember(network, asixHardware,
    bridgeState(originalMac).replace('member: en7 flags=3', 'member: en7 flags=3\n\tmember: en9 flags=3')), /一意/);
});
test('a matching MAC is a no-op; masked or invalid MACs never become repair targets', () => {
  assert.equal(planMacBridgeRepair(network, 'en7', bridgeState(targetMac), memberState), null);
  assert.throws(() => planMacBridgeRepair(network, 'en7', bridgeState('02:00:00:00:00:00'), memberState), /実MAC/);
  assert.throws(() => planMacBridgeRepair(network, 'en7', bridgeState(originalMac), memberState.replace(targetMac, 'ff:ff:ff:ff:ff:ff')), /実MAC/);
  assert.equal(applyMacBridgeRepair(null, { run: () => assert.fail('no-op must not call sudo') }), false);
});
function temporary(t) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'sf-bridge-'));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  return stateDir;
}
test('repair saves the original state before changing the MAC and verifies its result', t => {
  const stateDir = temporary(t); let current = originalMac; const calls = [];
  assert.equal(applyMacBridgeRepair(repair(), { stateDir,
    run: (bridge, mac) => {
      const saved = JSON.parse(readFileSync(path.join(stateDir, 'mac-bridge-backups.jsonl'), 'utf8').trim());
      assert.equal(saved.originalMac, originalMac); assert.equal(saved.bridge, 'bridge100');
      calls.push([bridge, mac]); current = mac;
    }, readBridge: () => bridgeState(current) }), true);
  assert.deepEqual(calls, [['bridge100', targetMac]]);
});
test('a failed repair is rolled back and cannot report success', t => {
  const stateDir = temporary(t); let current = originalMac; const calls = [];
  assert.throws(() => applyMacBridgeRepair(repair(), { stateDir,
    run: (bridge, mac) => { calls.push(mac); current = mac; if (mac === targetMac) throw new Error('driver failed'); },
    readBridge: () => bridgeState(current) }), /元のMACへ復元/);
  assert.deepEqual(calls, [targetMac, originalMac]); assert.equal(current, originalMac);
});
test('verification failure rolls back; restoration failure is explicitly reported', t => {
  const stateDir = temporary(t); let current = originalMac;
  assert.throws(() => applyMacBridgeRepair(repair(), { stateDir,
    run: (_, mac) => { current = mac; },
    readBridge: () => current === targetMac ? bridgeState(current).replace('192.168.2.1 ', '192.168.9.1 ') : bridgeState(current)
  }), /元のMACへ復元/);
  assert.equal(current, originalMac);
  assert.throws(() => applyMacBridgeRepair(repair(), { stateDir,
    run: () => { throw new Error('permission denied'); }, readBridge: () => bridgeState(originalMac)
  }), /補正と復元に失敗/);
});
