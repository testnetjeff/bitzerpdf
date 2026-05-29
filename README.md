# BitzerPDF

A fast, privacy-first PDF toolkit that runs entirely in your browser. No uploads, no servers, no accounts — every operation happens locally on your machine.

## Why We're Building It

Most online PDF tools send your files to a remote server. That's fine for a recipe, but not for a contract, a medical record, or anything sensitive. BitzerPDF keeps your documents on your device at all times. It's also free and open source, so anyone can run their own copy.

## Features

| Tab | What it does |
|-----|-------------|
| **View** | Open and read any PDF. Drag-and-drop or browse to open. |
| **Combine** | Merge multiple PDFs into a single file in the order you choose. |
| **Extract** | Pull out specific pages (e.g. `1,3,5-8`) and save them as a new PDF. |
| **Sign** | Draw or type your signature, drag it anywhere on the page, resize it, then embed it with a real self-signed X.509 digital certificate. Adobe Reader shows a yellow validity badge on the signed file. |
| **Lock** | Password-protect a PDF and control what the recipient can do — print, copy text, or edit. |

## How It Works

- **View** — Renders PDFs with [PDF.js](https://mozilla.github.io/pdf.js/)
- **Combine / Extract / Lock** — Uses [pdf-lib](https://pdf-lib.js.org/) to manipulate pages and encryption in the browser
- **Sign** — Draws signatures with [signature_pad](https://github.com/szimek/signature_pad), generates a real RSA-2048 / SHA-256 key pair via the Web Crypto API, builds a self-signed X.509 cert with [node-forge](https://github.com/digitalbazaar/forge), and embeds a PKCS#12 digital signature with [@signpdf](https://github.com/vbuch/node-signpdf)

## Running It Locally

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node)

### Install & Start

```bash
git clone https://github.com/testnetjeff/bitzerpdf.git
cd bitzerpdf
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
```

The output lands in `dist/`. Serve it with any static host (Netlify, Vercel, GitHub Pages, nginx, etc.).

```bash
npm run preview   # preview the production build locally
```

## Project Structure

```
src/
  App.jsx              # Tab shell and top-level routing
  components/
    Viewer.jsx         # PDF viewer
    Merger.jsx         # Combine tool
    Extractor.jsx      # Page extractor
    Signer.jsx         # Signature tool (draw / type, drag to position)
    LockDialog.jsx     # Password & permissions dialog
  lib/
    sign.js            # PDF signing logic (crypto, P12, @signpdf)
    merge.js           # PDF merge logic
    extract.js         # Page extraction + range parser
    lock.js            # PDF encryption / permissions
    download.js        # Trigger browser download
```

## License

MIT
