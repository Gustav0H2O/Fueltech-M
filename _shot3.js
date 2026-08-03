const p = require('puppeteer');
const OUT = process.argv[2];
(async () => {
  const b = await p.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGE: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));

  // favicon
  const fav = await pg.evaluate(() => {
    const l = document.querySelector('link[rel="icon"]');
    return l ? l.href : null;
  });
  console.log('favicon:', fav);

  // abrir herramientas
  await pg.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(b => b.textContent.includes('Herramientas'))?.click(); });
  await new Promise(r => setTimeout(r, 1000));
  await pg.screenshot({ path: `${OUT}/tools-diag.png` });
  console.log('tab diag, mark-icons:', await pg.evaluate(() => document.querySelectorAll('.mark-icon svg').length));

  // checklist
  await pg.evaluate(() => { const btns = [...document.querySelectorAll('.tool-tab')]; btns.find(b => b.textContent.includes('Checklist'))?.click(); });
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: `${OUT}/tools-check.png` });
  console.log('tab check, items:', await pg.evaluate(() => document.querySelectorAll('.tool-check-item').length));

  // comparador
  await pg.evaluate(() => { const btns = [...document.querySelectorAll('.tool-tab')]; btns.find(b => b.textContent.includes('Comparar'))?.click(); });
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: `${OUT}/tools-cmp.png` });
  console.log('tab cmp, options:', await pg.evaluate(() => document.querySelectorAll('.cmp-selects select option').length));

  // glosario
  await pg.evaluate(() => { const btns = [...document.querySelectorAll('.tool-tab')]; btns.find(b => b.textContent.includes('Glosario'))?.click(); });
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: `${OUT}/tools-gloss.png` });
  console.log('tab gloss, items:', await pg.evaluate(() => document.querySelectorAll('.tool-gloss-item').length));

  // trabajos
  await pg.evaluate(() => { const btns = [...document.querySelectorAll('.tool-tab')]; btns.find(b => b.textContent.includes('Trabajos'))?.click(); });
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: `${OUT}/tools-jobs.png` });
  console.log('tab jobs, vehicles:', await pg.evaluate(() => document.querySelectorAll('.tool-jobs ~ select, .tool-jobs').length));

  console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
  await b.close();
})();
