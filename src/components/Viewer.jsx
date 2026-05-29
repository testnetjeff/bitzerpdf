import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

function Thumbnail({ pdfDoc, pageNum, isActive, onClick }) {
  const canvasRef = useRef(null)
  const itemRef = useRef(null)
  const rendered = useRef(false)

  useEffect(() => {
    if (!pdfDoc || rendered.current) return
    rendered.current = true
    pdfDoc.getPage(pageNum).then(page => {
      const canvas = canvasRef.current
      if (!canvas) return
      const viewport = page.getViewport({ scale: 0.2 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      page.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
  }, [pdfDoc, pageNum])

  // Scroll into view when this page becomes active
  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isActive])

  return (
    <div
      ref={itemRef}
      className={`sidebar-thumb ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title={`Page ${pageNum}`}
    >
      <canvas ref={canvasRef} />
      <span className="sidebar-page-num">{pageNum}</span>
    </div>
  )
}

export default function Viewer({ file }) {
  const canvasRef = useRef(null)
  const renderTaskRef = useRef(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1.2)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!file) return
    setError(null)
    setCurrentPage(1)
    setPdfDoc(null)

    const load = async () => {
      try {
        const bytes = await file.arrayBuffer()
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise
        setPdfDoc(doc)
        setNumPages(doc.numPages)
      } catch {
        setError('Failed to load PDF. It may be password-protected or corrupted.')
      }
    }
    load()
  }, [file])

  useEffect(() => {
    if (!pdfDoc) return

    const render = async () => {
      if (renderTaskRef.current) renderTaskRef.current.cancel()
      const page = await pdfDoc.getPage(currentPage)
      const viewport = page.getViewport({ scale: zoom })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') throw e
      }
    }
    render()
  }, [pdfDoc, currentPage, zoom])

  const goTo = useCallback(n => setCurrentPage(Math.max(1, Math.min(numPages, n))), [numPages])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setZoom(z => {
        const delta = e.deltaY < 0 ? 0.1 : -0.1
        return Math.min(3, Math.max(0.5, +(z + delta).toFixed(1)))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!file) return null

  return (
    <div className="viewer">
      <div className="viewer-toolbar">
        <button onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 1}>‹ Prev</button>
        <span>Page {currentPage} / {numPages}</span>
        <button onClick={() => goTo(currentPage + 1)} disabled={currentPage >= numPages}>Next ›</button>
        <div className="zoom-controls">
          <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.2).toFixed(1)))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.2).toFixed(1)))}>+</button>
        </div>
      </div>

      {error ? (
        <div className="viewer-error">{error}</div>
      ) : (
        <div className="viewer-body">
          <div className="thumbnail-sidebar">
            {pdfDoc && Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
              <Thumbnail
                key={n}
                pdfDoc={pdfDoc}
                pageNum={n}
                isActive={n === currentPage}
                onClick={() => goTo(n)}
              />
            ))}
          </div>
          <div className="canvas-container">
            <canvas ref={canvasRef} />
          </div>
        </div>
      )}
    </div>
  )
}
