import { useState, useRef } from 'react'
import Viewer from './components/Viewer'
import Merger from './components/Merger'
import LockDialog from './components/LockDialog'
import Extractor from './components/Extractor'
import Signer from './components/Signer'
import './App.css'
import bitzerLogo from './assets/BitzerPDF Logo mk2.png'
import bitzerMascot from './assets/Bitzer Gator PDF Mascot nobg.png'

const TABS = ['View', 'Combine', 'Extract', 'Sign', 'Lock']

export default function App() {
  const [tab, setTab] = useState('View')
  const [viewerFile, setViewerFile] = useState(null)
  const inputRef = useRef(null)

  const handleOpenFile = (e) => {
    const f = e.target.files[0]
    if (f) {
      setViewerFile(f)
      setTab('View')
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    if (tab !== 'View') return
    const f = e.dataTransfer.files[0]
    if (f?.type === 'application/pdf') setViewerFile(f)
  }

  return (
    <div
      className="app"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
    >
      <header className="app-header">
        <div className="header-left">
          <img src={bitzerLogo} alt="BitzerPDF" className="logo-img logo-btn" onClick={() => setTab('View')} />
          {tab === 'View' && (
            <button className="open-btn" onClick={() => inputRef.current?.click()}>
              Open PDF
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={handleOpenFile}
          />
        </div>
        <nav className="tabs">
          {TABS.map(t => (
            <button
              key={t}
              className={`tab-btn ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <div className="dev-banner">
        <span className="dev-banner-title">Under Development</span>
        <span className="dev-banner-sub">Expect visual bugs, errors, or other non-functional aspects</span>
      </div>
      <div className="version-badge">Beta 0.15</div>
      <main className="app-main">
        {tab === 'View' && (
          viewerFile ? (
            <Viewer file={viewerFile} />
          ) : (
            <div className="empty-state">
              <img src={bitzerMascot} alt="Bitzer mascot" className="mascot-img" />
              <p>Open a PDF to get started</p>
              <button className="action-btn" onClick={() => inputRef.current?.click()}>
                Browse files
              </button>
            </div>
          )
        )}
        {tab === 'Combine' && <Merger />}
        {tab === 'Extract' && <Extractor />}
        {tab === 'Sign' && <Signer />}
        {tab === 'Lock' && <LockDialog />}
      </main>
    </div>
  )
}
