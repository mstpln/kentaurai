// Dependency-free browser QA. Chromium is only needed for the opt-in UI check.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function openBrowser(origin) {
  const profile = await mkdtemp(join(tmpdir(), 'kentaurai-ui-'));
  const child = spawn(process.env.CHROMIUM_BIN || '/repl/tools/bin/chromium', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-component-update',
    '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    'about:blank'
  ], {
    // The browser never inherits application or Cloudflare credentials.
    env: Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'XDG_RUNTIME_DIR']
      .filter(key => process.env[key]).map(key => [key, process.env[key]])),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let socket;
  const pending = new Map();
  const events = new Map();
  const errors = [];
  const writes = [];
  const responses = new Map();
  let sequence = 0;
  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chromium startup timed out')), 20000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Chromium exited before becoming ready'));
    });
    child.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  async function close() {
    socket?.close();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Browser closed'));
    }
    pending.clear();
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 25000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  try {
    const address = await ready;
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', message => {
      const data = JSON.parse(String(message.data));
      if (data.id) {
        const entry = pending.get(data.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(data.id);
        if (data.error) entry.reject(new Error(data.error.message));
        else entry.resolve(data.result);
      } else {
        for (const listener of events.get(data.method) || []) listener(data.params, data.sessionId);
      }
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const command = (method, params) => send(method, params, sessionId);
    const on = (method, listener) => {
      if (!events.has(method)) events.set(method, []);
      events.get(method).push(listener);
    };
    on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      errors.push(exceptionDetails.exception?.description || exceptionDetails.text);
    });
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Network.enable');
    await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    on('Fetch.requestPaused', ({ requestId, request }) => {
      const sameOrigin = request.url.startsWith(origin + '/');
      const localAsset = /^(data:|about:|blob:)/.test(request.url);
      const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const login = sameOrigin && new URL(request.url).pathname === '/app/login';
      if (write && !login) writes.push(`${request.method} ${new URL(request.url).pathname}`);
      const allowed = (sameOrigin || localAsset) && (!write || login);
      const mock = sameOrigin && !write && responses.get(new URL(request.url).pathname);
      if (allowed && mock) {
        command('Fetch.fulfillRequest', {
          requestId, responseCode: mock.status,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(mock.body)).toString('base64')
        }).catch(() => {});
        return;
      }
      command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    };
    const waitFor = async (expression, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      throw new Error(`UI condition timed out: ${expression}`);
    };
    return {
      command, evaluate, waitFor, errors, writes, close,
      mock(path, status, body) { responses.set(path, { status, body }); },
      clearMocks() { responses.clear(); },
      async viewport(width, height = 900) {
        await command('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: 1, mobile: width < 768
        });
      },
      async navigate(path) {
        await evaluate('window.__kentauraiQaPreviousDocument=true');
        await command('Page.navigate', { url: origin + path });
        await waitFor(`!window.__kentauraiQaPreviousDocument && location.pathname===${JSON.stringify(path.split('?')[0])} && document.readyState==='complete'`);
      },
      async click(selector) {
        const point = await evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Control not found: ' + ${JSON.stringify(selector)});
          el.scrollIntoView({block:'center', inline:'nearest'});
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) throw new Error('Control is hidden');
          return {x:r.x+r.width/2, y:r.y+r.height/2};
        })()`);
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      },
      async screenshot() {
        const { data } = await command('Page.captureScreenshot', { format: 'png' });
        return Buffer.from(data, 'base64');
      }
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function authenticateBrowser(browser, origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.replit.dev')) {
    throw new Error('Development authentication is restricted to the Replit preview');
  }
  if (!process.env.APP_PASSWORD) throw new Error('Development APP_PASSWORD is unavailable');
  // Resolve the existing development secret at runtime; never print or persist it.
  const response = await fetch(origin + '/app/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD, returnTo: '/app/' })
  });
  const rawCookie = response.headers.get('set-cookie');
  if (response.status !== 303 || !rawCookie) throw new Error(`Development login failed (${response.status})`);
  const pair = rawCookie.split(';')[0];
  const delimiter = pair.indexOf('=');
  const result = await browser.command('Network.setCookie', {
    name: pair.slice(0, delimiter), value: pair.slice(delimiter + 1),
    url: origin + '/app/', path: '/app', secure: true, httpOnly: true
  });
  if (!result.success) throw new Error('Browser could not establish development session');
}
