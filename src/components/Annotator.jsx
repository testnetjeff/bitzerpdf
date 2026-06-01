import { useState, useRef, useEffect, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'
import { bakeAnnotations } from '../lib/annotate'
import { downloadBytes } from '../lib/download'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const TOOLS = ['select', 'text', 'plaintext', 'underline', 'highlight', 'draw', 'sticky']
const TOOL_LABELS = {
  select:    '↖  Select',
  text:      'T   Text Box',
  plaintext: 'Plain Text',
  underline: '__  Form Line',
  highlight: '▭  Highlight',
  draw:      '✏  Freehand',
  sticky:    '☐  Sticky Note',
}
const PRESET_COLORS = ['#ffff00', '#ffcc00', '#ff9800', '#f44336', '#4caf50', '#2196f3', '#9c27b0', '#000000']

// ── Canvas rendering helpers ──────────────────────────────────────────────────

function drawHandles(ctx, x, y, w, h, annType) {
  if (annType === 'draw') return
  const pts = [
    [x + w, y + h],        // SE — resize both
    [x + w, y + h / 2],    // E  — resize width
  ]
  if (annType !== 'underline') pts.push([x + w / 2, y + h])  // S — resize height
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#4d9fff'
  ctx.lineWidth = 1.5
  for (const [hx, hy] of pts) {
    ctx.fillRect(hx - 5, hy - 5, 10, 10)
    ctx.strokeRect(hx - 5, hy - 5, 10, 10)
  }
}

function hitTestHandle(ann, nx, ny, cw, ch) {
  if (ann.type === 'draw') return null
  const w = ann.nw || 0
  const h = ann.nh || 0
  const THRESH = 9 / Math.min(cw, ch)
  const candidates = [
    ['se', ann.nx + w,       ann.ny + h],
    ['e',  ann.nx + w,       ann.ny + h / 2],
  ]
  if (ann.type !== 'underline') candidates.push(['s', ann.nx + w / 2, ann.ny + h])
  for (const [name, hx, hy] of candidates) {
    if (Math.abs(nx - hx) < THRESH && Math.abs(ny - hy) < THRESH) return name
  }
  return null
}

function renderAnnotations(ctx, anns, cw, ch, selectedId, imageCache) {
  ctx.clearRect(0, 0, cw, ch)
  for (const ann of anns) {
    const x = ann.nx * cw
    const y = ann.ny * ch
    const w = (ann.nw || 0) * cw
    const h = (ann.nh || 0) * ch
    ctx.save()

    if (ann.id === selectedId) {
      ctx.strokeStyle = '#4d9fff'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 2])
      ctx.strokeRect(x - 3, y - 3, w + 6, h + 6)
      ctx.setLineDash([])
      drawHandles(ctx, x, y, w, h, ann.type)
    }

    switch (ann.type) {
      case 'text':
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = ann.color || '#000'
        ctx.lineWidth = ann.strokeWidth || 1.5
        ctx.strokeRect(x, y, w, h)
        ctx.fillStyle = '#111'
        ctx.font = `${ann.fontSize || 14}px Arial`
        ctx.textBaseline = 'top'
        wrapText(ctx, ann.text || '', x + 4, y + 4, w - 8, (ann.fontSize || 14) * 1.35)
        break
      case 'highlight':
        ctx.globalAlpha = 0.4
        ctx.fillStyle = ann.color || '#ffff00'
        ctx.fillRect(x, y, w, h)
        ctx.globalAlpha = 1
        break
      case 'draw':
        if (!ann.paths || ann.paths.length < 2) break
        ctx.strokeStyle = ann.color || '#000'
        ctx.lineWidth = ann.lineWidth || 3
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ann.paths.forEach((pt, i) =>
          i === 0 ? ctx.moveTo(pt.nx * cw, pt.ny * ch) : ctx.lineTo(pt.nx * cw, pt.ny * ch)
        )
        ctx.stroke()
        break
      case 'image': {
        const img = imageCache?.get(ann.id)
        if (!img) { ctx.fillStyle='rgba(180,180,180,0.4)'; ctx.fillRect(x,y,w,h); break }
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
        ctx.font = `${ann.fontSize || 14}px Arial`
        ctx.textBaseline = 'top'
        ctx.fillText(ann.text, x, y + 2)
        break
      case 'underline':
        ctx.strokeStyle = ann.color || '#000'
        ctx.lineWidth = ann.strokeWidth || 1.5
        ctx.beginPath()
        ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h)
        ctx.stroke()
        if (ann.text) {
          ctx.fillStyle = '#111'
          ctx.font = `${ann.fontSize || 14}px Arial`
          ctx.textBaseline = 'bottom'
          ctx.fillText(ann.text, x + 2, y + h - 2, w - 4)
        }
        break
      case 'sticky':
        ctx.fillStyle = ann.color || '#fff176'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, w, h)
        ctx.fillStyle = 'rgba(0,0,0,0.12)'
        ctx.beginPath()
        ctx.moveTo(x + w - 14, y); ctx.lineTo(x + w, y + 14); ctx.lineTo(x + w, y)
        ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#333'
        ctx.font = '12px Arial'
        ctx.textBaseline = 'top'
        wrapText(ctx, ann.text || '(empty)', x + 5, y + 5, w - 10, 14.5)
        break
    }
    ctx.restore()
  }
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = (text || '').split(' ')
  let line = ''
  let dy = 0
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + dy)
      line = word; dy += lineH
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, y + dy)
}

