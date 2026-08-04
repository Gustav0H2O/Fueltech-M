const p = require('puppeteer');
(async () => {
  const b = await p.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const pg = await b.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  await pg.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3500));
  const info = await pg.evaluate(() => {
    const home = document.querySelector('.home');
    const cs = home ? getComputedStyle(home) : null;
    return {
      homeBg: cs ? cs.backgroundImage.slice(0, 90) : 'no home',
      cards: document.querySelectorAll('.micro-card').length,
      headerText: (document.querySelector('.home-tagline') || {}).innerText || '',
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
