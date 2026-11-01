import test from 'node:test'
import assert from 'node:assert/strict'
import { localAddresses } from '../certificates.mjs'

test('el enlace del salón prioriza wifi y no la red privada de VirtualBox', () => {
  const network = {
    'Ethernet 2': [{ family: 'IPv4', address: '192.168.56.1', internal: false, mac: '0a:00:27:00:00:0c' }],
    'Wi-Fi': [{ family: 'IPv4', address: '192.168.15.12', internal: false, mac: 'e8:b0:c5:74:96:31' }],
    Ethernet: [{ family: 'IPv4', address: '192.168.1.2', internal: false, mac: 'aa:bb:cc:dd:ee:ff' }],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true, mac: '00:00:00:00:00:00' }],
  }
  assert.deepEqual(localAddresses(network), ['192.168.15.12', '192.168.1.2', '192.168.56.1'])
})
