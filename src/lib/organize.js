import { PDFDocument, degrees } from 'pdf-lib'

export async function organizePdf(fileBytes, pageOrder, rotations) {
  const srcDoc = await PDFDocument.load(fileBytes)
  const newDoc = await PDFDocument.create()

  for (const originalIdx of pageOrder) {
    const [page] = await newDoc.copyPages(srcDoc, [originalIdx])
    const delta = rotations[originalIdx] || 0
    if (delta !== 0) {
      const existing = page.getRotation().angle
      page.setRotation(degrees((existing + delta) % 360))
    }
    newDoc.addPage(page)
  }

  return newDoc.save()
}
