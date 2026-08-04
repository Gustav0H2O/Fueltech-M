const p = require('puppeteer');
const OUT = process.argv[2];
const NAME = { dtc: 'Buscador DTC', torque: 'Torques', spark: 'Bujías', cross: 'Cross', convert: 'Conversor', vin: 'VIN', pressure: 'Registro de Presión', regulator: 'Prueba de Regulador', orders: 'Órdenes', inventory: 'Inventario', clients: 'Clientes', notes: 'Notas', cash: 'Cierre de Caja', forum: 'Foro', connect: 'Conectar', market: 'Mercado', timing: 'Sincronización' };
(async () => {
  const b = await p.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGE: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  await pg.screenshot({ path: `${OUT}/home.png` });
  console.log('HOME cards:', await pg.evaluate(() => document.querySelectorAll('.micro-card').length));

  const tests = [
    ['dtc', '.dtc-item'], ['torque', '.mic-tbl tr'], ['spark', '.mic-tbl tr'],
    ['cross', '.cross-card'], ['convert', '.conv-mode'], ['vin', '.vin-card'],
    ['pressure', '.pres-form'], ['regulator', '.reg-q'], ['orders', '.order-list'],
    ['inventory', '.inv-form'], ['clients', '.cli-form'], ['notes', '.note-form'],
    ['cash', '.cash-totals'], ['forum', '.forum-new'], ['connect', '.conn-me'],
    ['market', '.market-grid'], ['timing', '.mic-tbl tr'],
  ];
  for (const [id, sel] of tests) {
    await pg.evaluate(({ id, label }) => {
      const card = [...document.querySelectorAll('.micro-card')].find(b => b.textContent.includes(label));
      if (card) card.click();
    }, { id, label: NAME[id] });
    await new Promise(r => setTimeout(r, 700));
    const found = await pg.evaluate((s) => document.querySelectorAll(s).length, sel);
    console.log('APP', id, 'found:', found);
    await pg.screenshot({ path: `${OUT}/app-${id}.png` });
    await pg.evaluate(() => { const b = document.querySelector('.micro-back'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('ERRORS:', errs.length ? errs.slice(0, 6) : 'none');
  await b.close();
})();
