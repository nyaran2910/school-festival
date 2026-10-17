import assert from 'node:assert/strict';
import test from 'node:test';
import { selectMacNetwork } from '../server-network-macos.mjs';
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
