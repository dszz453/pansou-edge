/**
 * 后台「网盘转存功能」开关（V1.6）端到端验证 + 截图（Chrome DevTools Protocol，零依赖）
 *
 * 用法: 先 `node build.mjs && node serve-local.mjs 8791`，再 `node verify_transfer_admin.mjs [url] [输出前缀]`
 * 步骤：登录后台 → 「结果展示」页 → 开关默认关 → 点开 → 保存 → 读接口确认已落盘 →
 *       「API 接口」页出现转存文档 → 恢复出厂 → 确认开关回 false → 无 JS 报错。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] || 'http://127.0.0.1:8791';
const PREFIX = process.argv[3] || 'transfer-admin';
const ORIGIN = new URL(URL_).origin;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => p && existsSync(p));
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'tradm-'));
const sleep = ms => new Promise(s => setTimeout(s, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
};
const post = (path, body, headers) =>
  fetch(ORIGIN + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) }).then(r => r.json());

const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank'],
  { stdio: 'ignore' }
);
chrome.on('error', e => { console.error('浏览器启动失败:', e.message); process.exit(2); });

let ws = null;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome 调试端口未就绪');
}
const cleanup = () => {
  try { ws?.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};

try {
  await post('/api/admin/settings', { transferEnabled: false }, { Authorization: 'Bearer admin' });
  ws = new WebSocket(await connect());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression, awaitPromise = false) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' :: ' + (res.exceptionDetails.exception?.description || ''));
    return res.result?.value;
  };
  const shoot = async name => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${PREFIX}-${name}.png`, Buffer.from(res.data, 'base64'));
    console.log(`     📸 ${PREFIX}-${name}.png`);
  };
  const VM = `(() => { const a = window.__pansouAdmin; return (a && a._instance && a._instance.proxy) || (a && a._container && a._container._vnode && a._container._vnode.component && a._container._vnode.component.proxy) || null; })()`;

  await send('Page.navigate', { url: ORIGIN + '/admin?debug=1' });
  await sleep(1500);
  await evaluate(`(() => { const vm = ${VM}; vm.pwdInput = 'admin'; return vm.login(); })()`, true);
  await sleep(500);
  check('登录后台', (await evaluate(`${VM}.authed`)) === true);

  await evaluate(`${VM}.activeTab = 'display'`);
  await sleep(400);
  const hasCard = await evaluate(`document.body.innerText.includes('网盘转存功能') && document.body.innerText.includes('网盘 Cookie 会经过本 Worker 转发')`);
  check('「结果展示」页出现转存开关卡片与风险提示', hasCard === true);
  check('开关初始为关', (await evaluate(`${VM}.settings.transferEnabled`)) === false);
  await evaluate(`document.body.innerText.includes('网盘转存功能') && ([...document.querySelectorAll('h3')].find(h => h.textContent.includes('网盘转存功能')) || {}).scrollIntoView && [...document.querySelectorAll('h3')].find(h => h.textContent.includes('网盘转存功能')).scrollIntoView({ block: 'center' })`);
  await sleep(300);
  await shoot('off');

  // 点击开关并保存
  await evaluate(`(() => { const h = [...document.querySelectorAll('h3')].find(x => x.textContent.includes('网盘转存功能')); h.parentElement.parentElement.querySelector('button').click(); })()`);
  await sleep(200);
  check('点击后开关为开', (await evaluate(`${VM}.settings.transferEnabled`)) === true);
  await shoot('on');
  await evaluate(`${VM}.save()`, true);
  await sleep(600);
  const saved = await fetch(ORIGIN + '/api/admin/settings', { headers: { Authorization: 'Bearer admin' } }).then(r => r.json());
  check('保存后接口读到 transferEnabled=true', saved.transferEnabled === true);
  const uc = await fetch(ORIGIN + '/api/ui-config').then(r => r.json());
  check('前台 ui-config 同步 transfer_enabled=true', uc.transfer_enabled === true && Array.isArray(uc.transfer_caps) && uc.transfer_caps.length === 3);

  // V1.6.1：网盘 Cookie 配置区
  await evaluate(`${VM}.activeTab = 'display'`);
  await sleep(300);
  const cookieCard = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const verify = btns.find(b => b.textContent.trim() === '验证');
    const areas = [...document.querySelectorAll('textarea')];
    const labels = ['夸克网盘', 'UC 网盘', '百度网盘'].every(n => document.body.innerText.includes(n));
    const h3 = [...document.querySelectorAll('h3')].find(x => x.textContent.includes('网盘 Cookie'));
    if (h3) h3.scrollIntoView({ block: 'center' });
    return { verify: !!verify, areas: areas.length, labels };
  })()`);
  check('出现「网盘 Cookie」配置区（三个输入框）', cookieCard.areas === 3 && cookieCard.labels === true, JSON.stringify(cookieCard));
  check('提供「验证」按钮', cookieCard.verify === true);
  await sleep(300);
  await shoot('cookie-empty');

  // 填假 Cookie → 验证按钮应如实报不可用；保存后接口能读到，但前台页面拿不到明文
  await evaluate(`(() => { const vm = ${VM}; vm.settings.transferCookies.quark = '__puus=ADMIN_TEST_FAKE'; return 'ok'; })()`);
  await evaluate(`${VM}.verifyAllCookies()`, true);
  await sleep(500);
  const badStatus = await evaluate(`JSON.stringify(${VM}.cookieStatus.quark || null)`);
  check('假 Cookie 验证结果为不可用', /"ok":false/.test(badStatus), badStatus);
  await evaluate(`${VM}.save()`, true);
  await sleep(700);
  const savedCk = await fetch(ORIGIN + '/api/admin/settings', { headers: { Authorization: 'Bearer admin' } }).then(r => r.json());
  check('保存后后台能读到服务端 Cookie', savedCk.transferCookies && savedCk.transferCookies.quark === '__puus=ADMIN_TEST_FAKE');
  const ucCk = await fetch(ORIGIN + '/api/ui-config').then(r => r.json());
  check('ui-config 只下发布尔值（不泄漏 Cookie）', JSON.stringify(ucCk).indexOf('ADMIN_TEST_FAKE') < 0 && ucCk.transfer_cred_ready.quark === true);
  await shoot('cookie-filled');

  // API 文档页
  await evaluate(`${VM}.activeTab = 'api'`);
  await sleep(400);
  const docTxt = await evaluate(`document.body.innerText`);
  check('API 文档页含「网盘转存（V1.6）」分组', docTxt.includes('网盘转存（V1.6，需后台开启）'));
  check('API 文档页列出 /api/transfer/* 接口', ['/api/transfer/preview', '/api/transfer/save', '/api/transfer/fetch', '/api/transfer/check', '/api/transfer/download'].every(p => docTxt.includes(p)));
  await shoot('api');

  // 恢复出厂 → 开关回 false（恢复出厂会弹 confirm，headless 下先覆盖掉）
  await evaluate(`(() => { window.confirm = () => true; const vm = ${VM}; vm.settings.transferEnabled = true; return vm.resetToDefaults(); })()`, true);
  await sleep(800);
  check('恢复出厂后开关回到关', (await evaluate(`${VM}.settings.transferEnabled`)) === false);
  check('浏览器控制台无 JS 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('验证脚本异常:', e.message);
  results.push(false);
} finally {
  try { await post('/api/admin/settings', { transferEnabled: false }, { Authorization: 'Bearer admin' }); } catch {}
  cleanup();
}
const pass = results.filter(Boolean).length;
console.log(`\n==== 后台转存开关验证：${pass}/${results.length} 通过 ====`);
process.exit(pass === results.length ? 0 : 1);
