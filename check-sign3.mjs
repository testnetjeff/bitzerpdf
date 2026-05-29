import { chromium } from 'playwright'
const T = 'C:/Users/jfarver/AppData/Local/Temp'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(e.message))
await page.goto('http://localhost:5173')
await page.waitForTimeout(1000)
await page.click('text=Sign')
await page.waitForTimeout(600)
await page.screenshot({ path: T + '/bpdf-sign-v3.png' })
console.log('errors:', JSON.stringify(errors))
await browser.close()
