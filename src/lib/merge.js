import { PDFDocument } from 'pdf-lib'

export async function mergePdfs(fileList) {
  const merged = await PDFDocument.create()

  for (const file of fileList) {
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    pages.forEach(page => merged.addPage(page))
  }

  return merged.save()
}
