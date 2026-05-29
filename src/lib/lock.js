import { PDFDocument } from '@cantoo/pdf-lib'

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

  doc.encrypt({
    userPassword: userPassword || undefined,
    ownerPassword: ownerPassword || (userPassword ? userPassword + '_owner' : 'owner'),
    permissions: {
      printing: allowPrint ? 'highResolution' : false,
      modifying: allowEdit,
      copying: allowCopy,
      annotating: allowEdit,
      fillingForms: allowEdit,
      contentAccessibility: true,
      documentAssembly: false,
    },
  })

  return doc.save()
}
