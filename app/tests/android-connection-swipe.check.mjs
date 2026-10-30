// Real Chromium touch input against the exact Android asset; no backend or VPN.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || 'test-results/android-connection-swipe');
await mkdir(output, { recursive: true });
const script = await readFile(new URL('../android/app/src/main/assets/connection-swipe.js', import.meta.url), 'utf8');
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;min-height:2400px;background:#111;color:#eee;font:16px sans-serif}
#code{position:absolute;left:20px;top:70px;width:350px;height:70px;overflow-x:auto;user-select:none;background:#333}
#code>div{width:1400px;height:50px}input{position:absolute;left:20px;top:180px;width:330px;height:44px}
button{position:absolute;left:20px;top:250px;width:160px;height:44px}
#canvas{position:absolute;left:20px;top:310px;width:350px;height:44px;touch-action:none;background:#333}
#reading{position:absolute;top:380px;width:100%;height:1800px}#ignore{position:absolute;top:700px;width:100%;height:60px}
</style><div id="code"><div>Horizontal code / table / toolbar content</div></div>
<input value="A very long editable address or draft that must keep native text gestures">
<button onclick="window.clicks++">Action</button><div id="canvas">Custom canvas panning</div>
<div id="reading">Ordinary reading text for selection and scrolling.</div><div id="ignore" data-connection-swipe="ignore">Opt out</div>
<script>window.swipes=[];window.clicks=0;</script>`;
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
async function attach() {
  const handshake = 'axiom-connection-swipe:' + randomUUID();
  await page.evaluate(script.replace('__AXIOM_CONNECTION_SWIPE_HANDSHAKE__', handshake));
  await page.evaluate(handshake => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => window.swipes.push(event.data);
    (window.nativePorts ||= []).push(channel.port1);
    window.postMessage(handshake, location.origin, [channel.port2]);
  }, handshake);
  await page.waitForTimeout(40);
}
async function fresh() { await page.goto(url); await attach(); }
async function points(type, points) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 1]) => ({ x, y, id })) }); }
async function swipe(x = 300, y = 520, dx = -210, dy = 0, { cancel = false, hold = 0 } = {}) {
  await points('touchStart', [[x, y]]);
  if (hold) await page.waitForTimeout(hold);
  for (let step = 1; step <= 12; step++) { await points('touchMove', [[x + dx * step / 12, y + dy * step / 12]]); await page.waitForTimeout(12); }
  await points(cancel ? 'touchCancel' : 'touchEnd', []);
  await page.waitForTimeout(60);
}
const swipes = () => page.evaluate(() => window.swipes);
async function test(name, body) { await fresh(); await body(); passed.push(name); }
try {
  await test('bidirectional repeated wraparound and one switch per swipe', async () => {
    for (let i = 0; i < 6; i++) await swipe();
    for (let i = 0; i < 6; i++) await swipe(90, 520, 210);
    assert.deepEqual(await swipes(), [...Array(6).fill('next'), ...Array(6).fill('previous')]);
    let current = 0;
    const visited = (await swipes()).map(direction => current = (current + (direction === 'next' ? 1 : 2)) % 3);
    assert.deepEqual(visited, [1, 2, 0, 1, 2, 0, 2, 1, 0, 2, 1, 0]);
  });
  await test('page history does not consume a connection swipe', async () => {
    await page.evaluate(() => history.pushState(null, '', '/nested'));
    await swipe(); assert.deepEqual(await swipes(), ['next']); assert.equal(new URL(page.url()).pathname, '/nested');
  });
  await test('vertical reading scroll is preserved', async () => {
    await swipe(190, 600, 4, -220);
    assert.deepEqual(await swipes(), []); assert.ok(await page.evaluate(() => scrollY) > 50);
  });
  await test('horizontal scroll and its boundaries are preserved', async () => {
    await swipe(300, 100, -210); assert.deepEqual(await swipes(), []);
    assert.ok(await page.locator('#code').evaluate(element => element.scrollLeft) > 40);
    await page.locator('#code').evaluate(element => { element.scrollLeft = 0; });
    await swipe(90, 100, 210); assert.deepEqual(await swipes(), []);
  });
  await test('input drags and button taps are preserved', async () => {
    await swipe(300, 200, -210); assert.deepEqual(await swipes(), []);
    await page.touchscreen.tap(90, 270); assert.equal(await page.evaluate(() => window.clicks), 1);
    await swipe(160, 270, -100); assert.deepEqual(await swipes(), []);
  });
  await test('custom panners and explicit opt-out do not switch', async () => {
    await swipe(300, 330, -210); await swipe(300, 730, -210); assert.deepEqual(await swipes(), []);
  });
  await test('short and diagonal gestures do not switch', async () => {
    await swipe(300, 520, -40); await swipe(300, 520, -160, 150); assert.deepEqual(await swipes(), []);
  });
  await test('cancelled gesture does not leak into the next one', async () => {
    await swipe(300, 520, -210, 0, { cancel: true }); assert.deepEqual(await swipes(), []);
    await swipe(90, 520, 210); assert.deepEqual(await swipes(), ['previous']);
  });
  await test('multi-touch cancels the whole gesture', async () => {
    await points('touchStart', [[300, 520]]); await points('touchStart', [[300, 520], [320, 560, 2]]);
    await points('touchMove', [[100, 520], [120, 560, 2]]); await points('touchEnd', []);
    await page.waitForTimeout(60); assert.deepEqual(await swipes(), []);
  });
  await test('long press is not a connection swipe', async () => {
    await swipe(300, 600, -210, 0, { hold: 1300 }); assert.deepEqual(await swipes(), []);
  });
  await test('selection appearing after touchstart cancels the gesture', async () => {
    await points('touchStart', [[300, 520]]);
    await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('#reading')); getSelection().removeAllRanges(); getSelection().addRange(range); });
    await points('touchMove', [[90, 520]]); await points('touchEnd', []); await page.waitForTimeout(60);
    assert.deepEqual(await swipes(), []);
    await page.evaluate(() => getSelection().removeAllRanges()); await swipe(); assert.deepEqual(await swipes(), ['next']);
  });
  await test('untrusted synthetic touch cannot trigger native switching', async () => {
    await page.evaluate(() => {
      const target = document.querySelector('#reading');
      const touch = x => new Touch({ identifier: 1, target, clientX: x, clientY: 520 });
      target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(300)] }));
      target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(90)] }));
    });
    assert.deepEqual(await swipes(), []);
  });
  await test('sandbox preview cannot replace the native port', async () => {
    await page.evaluate(() => {
      const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'; frame.style.display = 'none';
      frame.srcdoc = `<script>const c=new MessageChannel();top.postMessage('axiom-connection-swipe','*',[c.port2]);<\/script>`;
      document.body.append(frame);
    });
    await page.waitForTimeout(100); await swipe(); assert.deepEqual(await swipes(), ['next']);
  });
  await test('reinjection closes the old handler without duplicate switching', async () => {
    await attach(); await attach(); await swipe(); assert.deepEqual(await swipes(), ['next']);
  });
  await test('blur clears a partial gesture', async () => {
    await points('touchStart', [[300, 520]]); await points('touchMove', [[260, 520]]);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await points('touchMove', [[90, 520]]); await points('touchEnd', []); await page.waitForTimeout(60);
    assert.deepEqual(await swipes(), []);
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'touch-fixture.png') });
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed, errors, scope: 'Real Chromium touch + transferred MessageChannel using production Android JS asset; not Android WebView, APK or Tailnet verification.' }, null, 2));
  console.log(`PASS: ${passed.length} Android connection swipe browser checks`);
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
