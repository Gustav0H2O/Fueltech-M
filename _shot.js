const p = require('puppeteer');
const OUT = process.argv[2];
(async () => {
  const b = await p.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', args:['--no-sandbox'] });
  // sistema OSCURO, pero el usuario fuerza CLARO -> comprueba que manda data-theme
  const cases = [
    ['t-auto-dark', 'dark', null],
    ['t-forced-light', 'dark', 'light'],
    ['t-forced-dark', 'light', 'dark'],
  ];
  for (const [name, sys, pref] of cases) {
    const pg = await b.newPage();
    await pg.emulateMediaFeatures([{name:'prefers-color-scheme', value: sys}]);
    await pg.setViewport({width:1440, height:900});
    const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    pg.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
    if (pref) await pg.evaluateOnNewDocument((v)=>localStorage.setItem('ft_theme', v), pref);
    await pg.goto('http://localhost:3311/', {waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,2500));
    const st = await pg.evaluate(()=>({
      attr: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      danger: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
      card: getComputedStyle(document.documentElement).getPropertyValue('--card').trim(),
    }));
    await pg.screenshot({path:`${OUT}/${name}.png`});
    console.log(name, JSON.stringify(st), errs.length?errs.slice(0,3):'no errors');
    await pg.close();
  }
  await b.close();
})();
