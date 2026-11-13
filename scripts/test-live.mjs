import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

async function findBrowser() {
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'chrome'];
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = resolve(directory, name + suffix);
      if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
    }
  }
  throw new Error('Chrome or Chromium was not found on PATH. Set CHROMIUM_PATH to the browser executable.');
}

const args = process.argv.slice(2);
const dark = args.includes('--dark');
const chromePath = args.find(arg => !arg.startsWith('-')) || process.env.CHROMIUM_PATH || await findBrowser();
const scriptName = dark ? 'stacks-hover-preview-dark.user.js' : 'stacks-hover-preview.user.js';
const script = await readFile(new URL('../userscripts/' + scriptName, import.meta.url), 'utf8');
const tempRoot = await realpath(tmpdir());
const profile = await realpath(await mkdtemp(join(tempRoot, 'stacks-hover-test-')));
assert.equal(dirname(profile), tempRoot);
assert(basename(profile).startsWith('stacks-hover-test-'));
const chrome = spawn(chromePath, [
  '--headless', '--remote-debugging-port=0', '--no-first-run',
  '--disable-background-networking', '--window-size=1280,1000',
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', windowsHide: true });
const exited = once(chrome, 'exit');
exited.catch(() => {});

async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(80);
  }
  assert.fail('Timed out waiting for ' + label);
}

