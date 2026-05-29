import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', m => errors.push({ type: m.type(), text: m.text() }))
page.on('pageerror', e => errors.push({ type: 'pageerror', text: e.message }))

await page.goto('http://localhost:5173')
await page.waitForTimeout(3000)  // wait for deps to prebundle

// Evaluate the sign module resolution directly in browser
const result = await page.evaluate(async () => {
  try {
    const mod = await import('/src/lib/sign.js')
    return { ok: true }
  } catch(e) {
    return { ok: false, error: e.message }
  }
})

console.log('module result:', JSON.stringify(result))
console.log('console messages:', JSON.stringify(errors.filter(e => e.type === 'error' || e.type === 'pageerror')))
await browser.close()
