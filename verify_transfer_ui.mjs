/**
 * 转存弹窗（V1.6）端到端验证 + 截图（Chrome DevTools Protocol，零依赖）
 *
 * 用法: 先 `node build.mjs && node serve-local.mjs 8791`，再 `node verify_transfer_ui.mjs [url] [输出前缀]`
 *
 * 步骤：后台开启转存 → 注入模拟结果 → 验证「转存」按钮只在夸克/百度卡片出现 →
 *       打开弹窗 → 匿名解析真实夸克分享 → 文件清单 → 填假 Cookie 触发「登录已失效」提示 → 截图。
 * 产出: <前缀>-desktop.png / <前缀>-mobile.png
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] || 'http://127.0.0.1:8791';
const PREFIX = process.argv[3] || 'transfer';
const ORIGIN = new URL(URL_).origin;
// Chromium 内核浏览器：系统 Chrome → 用户目录 Chrome → Edge，取第一个存在的
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => p && existsSync(p));
if (!CHROME) {
  console.error('未找到 Chrome / Edge，可执行文件路径可通过环境变量 BROWSER 指定');
  process.exit(2);
}
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'trshot-'));
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
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,1100',
    'about:blank'
  ],
  { stdio: 'ignore' }
);
chrome.on('error', e => {
  console.error('浏览器启动失败:', e.message);
  process.exit(2);
});

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
  // 后台开启转存
  const on = await post('/api/admin/settings', { transferEnabled: true }, { Authorization: 'Bearer admin' });
  if (on.code !== 0) throw new Error('无法开启转存开关: ' + JSON.stringify(on));

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
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    }
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
  const viewport = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 640 });

  const VM = `(() => { const a = window.__pansouApp; return (a && a._instance && a._instance.proxy) || (a && a._container && a._container._vnode && a._container._vnode.component && a._container._vnode.component.proxy) || null; })()`;

  await send('Page.navigate', { url: ORIGIN + '/?debug=1' });
  await sleep(1800);

  // 注入模拟结果：夸克（活链接）/ 百度 / 阿里（不支持）
  await evaluate(`(() => { const vm = ${VM}; if (!vm) return 'no-vm';
    const d = new Date().toISOString();
    vm.mergedResults = {
      quark: [{ url: 'https://pan.quark.cn/s/b92045ed0d2d', note: '庆余年(2019)4K 高码率 全集', password: '', datetime: d, source: 'tg:PanjClub' }],
      baidu: [{ url: 'https://pan.baidu.com/s/1KNAtpPYYZAy9QEllQj1kZg?pwd=gpvg', note: '庆余年 第二季 4K', password: 'gpvg', datetime: d, source: 'tg:PanjClub' }],
      aliyun: [{ url: 'https://www.alipan.com/s/1uDchXgTafM', note: '庆余年 阿里云盘版（不支持转存）', password: '', datetime: d, source: 'tg:PanjClub' }]
    };
    vm.totalCount = 3; vm.searched = true; vm.loading = false; vm.activeTab = 'all';
    return 'ok'; })()`);
  await sleep(600);

  console.log('\n--- 转存按钮 ---');
  const btnInfo = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter(x => (x.getAttribute('title') || '').includes('转存到自己网盘')); return { count: b.length, cards: document.querySelectorAll('.card-hover-effect').length }; })()`);
  check('结果卡片渲染 3 张', btnInfo.cards === 3, `cards=${btnInfo.cards}`);
  check('「转存」按钮只在夸克 / 百度卡片出现', btnInfo.count === 2, `count=${btnInfo.count}`);
  const enabled = await evaluate(`${VM}.transferEnabled`);
  const caps = await evaluate(`Object.keys(${VM}.transferCaps).join(',')`);
  check('ui-config 下发 transfer_enabled + 能力表', enabled === true && caps === 'quark,uc,baidu', `caps=${caps}`);

  console.log('\n--- 打开弹窗（夸克，匿名解析真实分享）---');
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('转存到自己网盘')); b.click(); })()`);
  let step = '';
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    step = await evaluate(`${VM}.tr.step`);
    if (step === 'files' || (await evaluate(`${VM}.tr.error`))) break;
  }
  const tr1 = await evaluate(`(() => { const t = ${VM}.tr; return { open: t.open, step: t.step, kind: t.kind, label: t.cap.label, title: t.title, items: t.items.length, selected: t.selected.length, dir: t.dir, error: t.error, hint: (${VM}.cookieHint || '').slice(0, 30) }; })()`);
  check('弹窗已打开', tr1.open === true);
  check('自动解析分享并进入「文件清单」步骤', tr1.step === 'files', `step=${tr1.step} err=${tr1.error}`);
  check('识别为夸克网盘', tr1.kind === 'quark' && tr1.label === '夸克网盘', `${tr1.kind}/${tr1.label}`);
  check('分享标题已回填', /庆余年/.test(tr1.title), `title=${tr1.title}`);
  check('文件清单非空且默认全选', tr1.items > 0 && tr1.selected === tr1.items, `items=${tr1.items} selected=${tr1.selected}`);
  check('目标目录默认 /来自PanSou', tr1.dir === '/来自PanSou', `dir=${tr1.dir}`);
  check('Cookie 指引文案按网盘下发', /pan\.quark\.cn/.test(tr1.hint), `hint=${tr1.hint}`);
  const saveDisabled = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('转存 ') && x.textContent.includes(' 项')); return b ? b.disabled : null; })()`);
  check('未填 Cookie 时「转存」按钮禁用', saveDisabled === true);
  await shoot('desktop');

  console.log('\n--- 填假 Cookie → 浏览目录（应提示登录失效）---');
  await evaluate(`(() => { const vm = ${VM}; vm.tr.cred = '__puus=fake'; return vm.browseDir('/'); })()`, true);
  await sleep(300);
  const tr2 = await evaluate(`(() => { const t = ${VM}.tr; return { error: t.error, browseOpen: t.browseOpen, saveDisabled: null }; })()`);
  check('假 Cookie → 提示「登录已失效」', /登录已失效/.test(tr2.error), `error=${tr2.error}`);
  check('目录浏览器在失败时关闭', tr2.browseOpen === false);
  const saveEnabled = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('转存 ') && x.textContent.includes(' 项')); return b ? !b.disabled : null; })()`);
  check('填了 Cookie 后「转存」按钮可用', saveEnabled === true);
  const dirFns = await evaluate(`JSON.stringify({ j: ${VM}.joinDir('/a/b', 'c'), p: ${VM}.parentDir('/a/b'), sz: ${VM}.fmtSize(1536) })`);
  const df = JSON.parse(dirFns);
  check('目录拼接 / 上一级 / 大小格式化', df.j === '/a/b/c' && df.p === '/a' && df.sz === '1.5 KB', dirFns);
  await shoot('desktop-error');

  await viewport(390, 844);
  await sleep(500);
  const mob = await evaluate(`(() => { const m = document.querySelector('.fixed.inset-0.z-\\\\[70\\\\] > div'); if (!m) return null; const r = m.getBoundingClientRect(); return { w: Math.round(r.width), vw: window.innerWidth, overflow: m.scrollWidth > m.clientWidth + 1 }; })()`);
  check('移动端弹窗铺满宽度且无横向溢出', !!mob && mob.w === mob.vw && !mob.overflow, JSON.stringify(mob));
  await shoot('mobile');

  console.log('\n--- 关闭弹窗 / 不支持的网盘 ---');
  await viewport(1440, 1100);
  await evaluate(`${VM}.closeTransfer()`);
  await sleep(300);
  check('关闭弹窗', (await evaluate(`${VM}.tr.open`)) === false);
  const canAli = await evaluate(`${VM}.canTransfer('aliyun')`);
  const canQ = await evaluate(`${VM}.canTransfer('quark')`);
  check('canTransfer：阿里 false / 夸克 true', canAli === false && canQ === true);
  const iframeOk = await evaluate(`!!document.querySelector('iframe[name="tr-dl-frame"]')`);
  check('下载隐藏 iframe 已挂载', iframeOk);

  check('浏览器控制台无 JS 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('验证脚本异常:', e.message);
  results.push(false);
} finally {
  try {
    await post('/api/admin/settings', { transferEnabled: false }, { Authorization: 'Bearer admin' });
  } catch {}
  cleanup();
}

const pass = results.filter(Boolean).length;
console.log(`\n==== 转存 UI 验证：${pass}/${results.length} 通过 ====`);
process.exit(pass === results.length ? 0 : 1);
