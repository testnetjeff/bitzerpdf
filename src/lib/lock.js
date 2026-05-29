import { PDFDocument } from 'pdf-lib'

// permissions flags per PDF spec
const PERMISSIONS = {
  print: 4,
  modify: 8,
  copy: 16,
  annotate: 32,
}

export async function lockPdf(fileOrBytes, options = {}) {
  const {
    userPassword = '',
    ownerPassword,
    allowPrint = false,
    allowCopy = false,
    allowEdit = false,
  } = options

  const bytes =
    fileOrBytes instanceof File ? await fileOrBytes.arrayBuffer() : fileOrBytes

  const doc = await PDFDocument.load(bytes)

  let permissions = 0
  if (allowPrint) permissions |= PERMISSIONS.print
  if (allowEdit) permissions |= PERMISSIONS.modify | PERMISSIONS.annotate
  if (allowCopy) permissions |= PERMISSIONS.copy

  const saved = await doc.save({
    userPassword,
    ownerPassword: ownerPassword || userPassword + '_owner',
    permissions: {
      printing: allowPrint ? 'highResolution' : 'none',
      modifying: allowEdit,
      copying: allowCopy,
      annotating: allowEdit,
      fillingForms: allowEdit,
      contentAccessibility: true,
      documentAssembly: false,
    },
  })

  return saved
}
