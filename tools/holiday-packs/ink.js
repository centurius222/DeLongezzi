// Ink box of each control in the card (what shows on screen, glow ignored), in card-local CSS px:
// the card is shot with the control shown and hidden, and the difference is the control.
// usage: node ink.js <replica dir> <out dir> [chromium|firefox] [w h]   (then check_gaps.py)
const pw = require('playwright');
const SELS = {
  cap1: "[data-card='controls'] [data-part='stepper']:first-child > [data-part='caption']",
  dec1: "[aria-label='Decrease Temperature']", inc1: "[aria-label='Increase Temperature']",
  val1: "[data-card='controls'] [data-part='stepper']:first-child [data-part='stepper-value']",
  cap2: "[data-card='controls'] [data-part='stepper'] + [data-part='stepper'] > [data-part='caption']",
  dec2: "[aria-label='Decrease Stop at']", inc2: "[aria-label='Increase Stop at']",
  val2: "[data-part='stepper-toggle'] [data-part='stepper-value']",
  pill: "[data-part='stepper-pill']",
  range: "[data-card='controls'] input[type='range']",
  bar: "[data-card='controls'] [data-part='pressure-value']",
};
(async () => {
  const b = await pw[process.argv[4] || 'chromium'].launch();
  const p = await b.newPage({ viewport: { width: +process.argv[5] || 1517, height: +process.argv[6] || 712 } });
  await p.goto('file://' + process.argv[2] + '/index.html');
  await p.waitForTimeout(900);
  const card = await p.evaluate(() => { const r = document.querySelector("[data-card='controls']").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const clip = { x: card[0] - 12, y: card[1] - 12, width: card[2] + 24, height: card[3] + 24 };
  const out = { card };
  for (const [k, s] of Object.entries(SELS)) {
    const shown = await p.screenshot({ clip });
    await p.evaluate(s => { document.querySelector(s).style.visibility = 'hidden'; if (s.includes('stepper-value')) for (const c of document.querySelector(s).querySelectorAll('*')) c.style.visibility = 'hidden'; }, s);
    const hidden = await p.screenshot({ clip });
    await p.evaluate(s => { document.querySelector(s).style.visibility = ''; for (const c of document.querySelector(s).querySelectorAll('*')) c.style.visibility = ''; }, s);
    require('fs').writeFileSync(process.argv[3] + `/ink_${k}_a.png`, shown); require('fs').writeFileSync(process.argv[3] + `/ink_${k}_b.png`, hidden);
    out[k] = 1;
  }
  console.log(JSON.stringify(out));
  await b.close();
})();
