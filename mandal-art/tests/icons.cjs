const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 400 }, deviceScaleFactor: 2 });
  await p.goto('file:///home/claude/mandal-art/tests/icons.html'); await p.screenshot({ path: 'tests/shots/icons.png', fullPage: true }); await b.close(); })();
