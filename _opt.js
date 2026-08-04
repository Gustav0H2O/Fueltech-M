const p = require('puppeteer');
const fs = require('fs');
const path = require('path');
(async () => {
  const b = await p.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const pg = await b.newPage();
  // Cargar la imagen como data URL en un HTML limpio: evita el tema del navegador
  const png = fs.readFileSync('public/brand/bg-dashboard.png').toString('base64');
  await pg.setContent(`<html><body style="margin:0"><img id="i" src="data:image/png;base64,${png}"></body></html>`);
  await new Promise(r => setTimeout(r, 1500));
  const img = await pg.$('#i');
  const box = await img.boundingBox();
  console.log('img box:', box);
  // escalar al ancho objetivo y capturar la imagen
  const target = 1920;
  await pg.setViewport({ width: target, height: Math.round(target * (box.height / box.width)) });
  await new Promise(r => setTimeout(r, 500));
  const data = await img.screenshot({ type: 'jpeg', quality: 70 });
  fs.writeFileSync('public/brand/bg-dashboard.jpg', data);
  console.log('JPEG', data.length, 'bytes');
  await b.close();
})();
