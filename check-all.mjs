import { chromium } from 'playwright'

const T = 'C:/Users/jfarver/AppData/Local/Temp'
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(e.message))

await page.goto('http://localhost:5173')
await page.waitForTimeout(1500)

await page.click('text=Extract')
await page.waitForTimeout(500)
await page.screenshot({ path: `${T}/bpdf-extract.png` })

await page.click('text=Combine')
await page.waitForTimeout(300)
await page.screenshot({ path: `${T}/bpdf-combine2.png` })

console.log('errors:', JSON.stringify(errors))
await browser.close()
