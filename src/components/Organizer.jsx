import { useState, useRef, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'
import { organizePdf } from '../lib/organize'
import { downloadBytes } from '../lib/download'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

function OrgThumb({ pdfDoc, originalIdx, position, rotationDelta, onRotate, onDelete, onDragStart, onDragOver, onDrop, isDragOver }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    pdfDoc.getPage(originalIdx + 1).then(page => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const totalRot = ((page.rotate || 0) + rotationDelta) % 360
      const viewport = page.getViewport({ scale: 0.2, rotation: totalRot })
      canvas.width = viewport.width
      canvas.height = viewport.height
      page.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
    return () => { cancelled = true }
  }, [pdfDoc, originalIdx, rotationDelta])

  return (
    <div
      className={`org-thumb ${isDragOver ? 'org-drag-over' : ''}`}
      draggable
      onDragStart={() => onDragStart(position)}
      onDragOver={e => { e.preventDefault(); onDragOver(position) }}
      onDrop={e => { e.preventDefault(); onDrop(position) }}
      onDragEnd={() => onDragOver(null)}
    >
      <canvas ref={canvasRef} />
      <span className="thumb-num">p.{position + 1}</span>
      <div className="org-thumb-btns">
        <button title="Rotate left" onClick={() => onRotate(position, -90)}>↺</button>
        <button title="Rotate right" onClick={() => onRotate(position, 90)}>↻</button>
        <button title="Delete page" className="remove-btn" onClick={() => onDelete(position)}>✕</button>
      </div>
    </div>
  )
}

export default function Organizer() {
  const [file, setFile] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pageOrder, setPageOrder] = useState([])
  const [rotations, setRotations] = useState({})
  const [dragFrom, setDragFrom] = useState(null)
  const [dragOverPos, setDragOverPos] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const loadFile = async (f) => {
    if (!f || f.type !== 'application/pdf') return
    setError(null)
    setFile(f)
    const bytes = await f.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    setPdfDoc(doc)
    setPageOrder(Array.from({ length: doc.numPages }, (_, i) => i))
    setRotations({})
  }

  const handleRotate = (pos, delta) => {
    const origIdx = pageOrder[pos]
    setRotations(prev => ({ ...prev, [origIdx]: ((prev[origIdx] || 0) + delta + 360) % 360 }))
  }

  const handleDelete = (pos) => {
    setPageOrder(prev => prev.filter((_, i) => i !== pos))
  }

  const handleDrop = (toPos) => {
    if (dragFrom === null || dragFrom === toPos) { setDragFrom(null); setDragOverPos(null); return }
    setPageOrder(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragFrom, 1)
      next.splice(toPos, 0, moved)
      return next
    })
    setDragFrom(null)
    setDragOverPos(null)
  }

  const handleExport = async () => {
    if (!file || pageOrder.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await file.arrayBuffer()
      const result = await organizePdf(bytes, pageOrder, rotations)
      downloadBytes(result, file.name.replace(/\.pdf$/i, '') + '_organized.pdf')
    } catch (e) {
      setError('Export failed: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel organizer-panel">
      <h2>Organize Pages</h2>
      <div
        className="drop-zone"
        onDrop={e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]) }}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        {file
          ? <p className="file-selected">{file.name} — {pageOrder.length} pages</p>
          : <p>Drop a PDF here or click to browse</p>}
        <input ref={inputRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => loadFile(e.target.files[0])} />
      </div>

      {pageOrder.length > 0 && (
        <p className="options-label">Drag to reorder · Use buttons to rotate or delete pages</p>
      )}

      {pageOrder.length > 0 && (
        <div className="org-grid">
          {pageOrder.map((origIdx, pos) => (
            <OrgThumb
              key={origIdx + ':' + pos}
              pdfDoc={pdfDoc}
              originalIdx={origIdx}
              position={pos}
              rotationDelta={rotations[origIdx] || 0}
              onRotate={handleRotate}
              onDelete={handleDelete}
              onDragStart={p => setDragFrom(p)}
              onDragOver={p => setDragOverPos(p)}
              onDrop={handleDrop}
              isDragOver={dragOverPos === pos}
            />
          ))}
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}
      <button
        className="action-btn"
        onClick={handleExport}
        disabled={!file || pageOrder.length === 0 || busy}
      >
        {busy ? 'Saving…' : `Save PDF (${pageOrder.length} page${pageOrder.length !== 1 ? 's' : ''})`}
      </button>
    </div>
  )
}
