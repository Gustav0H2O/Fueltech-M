const p = require('puppeteer');
const OUT = process.argv[2];
(async () => {
  const b = await p.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', args:['--no-sandbox'] });
  const shots = [
    ['home-dark', 'dark', null, async (pg) => {}],
    ['home-light', 'light', null, async (pg) => {}],
    ['chat-dark', 'dark', null, async (pg) => { await pg.click('.chat-fab'); }],
    ['calc-dark', 'dark', null, async (pg) => { await pg.evaluate(() => { const btns = [...document.querySelectorAll('button')]; btns.find(b => b.textContent.includes('Calculadoras'))?.click(); }); }],
    ['admin-dark', 'dark', null, async (pg) => { await pg.goto('http://localhost:3000/admin', { waitUntil: 'networkidle2' }); }],
  ];
  for (const [name, sys, pref, act] of shots) {
    const pg = await b.newPage();
    await pg.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: sys }]);
    await pg.setViewport({ width: 1440, height: 900 });
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    if (pref) await pg.evaluateOnNewDocument(v => localStorage.setItem('ft_theme', v), pref);
    await pg.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2500));
    try { await act(pg); } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
    await pg.screenshot({ path: `${OUT}/${name}.png` });
    // comprobar iconos de marca presentes
    const marks = await pg.evaluate(() => document.querySelectorAll('.mark-icon svg').length);
    console.log(name, 'mark-icons:', marks, 'errors:', errs.length ? errs.slice(0, 3) : 'none');
    await pg.close();
  }
  await b.close();
})();
