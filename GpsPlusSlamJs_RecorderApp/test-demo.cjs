const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log(msg.type(), msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err));
  try {
    await page.goto('http://localhost:5173/aiming-ray-capture-demo.html');
    await page.click('button:has-text("Shoot Center Crosshair")');
  } catch (e) {
    console.log("Exception:", e);
  }
  await browser.close();
})();
