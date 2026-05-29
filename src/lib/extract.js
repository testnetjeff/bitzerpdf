import { PDFDocument } from 'pdf-lib'

export async function extractPages(fileOrBytes, pageNumbers) {
  const bytes =
    fileOrBytes instanceof File ? await fileOrBytes.arrayBuffer() : fileOrBytes
  const src = await PDFDocument.load(bytes)
  const out = await PDFDocument.create()
  const total = src.getPageCount()
  const indices = pageNumbers
    .map(n => n - 1)
    .filter(i => i >= 0 && i < total)
  const copied = await out.copyPages(src, indices)
  copied.forEach(page => out.addPage(page))
  return out.save()
}

export function parsePageRange(str, maxPages) {
  const pages = new Set()
  for (const part of str.split(',').map(s => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(s => parseInt(s, 10))
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = a; i <= Math.min(b, maxPages); i++) {
          if (i >= 1) pages.add(i)
        }
      }
    } else {
      const n = parseInt(part, 10)
      if (!isNaN(n) && n >= 1 && n <= maxPages) pages.add(n)
    }
  }
  return Array.from(pages).sort((a, b) => a - b)
}
