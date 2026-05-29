import { useState, useRef, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'
import { extractPages, parsePageRange } from '../lib/extract'
import { downloadBytes } from '../lib/download'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

function Thumbnail({ pdfDoc, pageNum, isActive, onClick }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    pdfDoc.getPage(pageNum).then(page => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const viewport = page.getViewport({ scale: 0.22 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      page.render({ canvasContext: canvas.getContext('2d'), viewport })
    })
    return () => { cancelled = true }
  }, [pdfDoc, pageNum])

  return (
    <div
      className={`ext-thumb ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title={`Page ${pageNum}`}
    >
      <canvas ref={canvasRef} />
      <span className="thumb-num">{pageNum}</span>
      {isActive && <div className="thumb-check">✓</div>}
    </div>
  )
}

export default function Extractor() {
  const [file, setFile] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [rangeInput, setRangeInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const loadFile = async (f) => {
    if (!f || f.type !== 'application/pdf') return
    setFile(f)
    setSelected(new Set())
    setRangeInput('')
    setError(null)
    const bytes = await f.arrayBuffer()
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    setPdfDoc(doc)
    setNumPages(doc.numPages)
  }

  const togglePage = (n) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(n) ? next.delete(n) : next.add(n)
      return next
    })
  }

  const applyRange = () => {
    const pages = parsePageRange(rangeInput, numPages)
    setSelected(new Set(pages))
  }

  const selectAll = () => setSelected(new Set(Array.from({ length: numPages }, (_, i) => i + 1)))
  const clearAll = () => setSelected(new Set())

  const handleExtract = async () => {
    if (!file || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const pages = Array.from(selected).sort((a, b) => a - b)
      const bytes = await extractPages(file, pages)
      const name = file.name.replace(/\.pdf$/i, '') + `_pages_${pages.join('-')}.pdf`
      downloadBytes(bytes, name)
    } catch (e) {
      setError('Extract failed: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel extractor-panel">
      <h2>Extract Pages</h2>

      <div
        className="drop-zone"
        onDrop={e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]) }}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        {file ? (
          <p className="file-selected">{file.name} — {numPages} pages</p>
        ) : (
          <p>Drop a PDF here or click to browse</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={e => loadFile(e.target.files[0])}
        />
      </div>

      {numPages > 0 && (
        <>
          <div className="ext-controls">
            <div className="range-row">
              <input
                className="password-input range-input"
                type="text"
                placeholder='e.g. 1-3, 5, 7-9'
                value={rangeInput}
                onChange={e => setRangeInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyRange()}
              />
              <button className="secondary-btn" onClick={applyRange}>Apply</button>
            </div>
            <div className="sel-row">
              <button className="secondary-btn" onClick={selectAll}>All</button>
              <button className="secondary-btn" onClick={clearAll}>None</button>
              <span className="sel-count">
                {selected.size} of {numPages} selected
              </span>
            </div>
          </div>

          <div className="thumb-grid">
            {Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
              <Thumbnail
                key={n}
                pdfDoc={pdfDoc}
                pageNum={n}
                isActive={selected.has(n)}
                onClick={() => togglePage(n)}
              />
            ))}
          </div>
        </>
      )}

      {error && <p className="error-msg">{error}</p>}

      <button
        className="action-btn"
        onClick={handleExtract}
        disabled={!file || selected.size === 0 || busy}
      >
        {busy ? 'Extracting…' : `Extract ${selected.size} page${selected.size !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}
