import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import _signpdfDefault from '@signpdf/signpdf'
import { P12Signer } from '@signpdf/signer-p12'
// Vite CJS interop can wrap the module once or twice depending on __esModule flag.
// Walk until we find the object that actually has a .sign method.
function resolveSignpdf(m) {
  if (m && typeof m.sign === 'function') return m
  if (m && typeof m.default?.sign === 'function') return m.default
  if (m && typeof m.default?.default?.sign === 'function') return m.default.default
  throw new Error('Could not resolve signpdf.sign — check @signpdf/signpdf interop')
}
const signpdf = resolveSignpdf(_signpdfDefault)

async function generateKeyPair() {
  const wc = await window.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )

  const [privDer, pubDer] = await Promise.all([
    window.crypto.subtle.exportKey('pkcs8', wc.privateKey),
    window.crypto.subtle.exportKey('spki', wc.publicKey),
  ])

  const toForgeBuf = ab => forge.util.createBuffer(new Uint8Array(ab))
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(toForgeBuf(privDer)))
  const publicKey = forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(toForgeBuf(pubDer)))

  return { privateKey, publicKey }
}

async function buildP12(name, email) {
  const { privateKey, publicKey } = await generateKeyPair()

  const cert = forge.pki.createCertificate()
  cert.publicKey = publicKey
  cert.serialNumber = Date.now().toString(16)
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)

  const attrs = [
    { name: 'commonName', value: name },
    { name: 'emailAddress', value: email || '' },
    { name: 'organizationName', value: 'BitzerPDF Self-Signed' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ])
  cert.sign(privateKey, forge.md.sha256.create())

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, cert, '__bitzerpdf__', {
    generateLocalKeyId: true,
    algorithm: '3des',
  })
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
  return Buffer.from(p12Der, 'binary')
}

export async function signPdfDocument(fileOrBytes, options) {
  const {
    signatureDataUrl,
    signerName,
    signerEmail = '',
    pageIndex = 0,
    // { x, y, width, height } all in PDF points; y=0 is bottom of page
    customPosition,
  } = options

  const raw = fileOrBytes instanceof File ? await fileOrBytes.arrayBuffer() : fileOrBytes

  const pdfDoc = await PDFDocument.load(raw)
  const pages = pdfDoc.getPages()
  const page = pages[Math.min(pageIndex, pages.length - 1)]
  const { width: pw, height: ph } = page.getSize()

  // Fall back to bottom-right if no position given
  const pos = customPosition ?? {
    x: pw - 236,
    y: 36,
    width: 200,
    height: 70,
  }

  if (signatureDataUrl) {
    const base64 = signatureDataUrl.split(',')[1]
    const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const img = await pdfDoc.embedPng(imgBytes)
    page.drawImage(img, { x: pos.x, y: pos.y, width: pos.width, height: pos.height })
  }

  const preparedBytes = await pdfDoc.save({ useObjectStreams: false })

  // pdflibAddPlaceholder mutates the doc in place and returns void — save it ourselves
  const signingDoc = await PDFDocument.load(preparedBytes)
  await pdflibAddPlaceholder({
    pdfDoc: signingDoc,
    reason: `Signed by ${signerName}`,
    contactInfo: signerEmail,
    name: signerName,
    location: 'BitzerPDF',
    signatureLength: 8192,
  })
  const pdfWithPlaceholder = Buffer.from(await signingDoc.save({ useObjectStreams: false }))

  const p12 = await buildP12(signerName, signerEmail)
  const signer = new P12Signer(p12, { passphrase: '__bitzerpdf__' })
  return signpdf.sign(pdfWithPlaceholder, signer)
}
