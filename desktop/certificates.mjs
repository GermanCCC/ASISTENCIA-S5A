import forge from 'node-forge'
import { networkInterfaces } from 'node:os'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, X509Certificate } from 'node:crypto'

export function localAddresses(interfaces = networkInterfaces()) {
  // VirtualBox puede llamar "Ethernet 2" a su red interna. Se reconoce también
  // por su MAC para no mostrar su dirección como si fuera el wifi del salón.
  const priority = ([name, entries]) => {
    if (/virtual|vmware|vethernet|wsl|teredo/i.test(name) || entries.some(entry => /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:15:5d):/i.test(entry.mac))) return 3
    return /wi-?fi|wlan|inalámbr/i.test(name) ? 0 : 1
  }
  return Object.entries(interfaces).sort((a, b) => priority(a) - priority(b))
    .flatMap(([, entries]) => entries.filter(e => e.family === 'IPv4' && !e.internal).map(e => e.address))
}
function createCertificate(publicKey, issuer, subject, days) {
  const cert = forge.pki.createCertificate()
  cert.publicKey = publicKey
  cert.serialNumber = '01' + randomBytes(15).toString('hex')
  cert.validity.notBefore = new Date(Date.now() - 86400000)
  cert.validity.notAfter = new Date(Date.now() + days * 86400000)
  cert.setIssuer(issuer)
  cert.setSubject(subject)
  return cert
}

export async function localCertificates(dataDir, addresses) {
  const directory = path.join(dataDir, 'certificates')
  await mkdir(directory, { recursive: true })
  let ca, caKey, caPem
  try {
    caPem = await readFile(path.join(directory, 'salon-ca.crt'), 'utf8')
    ca = forge.pki.certificateFromPem(caPem)
    caKey = forge.pki.privateKeyFromPem(await readFile(path.join(directory, 'salon-ca.key'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const subject = [{ name: 'commonName', value: `Asistencia del salon ${randomBytes(3).toString('hex')}` }]
    ca = createCertificate(keys.publicKey, subject, subject, 3650)
    ca.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }, { name: 'subjectKeyIdentifier' }])
    ca.sign(keys.privateKey, forge.md.sha256.create())
    caKey = keys.privateKey
    caPem = forge.pki.certificateToPem(ca)
    await writeFile(path.join(directory, 'salon-ca.key'), forge.pki.privateKeyToPem(caKey), { mode: 0o600 })
    await writeFile(path.join(directory, 'salon-ca.crt'), caPem)
  }
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = createCertificate(keys.publicKey, ca.subject.attributes, [{ name: 'commonName', value: 'Asistencia local' }], 365)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...new Set(['127.0.0.1', ...addresses])].map(value => typeof value === 'string' ? { type: 7, ip: value } : value) },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert), caPem, fingerprint: new X509Certificate(caPem).fingerprint256 }
}
