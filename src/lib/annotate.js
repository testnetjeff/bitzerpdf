import { PDFDocument } from 'pdf-lib'

// annotationsByPage: { [pageNum: string]: Annotation[] }
// Annotation coords (nx, ny, nw, nh) are normalized 0-1, top-left origin
export async function bakeAnnotations(fileBytes, annotationsByPage) {
  const pdfDoc = await PDFDocument.load(fileBytes)
  const pages = pdfDoc.getPages()

  // Pre-load all placed images
  const imageMap = new Map()
  const allAnns = Object.values(annotationsByPage).flat()
  await Promise.all(
    allAnns.filter(a => a.type === 'image' && a.src).map(ann =>
      new Promise(resolve => {
        const img = new Image()
        img.onload = () => { imageMap.set(ann.id, img); resolve() }
        img.onerror = resolve
        img.src = ann.src
      })
    )
  )

  for (const [pageNum, anns] of Object.entries(annotationsByPage)) {
    if (!anns || anns.length === 0) continue
    const page = pages[Number(pageNum) - 1]
    if (!page) continue
    const { width: pdfW, height: pdfH } = page.getSize()

    const SCALE = 2
    const canvas = document.createElement('canvas')
    canvas.width = pdfW * SCALE
    canvas.height = pdfH * SCALE
    const ctx = canvas.getContext('2d')

    for (const ann of anns) renderAnnotation(ctx, ann, canvas.width, canvas.height, SCALE, imageMap)

    const dataUrl = canvas.toDataURL('image/png')
    const binary = atob(dataUrl.split(',')[1])
    const pngBytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) pngBytes[i] = binary.charCodeAt(i)

    const img = await pdfDoc.embedPng(pngBytes)
    page.drawImage(img, { x: 0, y: 0, width: pdfW, height: pdfH })
  }

  return pdfDoc.save()
}

function renderAnnotation(ctx, ann, cw, ch, scale, imageMap) {
  const x = ann.nx * cw
  const y = ann.ny * ch
  const w = (ann.nw || 0) * cw
  const h = (ann.nh || 0) * ch

  ctx.save()
  switch (ann.type) {
    case 'text':
      ctx.fillStyle = 'rgba(255,255,255,0.88)'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = ann.color || '#000'
      ctx.lineWidth = (ann.strokeWidth || 1.5) * scale
      ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = '#111'
      ctx.font = `${(ann.fontSize || 14) * scale}px Arial`
      ctx.textBaseline = 'top'
      wrapText(ctx, ann.text || '', x + 4 * scale, y + 4 * scale, w - 8 * scale, (ann.fontSize || 14) * scale * 1.35)
      break
    case 'highlight':
      ctx.globalAlpha = 0.4
      ctx.fillStyle = ann.color || '#ffff00'
      ctx.fillRect(x, y, w, h)
      break
    case 'draw':
      if (!ann.paths || ann.paths.length < 2) break
      ctx.strokeStyle = ann.color || '#000'
      ctx.lineWidth = (ann.lineWidth || 3) * scale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ann.paths.forEach((pt, i) =>
        i === 0 ? ctx.moveTo(pt.nx * cw, pt.ny * ch) : ctx.lineTo(pt.nx * cw, pt.ny * ch)
      )
      ctx.stroke()
      break
    case 'image': {
      const img = imageMap?.get(ann.id)
      if (!img) break
      ctx.save()
      ctx.translate(x + w / 2, y + h / 2)
      ctx.rotate(((ann.rotation || 0) * Math.PI) / 180)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
      ctx.restore()
      break
    }
    case 'plaintext':
      if (!ann.text) break
      ctx.fillStyle = ann.color || '#000'
      ctx.font = `${(ann.fontSize || 14) * scale}px Arial`
      ctx.textBaseline = 'top'
      ctx.fillText(ann.text, x, y + 2 * scale)
      break
    case 'underline':
      ctx.strokeStyle = ann.color || '#000'
      ctx.lineWidth = (ann.strokeWidth || 1.5) * scale
      ctx.beginPath()
      ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h)
      ctx.stroke()
      if (ann.text) {
        ctx.fillStyle = '#111'
        ctx.font = `${(ann.fontSize || 14) * scale}px Arial`
        ctx.textBaseline = 'bottom'
        ctx.fillText(ann.text, x + 2 * scale, y + h - 2 * scale, w - 4 * scale)
      }
      break
    case 'sticky':
      ctx.fillStyle = ann.color || '#fff176'
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'
      ctx.lineWidth = scale
      ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.beginPath()
      ctx.moveTo(x + w - 14 * scale, y)
      ctx.lineTo(x + w, y + 14 * scale)
      ctx.lineTo(x + w, y)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#333'
      ctx.font = `${12 * scale}px Arial`
      ctx.textBaseline = 'top'
      wrapText(ctx, ann.text || '', x + 5 * scale, y + 5 * scale, w - 10 * scale, 15 * scale)
      break
  }
  ctx.restore()
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = (text || '').split(' ')
  let line = ''
  let dy = 0
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + dy)
      line = word
      dy += lineH
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, y + dy)
}
