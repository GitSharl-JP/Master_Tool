// Mini pilote Edge (protocole DevTools, sans dépendance) pour les tests d'interface.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
export const edgeAvailable = !!EDGE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openBrowser({ profileDir, port = 9340, width = 1400, height = 950 }) {
  mkdirSync(profileDir, { recursive: true });
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.find((t) => t.type === 'page')) break; } catch { /* démarrage */ } await sleep(250); }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(), problems = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.params.entry.url || '') && !/net::ERR_(INTERNET|NAME)/.test(m.params.entry.text)) problems.push(`${m.params.entry.text} ${m.params.entry.url || ''}`);
    else if (m.method === 'Runtime.exceptionThrown') problems.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const api = {
    problems,
    cookie: (name, value, url) => cdp('Network.setCookie', { name, value, url }),
    ev: async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; },
    async go(url, settle = 'document.readyState === "complete"') {
      await cdp('Page.navigate', { url });
      for (let i = 0; i < 60; i++) { await sleep(200); try { if (await api.ev(`(${settle}) && document.body && document.body.innerText.length > 20`)) break; } catch { /* page en cours de chargement */ } }
      await sleep(400);
    },
    shot: async (file) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    sleep,
    close: () => { try { ws.close(); } catch { /* déjà fermé */ } proc.kill(); },
  };
  return api;
}
export { join };
