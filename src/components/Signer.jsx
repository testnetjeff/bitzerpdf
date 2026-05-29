import { useState, useRef, useEffect, useCallback } from 'react'
import SignaturePad from 'signature_pad'
import { PDFDocument } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'
import { signPdfDocument } from '../lib/sign'
import { downloadBytes } from '../lib/download'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const DEFAULT_W = 200  // PDF points
const DEFAULT_H = 70
const MIN_W = 60
const MIN_H = 25

export default function Signer() {
  const [file, setFile] = useState(null)
  const [pdfJsDoc, setPdfJsDoc] = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [displayScale, setDisplayScale] = useState(1)
  const [pageNaturalH, setPageNaturalH] = useState(792)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })

  // Signature box state (PDF points)
  const [sigPos, setSigPos] = useState({ x: 0, y: 0 })       // top-left in display px
  const [sigSizePt, setSigSizePt] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [sigVisible, setSigVisible] = useState(true)
  const [isDragging, setIsDragging] = useState(false)

  const [mode, setMode] = useState('draw')
  const [typedSig, setTypedSig] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [sigPreview, setSigPreview] = useState(null)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(null)

  const fileInputRef = useRef(null)
  const pdfCanvasRef = useRef(null)
  const sigCanvasRef = useRef(null)
  const padRef = useRef(null)
  const pdfColRef = useRef(null)
  const renderTaskRef = useRef(null)

  // 'idle' | 'drag' | 'resize-se' | 'resize-sw' | 'resize-ne' | 'resize-nw' | 'resize-e' | 'resize-s'
  const interactionRef = useRef('idle')
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ clientX: 0, clientY: 0, posX: 0, posY: 0, w: 0, h: 0 })
  const scaleCacheRef = useRef(1)

  // ── Signature pad ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = sigCanvasRef.current
    if (!canvas) return

    // Match internal resolution to CSS display size so pointer coords align exactly
    const ratio = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d').scale(ratio, ratio)

    padRef.current = new SignaturePad(canvas, {
      backgroundColor: 'rgba(0,0,0,0)',
      penColor: '#1a237e',
      minWidth: 1.5,
      maxWidth: 3,
    })
    const onEnd = () => {
      if (!padRef.current.isEmpty()) setSigPreview(padRef.current.toDataURL('image/png'))
    }
    padRef.current.addEventListener('endStroke', onEnd)
    return () => { padRef.current.removeEventListener('endStroke', onEnd); padRef.current.off() }
  }, [])

  // ── Typed signature preview ────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'type') return
    const text = typedSig || signerName
    if (!text) { setSigPreview(null); return }
    const c = document.createElement('canvas')
    c.width = 400; c.height = 140
    const ctx = c.getContext('2d')
    ctx.font = 'italic 56px Georgia, serif'
    ctx.fillStyle = '#1a237e'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 200, 70)
    setSigPreview(c.toDataURL('image/png'))
  }, [mode, typedSig, signerName])

  // ── Load file ──────────────────────────────────────────────────────────────
  const loadFile = async (f) => {
    if (!f || f.type !== 'application/pdf') return
    setFile(f)
    setError(null)
    setSigVisible(true)
    setSigSizePt({ w: DEFAULT_W, h: DEFAULT_H })
    const bytes = await f.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    setPdfJsDoc(doc)
    setNumPages(doc.numPages)
    setPageIndex(0)
  }

  // ── Render page ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfJsDoc || !pdfCanvasRef.current || !pdfColRef.current) return

    const render = async () => {
      if (renderTaskRef.current) renderTaskRef.current.cancel()
      const page = await pdfJsDoc.getPage(pageIndex + 1)
      const natural = page.getViewport({ scale: 1 })

      const colW = pdfColRef.current.offsetWidth - 48
      const colH = pdfColRef.current.offsetHeight - 56
      const scale = Math.min(colW / natural.width, colH / natural.height, 2)

      const vp = page.getViewport({ scale })
      const canvas = pdfCanvasRef.current
      canvas.width = vp.width
      canvas.height = vp.height

      scaleCacheRef.current = scale
      setDisplayScale(scale)
      setPageNaturalH(natural.height)
      setCanvasSize({ w: vp.width, h: vp.height })

      // Place box at bottom-right by default
      setSigSizePt(prev => {
        setSigPos({
          x: vp.width - prev.w * scale - 20,
          y: vp.height - prev.h * scale - 20,
        })
        return prev
      })

      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
      renderTaskRef.current = task
      try { await task.promise }
      catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e) }
    }
    render()
  }, [pdfJsDoc, pageIndex])

  // ── Pointer event helpers ──────────────────────────────────────────────────
  const getClient = e => e.touches
    ? { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }
    : { clientX: e.clientX, clientY: e.clientY }

  const onBoxMouseDown = useCallback((e) => {
    if (e.target.closest('.sig-delete-btn') || e.target.closest('.sig-resize-handle')) return
    e.preventDefault()
    interactionRef.current = 'drag'
    setIsDragging(true)
    const { clientX, clientY } = getClient(e)
    dragOffsetRef.current = { x: clientX - sigPos.x, y: clientY - sigPos.y }
  }, [sigPos])

  const onResizeMouseDown = useCallback((e, corner) => {
    e.stopPropagation()
    e.preventDefault()
    interactionRef.current = corner
    setIsDragging(true)
    const { clientX, clientY } = getClient(e)
    resizeStartRef.current = {
      clientX,
      clientY,
      posX: sigPos.x,
      posY: sigPos.y,
      w: sigSizePt.w * scaleCacheRef.current,
      h: sigSizePt.h * scaleCacheRef.current,
    }
  }, [sigPos, sigSizePt])

  const onPointerMove = useCallback((e) => {
    const mode = interactionRef.current
    if (mode === 'idle') return

    const { clientX, clientY } = getClient(e)
    const scale = scaleCacheRef.current

    if (mode === 'drag') {
      setSigPos(prev => {
        const sigW = sigSizePt.w * scale
        const sigH = sigSizePt.h * scale
        return {
          x: Math.max(0, Math.min(clientX - dragOffsetRef.current.x, canvasSize.w - sigW)),
          y: Math.max(0, Math.min(clientY - dragOffsetRef.current.y, canvasSize.h - sigH)),
        }
      })
      return
    }

    // Resize
    const { clientX: sx, clientY: sy, posX, posY, w: sw, h: sh } = resizeStartRef.current
    const dx = clientX - sx
    const dy = clientY - sy

    setSigPos(prev => {
      let newX = prev.x, newY = prev.y
      let newWpx = sw, newHpx = sh

      if (mode === 'resize-se') { newWpx = sw + dx; newHpx = sh + dy }
      if (mode === 'resize-sw') { newWpx = sw - dx; newHpx = sh + dy; newX = posX + dx }
      if (mode === 'resize-ne') { newWpx = sw + dx; newHpx = sh - dy; newY = posY + dy }
      if (mode === 'resize-nw') { newWpx = sw - dx; newHpx = sh - dy; newX = posX + dx; newY = posY + dy }
      if (mode === 'resize-e')  { newWpx = sw + dx }
      if (mode === 'resize-s')  { newHpx = sh + dy }
      if (mode === 'resize-w')  { newWpx = sw - dx; newX = posX + dx }
      if (mode === 'resize-n')  { newHpx = sh - dy; newY = posY + dy }

      // Enforce minimum size in display pixels
      if (newWpx < MIN_W * scale) { newWpx = MIN_W * scale; if (mode.includes('w')) newX = prev.x }
      if (newHpx < MIN_H * scale) { newHpx = MIN_H * scale; if (mode.includes('n')) newY = prev.y }

      // Clamp to canvas bounds
      newX = Math.max(0, Math.min(newX, canvasSize.w - newWpx))
      newY = Math.max(0, Math.min(newY, canvasSize.h - newHpx))

      setSigSizePt({ w: newWpx / scale, h: newHpx / scale })
      return { x: newX, y: newY }
    })
  }, [sigSizePt, canvasSize])

  const onPointerUp = useCallback(() => {
    interactionRef.current = 'idle'
    setIsDragging(false)
  }, [])

  const handleDeleteBox = (e) => {
    e.stopPropagation()
    setSigVisible(false)
  }

  const handleRestoreBox = () => {
    const scale = scaleCacheRef.current
    setSigPos({
      x: canvasSize.w - sigSizePt.w * scale - 20,
      y: canvasSize.h - sigSizePt.h * scale - 20,
    })
    setSigVisible(true)
  }

  // ── Sign ───────────────────────────────────────────────────────────────────
  const handleSign = async () => {
    if (!file || !signerName.trim()) return
    const dataUrl = sigVisible
      ? (mode === 'draw'
          ? (padRef.current?.isEmpty() ? null : padRef.current.toDataURL('image/png'))
          : sigPreview)
      : null

    if (sigVisible && !dataUrl) {
      setError(mode === 'draw' ? 'Please draw your signature first.' : 'Please type your name.')
      return
    }

    setBusy(true); setError(null); setStatus('Generating certificate…')
    try {
      let customPosition = undefined
      if (sigVisible) {
        const pdfX = sigPos.x / displayScale
        const pdfY = pageNaturalH - (sigPos.y / displayScale) - sigSizePt.h
        customPosition = { x: pdfX, y: pdfY, width: sigSizePt.w, height: sigSizePt.h }
      }

      const signed = await signPdfDocument(file, {
        signatureDataUrl: dataUrl,
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
        pageIndex,
        customPosition,
      })

      setStatus('')
      downloadBytes(signed, file.name.replace(/\.pdf$/i, '') + '_signed.pdf')
    } catch (e) {
      setError('Signing failed: ' + e.message)
    } finally {
      setBusy(false); setStatus('')
    }
  }

  const sigDisplayW = sigSizePt.w * displayScale
  const sigDisplayH = sigSizePt.h * displayScale

  return (
    <div className="signer-workspace">

      {/* ── Left: PDF ── */}
      <div
        className="signer-pdf-col"
        ref={pdfColRef}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      >
        {!file ? (
          <div
            className="signer-drop-full"
            onClick={() => fileInputRef.current?.click()}
            onDrop={e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]) }}
            onDragOver={e => e.preventDefault()}
          >
            <p>Drop a PDF here or click to open</p>
          </div>
        ) : (
          <>
            <div className="signer-page-bar">
              <button onClick={() => setPageIndex(p => Math.max(0, p - 1))} disabled={pageIndex === 0}>‹</button>
              <span>Page {pageIndex + 1} / {numPages}</span>
              <button onClick={() => setPageIndex(p => Math.min(numPages - 1, p + 1))} disabled={pageIndex >= numPages - 1}>›</button>
              <button className="secondary-btn signer-change-btn" onClick={() => fileInputRef.current?.click()}>Change file</button>
            </div>

            <div className="signer-canvas-scroll">
              <div className="signer-canvas-area" style={{ userSelect: isDragging ? 'none' : 'auto' }}>
                <canvas ref={pdfCanvasRef} />

                {sigVisible && (
                  <div
                    className={`sig-drag-box${isDragging ? ' dragging' : ''}`}
                    style={{ left: sigPos.x, top: sigPos.y, width: sigDisplayW, height: sigDisplayH }}
                    onMouseDown={onBoxMouseDown}
                    onTouchStart={onBoxMouseDown}
                  >
                    {sigPreview
                      ? <img src={sigPreview} alt="signature preview" draggable={false} />
                      : <span className="sig-drag-hint">Your signature</span>
                    }

                    {/* Delete button */}
                    <button className="sig-delete-btn" onClick={handleDeleteBox} title="Remove signature box">✕</button>

                    {/* Resize handles — corners + edges */}
                    {[
                      ['resize-nw', 'nw'], ['resize-n', 'n'], ['resize-ne', 'ne'],
                      ['resize-w',  'w'],                     ['resize-e',  'e'],
                      ['resize-sw', 'sw'], ['resize-s', 's'], ['resize-se', 'se'],
                    ].map(([corner, pos]) => (
                      <div
                        key={corner}
                        className={`sig-resize-handle rh-${pos}`}
                        onMouseDown={e => onResizeMouseDown(e, corner)}
                        onTouchStart={e => onResizeMouseDown(e, corner)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        <input ref={fileInputRef} type="file" accept="application/pdf"
          style={{ display: 'none' }} onChange={e => loadFile(e.target.files[0])} />
      </div>

      {/* ── Right: Controls ── */}
      <div className="signer-controls-col">
        <h2>Sign PDF</h2>

        {!file && (
          <button className="action-btn" onClick={() => fileInputRef.current?.click()}>Open PDF</button>
        )}

        {file && !sigVisible && (
          <button className="secondary-btn" onClick={handleRestoreBox}>+ Place signature box</button>
        )}

        <div className="sig-mode-tabs">
          <button className={`sig-mode-btn ${mode === 'draw' ? 'active' : ''}`} onClick={() => setMode('draw')}>Draw</button>
          <button className={`sig-mode-btn ${mode === 'type' ? 'active' : ''}`} onClick={() => setMode('type')}>Type</button>
        </div>

        {mode === 'draw' ? (
          <div className="sig-canvas-wrapper">
            <canvas ref={sigCanvasRef} className="sig-canvas" />
            <button className="sig-clear-btn" onClick={() => { padRef.current?.clear(); setSigPreview(null) }}>Clear</button>
          </div>
        ) : (
          <div className="sig-type-wrapper">
            <input className="password-input" type="text" placeholder="Type your signature"
              value={typedSig} onChange={e => setTypedSig(e.target.value)} />
            {sigPreview && <img src={sigPreview} alt="" className="sig-type-img-preview" />}
          </div>
        )}

        <div className="signer-fields">
          <p className="options-label">Certificate identity</p>
          <input className="password-input" type="text" placeholder="Full name (required)"
            value={signerName} onChange={e => setSignerName(e.target.value)} />
          <input className="password-input" type="email" placeholder="Email (optional)"
            value={signerEmail} onChange={e => setSignerEmail(e.target.value)} />
        </div>

        <div className="sign-info">
          <p>Drag the box to position it. Drag the <strong>corner/edge handles</strong> to resize. Click <strong>✕</strong> to remove it. Produces a self-signed X.509 digital signature — Adobe Reader shows a <strong>yellow validity badge</strong>.</p>
        </div>

        {error && <p className="error-msg">{error}</p>}
        {status && <p className="status-msg">{status}</p>}

        <button className="action-btn" onClick={handleSign} disabled={!file || !signerName.trim() || busy}>
          {busy ? status || 'Signing…' : 'Sign & Download'}
        </button>
      </div>
    </div>
  )
}