let socket;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  const port = await until(async () => {
    const content = await readFile(portFile, 'utf8').catch(() => '');
    return content.split(/\r?\n/)[0];
  }, 'Chromium debugging port');
  const targets = await fetch('http://127.0.0.1:' + port + '/json/list').then(res => res.json());
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  const replies = new Map();
  let id = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    replies.get(message.id)?.(message);
    replies.delete(message.id);
  });
  function send(method, params = {}) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      replies.set(requestId, ({ result, error }) => error ? reject(error) : resolve(result));
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const page = 'https://stacks.math.columbia.edu/tag/0B3I';
  if (dark) {
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: script + `
      const themeObserver = new MutationObserver(() => {
        if (!document.getElementById('stacks-hover-theme')) return;
        window.darkThemeAppliedAt = performance.now();
        themeObserver.disconnect();
      });
      themeObserver.observe(document, { childList: true, subtree: true });
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'interactive') return;
        window.themeBeforeReady = {
          background: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
          toolbar: getComputedStyle(document.querySelector('#first-bar')).backgroundColor,
          cardMounted: !!document.querySelector('#stacks-hover-card')
        };
      });
    ` });
  }
  await send('Page.navigate', { url: page });
  await until(() => evaluate(`location.href === '${page}' && !!document.querySelector('.env-proof')`), 'live proof page');
  await until(() => evaluate('!!document.querySelector(".env-proof .MathJax")'), 'initial page MathJax');
  await evaluate('new Promise(resolve => MathJax.Hub.Queue(() => { resolve(true); }))');
  await evaluate('document.fonts.ready.then(() => true)');
  if (dark) {
    assert.deepEqual(await until(() => evaluate('window.themeBeforeReady'), 'dark theme before DOM ready'), {
      background: 'rgb(44, 44, 44)',
      body: 'rgb(44, 44, 44)',
      toolbar: 'rgb(38, 38, 38)',
      cardMounted: false
    });
    const firstPaint = await until(
      () => evaluate('performance.getEntriesByName("first-paint")[0]?.startTime'),
      'first paint timing'
    );
    const themeAppliedAt = await evaluate('window.darkThemeAppliedAt');
    assert(Number.isFinite(themeAppliedAt) && themeAppliedAt <= firstPaint,
      `Dark theme applied at ${themeAppliedAt} ms, first paint at ${firstPaint} ms`);
    await until(() => evaluate('!!document.querySelector("#stacks-hover-card")'), 'dark preview UI');
  } else {
    await evaluate(script);
  }
  await evaluate(`
    window.apiCalls = [];
    window.pointerLog = [];
    for (const type of ['pointerover', 'pointerout']) {
      document.addEventListener(type, event => window.pointerLog.push([
        type, event.target.tagName, event.target.closest('a')?.pathname,
        event.relatedTarget?.tagName, event.clientX, event.clientY, scrollY
      ]));
    }
    window.actualFetch = window.fetch;
    window.fetch = (path, options) => {
      window.apiCalls.push({ path, headers: options.headers });
      return window.mockResponse ? window.mockResponse() : window.actualFetch(path, options);
    };
  `);
  const card = '#stacks-hover-card';
  const body = '#stacks-hover-body';
  const key = 'stacks-hover-preview:v1:01WN';
  await evaluate(`(() => {
    const link = document.createElement('a');
    link.id = 'self-reference-test';
    link.href = location.pathname.toLowerCase() + '/?view=comments#comment';
    link.textContent = 'Reference to the current tag';
    (document.querySelector('#comments') ?? document.body).append(link);
    link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  })()`);
  await delay(400);
  assert(await evaluate(`document.querySelector('${card}').hidden`), 'Self-reference opened on hover');
  await evaluate('document.querySelector("#self-reference-test").focus({ preventScroll: true })');
  await delay(400);
  assert(await evaluate(`document.querySelector('${card}').hidden`), 'Self-reference opened on focus');
  assert.equal(await evaluate('apiCalls.length'), 0);
  await evaluate('document.querySelector("#self-reference-test").remove()');
  if (dark) {
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(44, 44, 44)');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#first-bar")).backgroundColor'), 'rgb(38, 38, 38)');
    await until(() => evaluate(`getComputedStyle(document.querySelector('.env-proof a')).color === 'rgb(145, 184, 239)'`), 'blue link color');
  }
  async function hover(tag) {
    const point = await evaluate(`(() => {
      const link = [...document.querySelectorAll('.env-proof a[href="/tag/${tag}"]')]
        .find(candidate => candidate.getClientRects().length && candidate.closest('article.env-proof'));
      link.scrollIntoView({ block: 'center' });
      const rect = link.getClientRects()[0];
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    const hit = await evaluate(`document.elementFromPoint(${point.x}, ${point.y})?.closest('a')?.pathname`);
    assert.equal(hit, '/tag/' + tag, 'Pointer hit at ' + JSON.stringify(point));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    assert.equal(await evaluate('document.querySelector("a:hover")?.pathname'), '/tag/' + tag);
  }
  async function close() {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    assert(await evaluate(`document.querySelector('${card}').hidden`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  }
  for (const tag of ['01WN', '01W6', '01NH', '01IQ']) {
    await hover(tag);
    await until(() => evaluate(`
      document.querySelector('${card} header a').pathname === '/tag/${tag}' &&
      !!document.querySelector('${body} .env-proof .MathJax, ${body} .env-proof .MathJax_Display')
    `), 'rendered proof for ' + tag).catch(async error => {
      console.error(await evaluate(`({
        tag: document.querySelector('${card} header a').pathname,
        hovered: document.querySelector('a:hover')?.pathname,
        hidden: document.querySelector('${card}').hidden,
        proof: document.querySelector('${body} .env-proof')?.innerHTML.slice(0, 400),
        text: document.querySelector('${body}').textContent.slice(0, 180),
        calls: apiCalls, pointer: pointerLog.slice(-12), scrollY,
        cached: !!localStorage.getItem('${key}')
      })`));
      throw error;
    });
    assert(await evaluate(`!!document.querySelector('${body} .env-lemma')`));
    assert.equal(await evaluate(`document.querySelector('${card} header a').href`), new URL('/tag/' + tag, page).href);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${card}')).backgroundColor`),
      dark ? 'rgb(44, 44, 44)' : 'rgb(255, 255, 255)');
    if (tag === '01W6') {
      await evaluate('new Promise(resolve => MathJax.Hub.Queue(() => { resolve(true); }))');
      assert(await evaluate(`!!document.querySelector('${body} .equation .MathJax_Display')`));
      assert.equal(await evaluate(`!!document.querySelector('${body} .MathJax_Error')`), false);
      if (dark) {
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('${body} .xypic [stroke="black"]')).stroke`),
          'rgb(206, 204, 200)');
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('${body} .xypic .MathJax')).color`),
          'rgb(206, 204, 200)');
      }
      if (process.env.STACKS_TEST_SCREENSHOT) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        await writeFile(process.env.STACKS_TEST_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
      }
    }
    await close();
  }
  console.log('Four live previews rendered statements, proofs, and MathJax.');
  assert.equal(await evaluate('Object.values(MathJax.Extension.Safe.config.allow).filter(value => value === "none").length'), 5);
  await hover('01WN');
  await until(() => evaluate(`!!document.querySelector('${body} .env-proof')`), 'cached proof');
  assert.equal(await evaluate('apiCalls.length'), 4);
  await close();

  const read = `JSON.parse(localStorage.getItem('${key}'))`;
  const initial = await evaluate(read);
  async function expire(overrides = {}) {
    await evaluate(`localStorage.setItem('${key}', JSON.stringify({
      ...${read}, ...${JSON.stringify(overrides)}, checkedAt: 0
    }))`);
  }
  await expire();
  await hover('01WN');
  await until(() => evaluate(`${read}.checkedAt > 0`), 'unchanged live revalidation');
  assert.equal((await evaluate(read)).html, initial.html);
  assert.equal(await evaluate('apiCalls.length'), 5);
  await close();

  await expire({ etag: '"test"' });
  await evaluate('window.mockResponse = async () => new Response(null, { status: 304 })');
  await hover('01WN');
  await until(() => evaluate(`${read}.checkedAt > 0`), '304 response');
  assert.equal(await evaluate('apiCalls.at(-1).headers["If-None-Match"]'), '"test"');
  assert.equal((await evaluate(read)).html, initial.html);
  await close();

  await expire();
  const changed = initial.html + '<p id="duplicate" class="modal env-remark" onclick="void(0)">Revised proof.' +
    '<a href="data:text/plain,preview">Invalid link</a><img src="https://example.invalid/sample.png">' +
    '<svg><a>Foreign markup</a></svg><form><input name="sample"></form></p>';
  await evaluate(`window.mockResponse = async () => new Response(${JSON.stringify(changed)}, {
    headers: { 'Content-Type': 'text/html' }
  })`);
  await hover('01WN');
  await until(() => evaluate(`document.querySelector('${body}').textContent.includes('Revised proof.')`), 'changed response');
  assert.equal((await evaluate(read)).html, changed);
  assert.equal(await evaluate(`!!document.querySelector('${body} :is([onclick], #duplicate, .modal, a[href^="data:"], img[src], svg, form)')`), false);
  await close();

  await expire();
  await evaluate('window.mockResponse = async () => { throw new Error("offline"); }');
  await hover('01WN');
  await until(() => evaluate('apiCalls.length === 8'), 'failed revalidation');
  assert(await evaluate(`document.querySelector('${body}').textContent.includes('Revised proof.')`));
  assert.equal((await evaluate(read)).html, changed);
  await close();
  await hover('01WN');
  await until(() => evaluate(`!document.querySelector('${card}').hidden`), 'cached preview during retry cooldown');
  assert.equal(await evaluate('apiCalls.length'), 8);
  console.log('Cache hits, unchanged HTML, 304, changed HTML, and offline fallback passed.');
  if (dark) {
    const section = 'https://stacks.math.columbia.edu/tag/07PD';
    await send('Page.navigate', { url: section });
    const labelColors = await until(() => evaluate(`(() => {
      if (location.href !== '${section}' || !document.querySelector('#stacks-hover-card')) return;
      return ['/tag/07PI', '/tag/07PJ'].flatMap(path => {
        const label = document.querySelector('article .environment-identifier[href="' + path + '"]');
        return [label, label.querySelector('[data-tag]')].map(node => getComputedStyle(node).color);
      });
    })()`), 'dark lemma and proposition labels');
    assert.deepEqual(labelColors, Array(4).fill('rgb(206, 204, 200)'));
    console.log('Lemma and proposition labels use the dark theme text color.');
  }
} finally {
  socket?.close();
  chrome.kill();
  await Promise.race([exited.catch(() => {}), delay(2000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
}
