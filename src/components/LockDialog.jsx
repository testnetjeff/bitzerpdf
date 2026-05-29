import { useState, useRef } from 'react'
import { lockPdf } from '../lib/lock'
import { downloadBytes } from '../lib/download'

export default function LockDialog() {
  const [file, setFile] = useState(null)
  const [userPassword, setUserPassword] = useState('')
  const [requirePassword, setRequirePassword] = useState(false)
  const [allowPrint, setAllowPrint] = useState(false)
  const [allowCopy, setAllowCopy] = useState(false)
  const [allowEdit, setAllowEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.type === 'application/pdf') setFile(f)
  }

  const handleLock = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await lockPdf(file, {
        userPassword: requirePassword ? userPassword : '',
        allowPrint,
        allowCopy,
        allowEdit,
      })
      const name = file.name.replace(/\.pdf$/i, '') + '_locked.pdf'
      downloadBytes(bytes, name)
    } catch (e) {
      setError('Lock failed: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h2>Lock PDF</h2>

      <div
        className="drop-zone"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        {file ? (
          <p className="file-selected">{file.name}</p>
        ) : (
          <p>Drop a PDF here or click to browse</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files[0] || null)}
        />
      </div>

      <div className="lock-options">
        <label className="option-row">
          <input
            type="checkbox"
            checked={requirePassword}
            onChange={e => setRequirePassword(e.target.checked)}
          />
          Require password to open
        </label>

        {requirePassword && (
          <input
            className="password-input"
            type="password"
            placeholder="Password"
            value={userPassword}
            onChange={e => setUserPassword(e.target.value)}
          />
        )}

        <p className="options-label">Allow recipients to:</p>

        <label className="option-row">
          <input
            type="checkbox"
            checked={allowPrint}
            onChange={e => setAllowPrint(e.target.checked)}
          />
          Print
        </label>
        <label className="option-row">
          <input
            type="checkbox"
            checked={allowCopy}
            onChange={e => setAllowCopy(e.target.checked)}
          />
          Copy text
        </label>
        <label className="option-row">
          <input
            type="checkbox"
            checked={allowEdit}
            onChange={e => setAllowEdit(e.target.checked)}
          />
          Edit / annotate
        </label>
      </div>

      {error && <p className="error-msg">{error}</p>}

      <button
        className="action-btn"
        onClick={handleLock}
        disabled={!file || busy || (requirePassword && !userPassword)}
      >
        {busy ? 'Locking…' : 'Lock & Download'}
      </button>
    </div>
  )
}
