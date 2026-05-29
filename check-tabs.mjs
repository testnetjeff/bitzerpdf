import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:5173');
await page.waitForTimeout(2000);

await page.click('text=Combine');
await page.waitForTimeout(600);
await page.screenshot({ path: 'C:/Users/jfarver/AppData/Local/Temp/bpdf-combine.png' });

await page.click('text=Lock');
await page.waitForTimeout(600);
await page.screenshot({ path: 'C:/Users/jfarver/AppData/Local/Temp/bpdf-lock.png' });

console.log('Console errors:', JSON.stringify(errors));
await browser.close();
