#!/usr/bin/env node
// Verify-loop screenshots for truckstopsante.com (bundled puppeteer, isolated temp profile — never touches Carlos's Chrome).
// Local router DNS may be stale, so map the domain to a GitHub Pages IP inside the browser.
'use strict';
const path = require('path');
const os = require('os');
let puppeteer;
try { puppeteer = require(path.join(process.env.USERPROFILE,'node_modules','puppeteer')); }
catch(e){ puppeteer = require('puppeteer'); }

async function revealAll(page){
  // Scroll through the page so IntersectionObserver reveals fire, then return to top.
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 700));
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir: path.join(os.tmpdir(), 'tss-pptr-profile'),
    args: ['--host-resolver-rules=MAP truckstopsante.com 185.199.108.153,MAP www.truckstopsante.com 185.199.108.153','--no-first-run','--autoplay-policy=no-user-gesture-required']
  });
  const out = path.join(process.env.USERPROFILE,'truckstopsante-site');
  const page = await browser.newPage();

  // Desktop
  await page.setViewport({ width: 1440, height: 900 });
  const resp = await page.goto('http://truckstopsante.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('desktop HTTP', resp.status());
  await new Promise(r => setTimeout(r, 2500)); // hero entrance + video first frames
  await page.screenshot({ path: path.join(out,'verify-desktop-hero.png') });
  const videoState = await page.evaluate(() => {
    const v = document.getElementById('heroVideo');
    return v ? { hasSource: !!v.querySelector('source'), playing: !v.paused, time: v.currentTime } : null;
  });
  console.log('video:', JSON.stringify(videoState));
  await revealAll(page);
  await page.screenshot({ path: path.join(out,'verify-desktop-full.png'), fullPage: true });

  // Mobile
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  const mobileVideo = await page.evaluate(() => {
    const v = document.getElementById('heroVideo');
    return v ? { hasSource: !!v.querySelector('source') } : null;
  });
  console.log('mobile video source (should be false):', JSON.stringify(mobileVideo));
  await revealAll(page);
  await page.screenshot({ path: path.join(out,'verify-mobile-full.png'), fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('mobile horizontal overflow px:', overflow);

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href')).filter(Boolean));
  const stripe = links.filter(h => h.includes('buy.stripe.com/7sY7sMa0Cgil5u84CjbMR0m')).length;
  const mailto = links.filter(h => h.startsWith('mailto:cff@centremedicalfont.ca')).length;
  const m28 = links.filter(h => h.includes('m28.ca')).length;
  console.log(`links: stripe=${stripe} mailto=${mailto} m28=${m28} total=${links.length}`);

  await browser.close();
  console.log('SCREENSHOTS DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