function hitTest(ann, nx, ny, cw, ch) {
  if (ann.type === 'draw') {
    if (!ann.paths) return false
    const thresh = 12 / Math.min(cw, ch)
    return ann.paths.some(pt => Math.abs(pt.nx - nx) < thresh && Math.abs(pt.ny - ny) < thresh)
  }
  return nx >= ann.nx && nx <= ann.nx + (ann.nw || 0) &&
         ny >= ann.ny && ny <= ann.ny + (ann.nh || 0)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Annotator() {
  const [file, setFile] = useState(null)
  const [pdfJsDoc, setPdfJsDoc] = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1.2)
  const [annotations, setAnnotations] = useState({})
  const [tool, setTool] = useState('select')
  const [toolColors, setToolColors] = useState({
    text:      '#000000',
    plaintext: '#000000',
    underline: '#000000',
    highlight: '#ffff00',
    draw:      '#000000',
  })
  const color = toolColors[tool] ?? '#000000'
  const setColor = (c) => setToolColors(prev => ({ ...prev, [tool]: c }))
  const [fontSize, setFontSize] = useState(14)
  const [lineWidth, setLineWidth] = useState(3)
  const [selectedId, setSelectedId] = useState(null)
  const [strokeWidth, setStrokeWidth] = useState(1.5)
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [imageLoadVersion, setImageLoadVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const imageCacheRef = useRef(new Map())
  const pdfCanvasRef = useRef(null)
  const overlayRef = useRef(null)
  const textareaRef = useRef(null)
  const renderTaskRef = useRef(null)
  const drawStateRef = useRef(null)

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadFile = async (f) => {
    if (!f || f.type !== 'application/pdf') return
    setFile(f); setAnnotations({}); setPage(1)
    setSelectedId(null); setEditingId(null); setError(null)
    const bytes = await f.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    setPdfJsDoc(doc); setNumPages(doc.numPages)
  }

  // ── Render PDF page ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfJsDoc) return
    let cancelled = false
    renderTaskRef.current?.cancel()
    pdfJsDoc.getPage(page).then(pg => {
      if (cancelled) return
      const canvas = pdfCanvasRef.current
      if (!canvas) return
      const viewport = pg.getViewport({ scale: zoom })
      canvas.width = viewport.width
      canvas.height = viewport.height
      setCanvasSize({ w: viewport.width, h: viewport.height })
      const task = pg.render({ canvasContext: canvas.getContext('2d'), viewport })
      renderTaskRef.current = task
      task.promise.catch(() => {})
    })
    return () => { cancelled = true }
  }, [pdfJsDoc, page, zoom])

  // ── Scroll-to-zoom on overlay canvas ──────────────────────────────────────
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setZoom(z => Math.min(3, Math.max(0.5, +(z + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pdfJsDoc])

  // ── Render annotation overlay ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas || !canvasSize.w) return
    canvas.width = canvasSize.w
    canvas.height = canvasSize.h
    renderAnnotations(canvas.getContext('2d'), annotations[page] || [], canvasSize.w, canvasSize.h, selectedId, imageCacheRef.current)
  }, [annotations, page, canvasSize, selectedId, imageLoadVersion])

  // ── Keyboard: Delete selected annotation ───────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        setAnnotations(prev => ({ ...prev, [page]: (prev[page] || []).filter(a => a.id !== selectedId) }))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, editingId, page])

  // ── Focus textarea when editing starts ────────────────────────────────────
  useEffect(() => {
    if (editingId) {
      const t = setTimeout(() => textareaRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [editingId])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const addAnnotation = useCallback((ann) => {
    setAnnotations(prev => ({ ...prev, [page]: [...(prev[page] || []), ann] }))
  }, [page])

  const updateAnnotation = useCallback((id, updates) => {
    setAnnotations(prev => ({
      ...prev,
      [page]: (prev[page] || []).map(a => a.id === id ? { ...a, ...updates } : a)
    }))
  }, [page])

  const finalizeEditing = useCallback(() => {
    if (!editingId) return
    const ann = (annotations[page] || []).find(a => a.id === editingId)
    if (ann?.type === 'plaintext') {
      if (!editingText.trim()) {
        setAnnotations(prev => ({ ...prev, [page]: (prev[page] || []).filter(a => a.id !== editingId) }))
      } else {
        const tmp = document.createElement('canvas').getContext('2d')
        tmp.font = `${ann.fontSize || 14}px Arial`
        const nw = (tmp.measureText(editingText).width + 8) / canvasSize.w
        const nh = ((ann.fontSize || 14) * 1.4 + 6) / canvasSize.h
        updateAnnotation(editingId, { text: editingText, nw: Math.max(0.04, nw), nh })
      }
    } else {
      updateAnnotation(editingId, { text: editingText })
    }
    setEditingId(null)
  }, [editingId, editingText, annotations, page, canvasSize, updateAnnotation])

  const getNorm = (e) => {
    const canvas = overlayRef.current
    const rect = canvas.getBoundingClientRect()
    return { nx: (e.clientX - rect.left) / rect.width, ny: (e.clientY - rect.top) / rect.height }
  }

  // ── Mouse events on overlay ────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (editingId) { finalizeEditing(); return }
    const { nx, ny } = getNorm(e)

    if (tool === 'select') {
      const pageAnns = annotations[page] || []

      // Check handles / move on currently selected annotation first
      if (selectedId) {
        const selAnn = pageAnns.find(a => a.id === selectedId)
        if (selAnn) {
          const handle = hitTestHandle(selAnn, nx, ny, canvasSize.w, canvasSize.h)
          if (handle) {
            e.preventDefault()
            drawStateRef.current = {
              type: `resize-${handle}`, annId: selectedId,
              startNx: nx, startNy: ny,
              origNx: selAnn.nx, origNy: selAnn.ny,
              origNw: selAnn.nw || 0, origNh: selAnn.nh || 0,
              pageAnnsSnapshot: [...pageAnns],
            }
            return
          }
          if (hitTest(selAnn, nx, ny, canvasSize.w, canvasSize.h)) {
            e.preventDefault()
            drawStateRef.current = {
              type: 'move', annId: selectedId,
              startNx: nx, startNy: ny,
              origNx: selAnn.nx, origNy: selAnn.ny,
              origNw: selAnn.nw || 0, origNh: selAnn.nh || 0,
              pageAnnsSnapshot: [...pageAnns],
            }
            return
          }
        }
      }

      // Otherwise select whichever annotation was clicked
      for (let i = pageAnns.length - 1; i >= 0; i--) {
        if (hitTest(pageAnns[i], nx, ny, canvasSize.w, canvasSize.h)) {
          setSelectedId(pageAnns[i].id); return
        }
      }
      setSelectedId(null)
      return
    }

    if (tool === 'plaintext') {
      e.preventDefault()
      const id = crypto.randomUUID()
      const nh = Math.max(0.025, (fontSize * 1.4 + 6) / canvasSize.h)
      addAnnotation({ id, type: 'plaintext', nx: Math.min(nx, 0.95), ny: Math.min(ny, 1 - nh), nw: 0.4, nh, text: '', color, fontSize })
      setEditingId(id); setEditingText('')
      return
    }

    if (tool === 'text') {
      e.preventDefault()
      const id = crypto.randomUUID()
      const nh = Math.max(0.03, (fontSize * 1.45 + 10) / canvasSize.h)
      addAnnotation({ id, type: 'text', nx: Math.min(nx, 0.7), ny: Math.min(ny, 1 - nh), nw: 0.28, nh, text: '', color, fontSize, strokeWidth })
      setEditingId(id); setEditingText('')
      return
    }

    if (tool === 'underline') {
      e.preventDefault()
      const id = crypto.randomUUID()
      const nh = Math.max(0.025, (fontSize * 1.45 + 6) / canvasSize.h)
      addAnnotation({ id, type: 'underline', nx: Math.min(nx, 0.62), ny: Math.min(ny, 1 - nh), nw: 0.36, nh, text: '', color, fontSize, strokeWidth })
      setEditingId(id); setEditingText('')
      return
    }

    if (tool === 'sticky') {
      e.preventDefault()
      const id = crypto.randomUUID()
      addAnnotation({ id, type: 'sticky', nx: Math.min(nx, 0.78), ny: Math.min(ny, 0.82), nw: 0.2, nh: 0.18, text: '', color: '#fff176' })
      setEditingId(id); setEditingText('')
      return
    }

    if (tool === 'highlight') {
      drawStateRef.current = { type: 'highlight', startNx: nx, startNy: ny, nx, ny, nw: 0, nh: 0 }
    }

    if (tool === 'draw') {
      drawStateRef.current = { type: 'draw', id: crypto.randomUUID(), paths: [{ nx, ny }] }
    }
  }, [tool, color, fontSize, strokeWidth, annotations, page, canvasSize, editingId, selectedId, finalizeEditing, addAnnotation])

  const handleMouseMove = useCallback((e) => {
    const ds = drawStateRef.current
    if (!ds) return
    const { nx, ny } = getNorm(e)
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const { w: cw, h: ch } = canvasSize

    if (ds.type === 'move' || ds.type.startsWith('resize-')) {
      const dnx = nx - ds.startNx
      const dny = ny - ds.startNy
      const base = ds.pageAnnsSnapshot.find(a => a.id === ds.annId)
      let updated = { ...base }
      if (ds.type === 'move') {
        updated.nx = Math.max(0, Math.min(1 - ds.origNw, ds.origNx + dnx))
        updated.ny = Math.max(0, Math.min(1 - ds.origNh, ds.origNy + dny))
      } else if (ds.type === 'resize-se') {
        updated.nw = Math.max(0.05, ds.origNw + dnx)
        updated.nh = Math.max(0.02, ds.origNh + dny)
      } else if (ds.type === 'resize-e') {
        updated.nw = Math.max(0.05, ds.origNw + dnx)
      } else if (ds.type === 'resize-s') {
        updated.nh = Math.max(0.02, ds.origNh + dny)
      }
      ds.currentAnn = updated
      renderAnnotations(ctx, ds.pageAnnsSnapshot.map(a => a.id === ds.annId ? updated : a), cw, ch, ds.annId, imageCacheRef.current)
      return
    }

    if (ds.type === 'highlight') {
      ds.nx = Math.min(nx, ds.startNx); ds.ny = Math.min(ny, ds.startNy)
      ds.nw = Math.abs(nx - ds.startNx); ds.nh = Math.abs(ny - ds.startNy)
      renderAnnotations(ctx, annotations[page] || [], cw, ch, selectedId, imageCacheRef.current)
      ctx.globalAlpha = 0.35
      ctx.fillStyle = color
      ctx.fillRect(ds.nx * cw, ds.ny * ch, ds.nw * cw, ds.nh * ch)
      ctx.globalAlpha = 1
    }

    if (ds.type === 'draw') {
      const prev = ds.paths[ds.paths.length - 1]
      ds.paths.push({ nx, ny })
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(prev.nx * cw, prev.ny * ch)
      ctx.lineTo(nx * cw, ny * ch)
      ctx.stroke()
    }
  }, [annotations, page, canvasSize, color, lineWidth, selectedId])

  const handleMouseUp = useCallback((e) => {
    const ds = drawStateRef.current
    if (!ds) return

    if (ds.type === 'move' || ds.type.startsWith('resize-')) {
      drawStateRef.current = null
      if (ds.currentAnn) {
        updateAnnotation(ds.annId, {
          nx: ds.currentAnn.nx, ny: ds.currentAnn.ny,
          nw: ds.currentAnn.nw, nh: ds.currentAnn.nh,
        })
      }
      return
    }
    drawStateRef.current = null
    const { nx, ny } = getNorm(e)

    if (ds.type === 'highlight' && ds.nw > 0.01 && ds.nh > 0.005) {
      addAnnotation({ id: crypto.randomUUID(), type: 'highlight', nx: ds.nx, ny: ds.ny, nw: ds.nw, nh: ds.nh, color })
    }
    if (ds.type === 'draw' && ds.paths.length > 1) {
      addAnnotation({ id: ds.id, type: 'draw', nx: 0, ny: 0, nw: 1, nh: 1, paths: ds.paths, color, lineWidth })
    }
  }, [color, lineWidth, addAnnotation, updateAnnotation])

  // ── Double-click to re-edit text/underline/sticky ─────────────────────────
  const handleDoubleClick = useCallback((e) => {
    if (tool !== 'select') return
    const { nx, ny } = getNorm(e)
    const pageAnns = annotations[page] || []
    for (let i = pageAnns.length - 1; i >= 0; i--) {
      const ann = pageAnns[i]
      if (['text', 'underline', 'sticky'].includes(ann.type) &&
          hitTest(ann, nx, ny, canvasSize.w, canvasSize.h)) {
        e.preventDefault()
        setSelectedId(ann.id)
        setEditingId(ann.id)
        setEditingText(ann.text || '')
        return
      }
    }
  }, [tool, annotations, page, canvasSize])

  // ── Image insertion ─────────────────────────────────────────────────────────
  const handleImageFile = (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f || !file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const src = ev.target.result
      const img = new Image()
      img.onload = () => {
        const id = crypto.randomUUID()
        const aspect = img.naturalWidth / img.naturalHeight
        let nw = 0.45, nh = nw / aspect
        if (nh > 0.45) { nh = 0.45; nw = nh * aspect }
        const ann = {
          id, type: 'image',
          nx: Math.max(0, (1 - nw) / 2),
          ny: Math.max(0, (1 - nh) / 2),
          nw, nh, src, rotation: 0,
        }
        imageCacheRef.current.set(id, img)
        addAnnotation(ann)
        setSelectedId(id)
        setTool('select')
        setImageLoadVersion(v => v + 1)
      }
      img.src = src
    }
    reader.readAsDataURL(f)
  }

  const rotateSelectedImage = (delta) => {
    if (!selectedAnn || selectedAnn.type !== 'image') return
    updateAnnotation(selectedId, { rotation: ((selectedAnn.rotation || 0) + delta + 360) % 360 })
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const result = await bakeAnnotations(bytes, annotations)
      downloadBytes(result, file.name.replace(/\.pdf$/i, '') + '_annotated.pdf')
    } catch (e) {
      setError('Export failed: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const totalAnns = Object.values(annotations).reduce((s, a) => s + a.length, 0)
  const editingAnn = editingId ? (annotations[page] || []).find(a => a.id === editingId) : null
  const pageAnns = annotations[page] || []
  const selectedAnn = selectedId ? pageAnns.find(a => a.id === selectedId) : null

  const changePage = (newPage) => { finalizeEditing(); setPage(newPage); setSelectedId(null) }

  // ── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <div className="annotator-workspace">
      {/* ── Left: PDF + overlay ── */}
      <div className="annotator-pdf-col">
        {!file ? (
          <div
            className="signer-drop-full"
            onDrop={e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]) }}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            Drop a PDF here or click to browse
          </div>
        ) : (
          <>
            <div className="signer-page-bar">
              <button onClick={() => changePage(Math.max(1, page - 1))} disabled={page <= 1}>◀</button>
              <span>Page {page} of {numPages}</span>
              <button onClick={() => changePage(Math.min(numPages, page + 1))} disabled={page >= numPages}>▶</button>
              <div className="zoom-controls">
                <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.2).toFixed(1)))}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))}>+</button>
              </div>
              <button className="signer-change-btn secondary-btn" onClick={() => fileInputRef.current?.click()}>Change PDF</button>
            </div>
            <div className="signer-canvas-scroll">
              <div className="signer-canvas-area">
                <canvas ref={pdfCanvasRef} />
                <canvas
                  ref={overlayRef}
                  className="ann-overlay"
                  style={{
                    cursor: tool === 'select' ? 'default' : tool === 'text' || tool === 'sticky' ? 'crosshair' : 'crosshair',
                    pointerEvents: editingId ? 'none' : 'auto',
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onDoubleClick={handleDoubleClick}
                />
                {editingAnn?.type === 'plaintext' && (
                  <input
                    ref={textareaRef}
                    type="text"
                    className="ann-plain-editor"
                    style={{
                      left:     editingAnn.nx * canvasSize.w,
                      top:      editingAnn.ny * canvasSize.h,
                      height:   (editingAnn.fontSize || 14) * 1.4 + 6,
                      width:    Math.max(60, editingText.length * (editingAnn.fontSize || 14) * 0.62 + 24),
                      fontSize: editingAnn.fontSize || 14,
                      color:    editingAnn.color || '#000',
                    }}
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    onBlur={finalizeEditing}
                    onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') finalizeEditing() }}
                  />
                )}
                {editingAnn && editingAnn.type !== 'plaintext' && (
                  <textarea
                    ref={textareaRef}
                    className="ann-text-editor"
                    style={editingAnn.type === 'underline' ? {
                      left: editingAnn.nx * canvasSize.w,
                      top: editingAnn.ny * canvasSize.h,
                      width: editingAnn.nw * canvasSize.w,
                      height: editingAnn.nh * canvasSize.h,
                      fontSize: editingAnn.fontSize || 14,
                      background: 'transparent',
                      border: 'none',
                      borderBottom: `2px solid ${editingAnn.color || '#000'}`,
                      boxShadow: 'none',
                      padding: '0 3px 2px',
                    } : {
                      left: editingAnn.nx * canvasSize.w,
                      top: editingAnn.ny * canvasSize.h,
                      width: editingAnn.nw * canvasSize.w,
                      height: editingAnn.nh * canvasSize.h,
                      fontSize: editingAnn.type === 'sticky' ? 12 : (editingAnn.fontSize || 14),
                      background: editingAnn.type === 'sticky' ? (editingAnn.color || '#fff176') : '#fff',
                      borderColor: '#4d9fff',
                      boxShadow: '0 0 0 2px rgba(77,159,255,0.45)',
                    }}
                    placeholder={editingAnn.type === 'sticky' ? 'Type note…' : 'Type here…'}
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    onBlur={finalizeEditing}
                    onKeyDown={e => { if (e.key === 'Escape') finalizeEditing() }}
                  />
                )}
              </div>
            </div>
          </>
        )}
        <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => loadFile(e.target.files[0])} />
        <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageFile} />
      </div>

      {/* ── Right: Controls ── */}
      <div className="annotator-controls-col">
        <h2>Annotate</h2>

        <p className="options-label">Tool</p>
        <div className="ann-tools">
          {TOOLS.map(t => (
            <button key={t} className={`ann-tool-btn ${tool === t ? 'active' : ''}`} onClick={() => { setTool(t); setSelectedId(null) }}>
              {TOOL_LABELS[t]}
            </button>
          ))}
          <button
            className="ann-tool-btn"
            style={{ borderStyle: 'dashed', marginTop: 4 }}
            onClick={() => file && imageInputRef.current?.click()}
            disabled={!file}
          >
            + Insert Image
          </button>
        </div>

        {(tool === 'text' || tool === 'plaintext' || tool === 'underline' || tool === 'highlight' || tool === 'draw') && (
          <>
            <p className="options-label">Color</p>
            <div className="ann-colors">
              {PRESET_COLORS.map(c => (
                <button key={c} className={`ann-color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="ann-color-input" title="Custom color" />
            </div>
          </>
        )}

        {(tool === 'text' || tool === 'plaintext' || tool === 'underline') && (
          <>
            <p className="options-label">Font size — {fontSize}px</p>
            <input type="range" min="8" max="36" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="ann-range" />
          </>
        )}

        {(tool === 'text' || tool === 'underline') && (
          <>
            <p className="options-label">
              {tool === 'text' ? 'Border thickness' : 'Line thickness'} — {strokeWidth}px
            </p>
            <input type="range" min="0.5" max="8" step="0.5" value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} className="ann-range" />
          </>
        )}

        {tool === 'draw' && (
          <>
            <p className="options-label">Brush size — {lineWidth}px</p>
            <input type="range" min="1" max="20" value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} className="ann-range" />
          </>
        )}

        {tool === 'select' && selectedAnn && ['text', 'plaintext', 'underline'].includes(selectedAnn.type) && (
          <>
            <p className="options-label" style={{ color: 'var(--accent)' }}>
              Editing selected {selectedAnn.type === 'text' ? 'text box' : selectedAnn.type === 'plaintext' ? 'plain text' : 'form line'}
            </p>
            <p className="options-label">Font size — {selectedAnn.fontSize || 14}px</p>
            <input
              type="range" min="8" max="36"
              value={selectedAnn.fontSize || 14}
              onChange={e => updateAnnotation(selectedId, { fontSize: Number(e.target.value) })}
              className="ann-range"
            />
            {selectedAnn.type !== 'plaintext' && (
              <>
                <p className="options-label">
                  {selectedAnn.type === 'text' ? 'Border thickness' : 'Line thickness'} — {selectedAnn.strokeWidth || 1.5}px
                </p>
                <input
                  type="range" min="0.5" max="8" step="0.5"
                  value={selectedAnn.strokeWidth || 1.5}
                  onChange={e => updateAnnotation(selectedId, { strokeWidth: Number(e.target.value) })}
                  className="ann-range"
                />
              </>
            )}
          </>
        )}

        {tool === 'select' && selectedAnn?.type === 'image' && (
          <>
            <p className="options-label" style={{ color: 'var(--accent)' }}>Editing selected image</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="secondary-btn" style={{ flex: 1 }} onClick={() => rotateSelectedImage(-90)}>↺ Rotate left</button>
              <button className="secondary-btn" style={{ flex: 1 }} onClick={() => rotateSelectedImage(90)}>↻ Rotate right</button>
            </div>
          </>
        )}

        {tool === 'select' && selectedId && (
          <p className="status-msg">Press Delete to remove</p>
        )}

        <div className="ann-page-summary">
          <span className="options-label" style={{ marginBottom: 0 }}>Page {page}</span>
          <span>{pageAnns.length} annotation{pageAnns.length !== 1 ? 's' : ''}</span>
          {pageAnns.length > 0 && (
            <button className="secondary-btn" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => { setAnnotations(prev => ({ ...prev, [page]: [] })); setSelectedId(null) }}>
              Clear page
            </button>
          )}
        </div>

        {totalAnns > 0 && (
          <div className="sign-info">
            <strong>{totalAnns}</strong> annotation{totalAnns !== 1 ? 's' : ''} across{' '}
            {Object.values(annotations).filter(a => a?.length > 0).length} page{Object.values(annotations).filter(a => a?.length > 0).length !== 1 ? 's' : ''}
          </div>
        )}

        {error && <p className="error-msg">{error}</p>}

        <button className="action-btn" onClick={handleExport} disabled={!file || totalAnns === 0 || busy}>
          {busy ? 'Saving…' : 'Save Annotated PDF'}
        </button>
      </div>
    </div>
  )
}
