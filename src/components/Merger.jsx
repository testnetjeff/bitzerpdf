import { useState, useRef } from 'react'
import { mergePdfs } from '../lib/merge'
import { downloadBytes } from '../lib/download'

export default function Merger() {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const addFiles = (incoming) => {
    const pdfs = Array.from(incoming).filter(f => f.type === 'application/pdf')
    setFiles(prev => [...prev, ...pdfs])
  }

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const moveFile = (index, direction) => {
    setFiles(prev => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return next
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleDrop = (e) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }

  const handleMerge = async () => {
    if (files.length < 2) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await mergePdfs(files)
      downloadBytes(bytes, 'merged.pdf')
    } catch (e) {
      setError('Merge failed: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h2>Combine PDFs</h2>

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <p>Drop PDFs here or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={i} className="file-item">
              <span className="file-name">{f.name}</span>
              <div className="file-actions">
                <button onClick={() => moveFile(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} title="Move down">↓</button>
                <button onClick={() => removeFile(i)} className="remove-btn" title="Remove">×</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error-msg">{error}</p>}

      <button
        className="action-btn"
        onClick={handleMerge}
        disabled={files.length < 2 || busy}
      >
        {busy ? 'Merging…' : `Merge ${files.length} PDFs`}
      </button>
    </div>
  )
}
