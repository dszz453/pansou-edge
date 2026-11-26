/**
 * 一键下载（V1.6.1）端到端验证 + 截图（Chrome DevTools Protocol，零依赖）
 *
 * 用法: 先 `node build.mjs && node serve-local.mjs 8791`，再
 *       `node verify_transfer_quick.mjs [url] [输出前缀]`
 *
 * 验证三件事：
 *   1. 结果卡片出现「下载」按钮，点击后进入一键流程（解析 → 转存 → 下载），
 *      没有可用 Cookie 时如实落到「登录已失效」并给出 Cookie 输入；
 *   2. 转存 + 展开成功时（用假响应替换接口）自动开始下载、多文件给出「全部下载」；
 *   3. 后台配好 Cookie 后，弹窗提示「留空即用站长账号」，转存按钮不再要求访客必填。
 *
 * 说明：真实的「转存到网盘」需要一个有登录态的网盘 Cookie，
 * 仓库里不能放凭据，所以第 2 步用可注入的假响应验证前端编排，第 1/3 步走真后端。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2] || 'http://127.0.0.1:8791';
const PREFIX = process.argv[3] || 'quick';
const ORIGIN = new URL(URL_).origin;
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
const profile = mkdtempSync(join(tmpdir(), 'qkshot-'));
const sleep = ms => new Promise(s => setTimeout(s, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
};

const post = (path, body, headers) =>
  fetch(ORIGIN + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body)
  }).then(r => r.json());
const adm = { Authorization: 'Bearer admin' };

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
  // 开启转存，但先不配 Cookie —— 验证「没有可用 Cookie」时的表现
  const on = await post('/api/admin/settings', { transferEnabled: true, transferCookies: { quark: '', uc: '', baidu: '' } }, adm);
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
  await evaluate(`(() => { const vm = ${VM}; if (!vm) return 'no-vm';
    const d = new Date().toISOString();
    vm.mergedResults = {
      quark: [{ url: 'https://pan.quark.cn/s/b92045ed0d2d', note: '庆余年(2019)4K 高码率 全集', password: '', datetime: d, source: 'tg:PanjClub' }],
      baidu: [{ url: 'https://pan.baidu.com/s/1KNAtpPYYZAy9QEllQj1kZg?pwd=gpvg', note: '庆余年 第二季 4K', password: 'gpvg', datetime: d, source: 'tg:PanjClub' }]
    };
    vm.totalCount = 2; vm.searched = true; vm.loading = false; vm.activeTab = 'all';
    return 'ok'; })()`);
  await sleep(600);

  console.log('\n--- 1. 结果卡片的「下载」按钮 ---');
  const btns = await evaluate(`(() => {
    const all = [...document.querySelectorAll('button')];
    const dl = all.filter(b => (b.getAttribute('title') || '').includes('自动转存'));
    const tr = all.filter(b => (b.getAttribute('title') || '').includes('转存到自己网盘的指定目录'));
    return { dl: dl.length, tr: tr.length, firstText: dl[0] ? dl[0].textContent.trim() : '' };
  })()`);
  check('夸克 / 百度两张卡片各有一个「下载」按钮', btns.dl === 2, JSON.stringify(btns));
  check('下载按钮文案为「下载」', btns.firstText === '下载', btns.firstText);
  check('保留「转存」进阶入口（可勾选文件）', btns.tr === 2, 'tr=' + btns.tr);
  const ready = await evaluate(`JSON.stringify(${VM}.transferReady)`);
  check('未配置服务端 Cookie 时 transfer_ready 全为 false', ready === '{"quark":false,"uc":false,"baidu":false}', ready);

  console.log('\n--- 2. 点「下载」：无 Cookie 时如实报「登录已失效」---');
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('自动转存')); b.click(); })()`);
  let st = '';
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    st = await evaluate(`${VM}.tr.step`);
    if (st === 'cred') break;
  }
  const q1 = await evaluate(`(() => { const t = ${VM}.tr; return { open: t.open, quick: t.quick, kind: t.kind, step: t.step, error: t.error, progress: t.progress, elapsed: t.elapsed }; })()`);
  check('一键弹窗已打开（快捷模式）', q1.open === true && q1.quick === true, JSON.stringify(q1));
  check('识别为夸克网盘', q1.kind === 'quark');
  check('失败后退回 Cookie 步骤', q1.step === 'cred', 'step=' + q1.step);
  check('错误文案指出网盘登录失效', /登录已失效/.test(q1.error), q1.error);
  await shoot('desktop-error');

  console.log('\n--- 3. 成功路径（注入假响应）：自动开始下载 + 多文件「全部下载」---');
  await evaluate(`(() => {
    window.__dl = [];
    const origFetch = window.fetch.bind(window);
    window.fetch = (u, init) => {
      const url = String(u);
      if (url.indexOf('/api/transfer/fetch') >= 0) {
        return Promise.resolve(new Response(JSON.stringify({ code: 0, data: {
          kind: 'quark', share_title: '庆余年(2019)4K', path: '/来自PanSou/庆余年(2019)4K',
          files: [
            { id: 'f1', name: 'E01.mkv', path: '/来自PanSou/庆余年(2019)4K/E01.mkv', size: 2147483648 },
            { id: 'f2', name: 'E02.mkv', path: '/来自PanSou/庆余年(2019)4K/E02.mkv', size: 1073741824 }
          ],
          truncated: true, skipped: 0, task_pending: false
        } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.indexOf('/api/transfer/link') >= 0) {
        return Promise.resolve(new Response(JSON.stringify({ code: 0, data: { name: 'E01.mkv', size: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return origFetch(u, init);
    };
    const origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      if ((this.action || '').indexOf('/api/transfer/download') >= 0) {
        window.__dl.push(Object.fromEntries([...this.elements].map(e => [e.name, e.value])));
        return;
      }
      return origSubmit.call(this);
    };
    return 'stubbed';
  })()`);
  await evaluate(`(() => { const vm = ${VM}; vm.quickDownload({ cloudType: 'quark', url: 'https://pan.quark.cn/s/b92045ed0d2d', password: '', note: '庆余年(2019)4K' }); })()`);
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    if ((await evaluate(`${VM}.tr.step`)) === 'done') break;
  }
  await sleep(1500);
  const q2 = await evaluate(`(() => { const t = ${VM}.tr; return {
    step: t.step, saved: t.saved.length, path: t.savedPath, truncated: t.truncated,
    dl: (window.__dl || []).length, firstKind: (window.__dl || [])[0] ? window.__dl[0].kind : '',
    firstPath: (window.__dl || [])[0] ? window.__dl[0].path : '',
    progress: t.progress, downloadable: ${VM}.downloadable.length
  }; })()`);
  check('流程走到「已完成」', q2.step === 'done', JSON.stringify(q2));
  check('列出 2 个可下载文件', q2.saved === 2 && q2.downloadable === 2);
  check('自动触发了下载（多文件先下前几个）', q2.dl >= 1, 'dl=' + q2.dl);
  check('下载表单带上了 kind 与文件 path', q2.firstKind === 'quark' && /E01\.mkv$/.test(q2.firstPath), q2.firstKind + ' ' + q2.firstPath);
  check('截断标记透传到前端', q2.truncated === true);
  check('进度条走满', q2.progress === 100, 'progress=' + q2.progress);
  // 全部下载是串行触发的（每个文件之间留 1.2s 间隔），等它跑完再判断按钮文案
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    if ((await evaluate(`${VM}.tr.dlAll`)) === false) break;
  }
  const hasAllBtn = await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('全部下载'))`);
  check('多文件时出现「全部下载」按钮', hasAllBtn === true);
  await shoot('desktop-done');

  console.log('\n--- 4. 后台配好 Cookie 后：访客留空即可 ---');
  await post('/api/admin/settings', { transferEnabled: true, transferCookies: { quark: '__puus=TEST_ONLY' } }, adm);
  await evaluate(`window.fetch = window.__origFetch || window.fetch; 1`);
  await send('Page.navigate', { url: ORIGIN + '/?debug=1' });
  await sleep(1800);
  await evaluate(`(() => { const vm = ${VM}; const d = new Date().toISOString();
    vm.mergedResults = { quark: [{ url: 'https://pan.quark.cn/s/b92045ed0d2d', note: '庆余年', password: '', datetime: d, source: 'tg:PanjClub' }] };
    vm.totalCount = 1; vm.searched = true; vm.loading = false; vm.activeTab = 'all'; return 'ok'; })()`);
  await sleep(500);
  const ready2 = await evaluate(`JSON.stringify(${VM}.transferReady)`);
  check('ui-config 下发「夸克已配置」', /"quark":true/.test(ready2), ready2);
  const noLeak = await evaluate(`document.documentElement.innerHTML.indexOf('TEST_ONLY') < 0`);
  check('页面里搜不到服务端 Cookie 明文', noLeak === true);
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '').includes('转存到自己网盘的指定目录')); b.click(); })()`);
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    if ((await evaluate(`${VM}.tr.step`)) === 'files') break;
  }
  const q3 = await evaluate(`(() => { const t = ${VM}.tr; const btns = [...document.querySelectorAll('button')];
    const save = btns.find(b => b.textContent.includes('转存 ') && b.textContent.includes(' 项'));
    return { step: t.step, cred: t.cred, hintShown: document.body.textContent.includes('留空即用站长账号'), saveDisabled: save ? save.disabled : null };
  })()`);
  check('访客未填 Cookie 也能解析到文件清单', q3.step === 'files', 'step=' + q3.step);
  check('弹窗提示可用站长账号', q3.hintShown === true);
  check('「转存」按钮在留空时可用（走服务端 Cookie）', q3.saveDisabled === false);
  await shoot('desktop-server-cookie');

  await viewport(390, 844);
  await sleep(500);
  const mob = await evaluate(`(() => { const m = document.querySelector('.fixed.inset-0.z-\\\\[70\\\\] > div'); if (!m) return null; const r = m.getBoundingClientRect(); return { w: Math.round(r.width), vw: window.innerWidth, overflow: m.scrollWidth > m.clientWidth + 1 }; })()`);
  check('移动端弹窗铺满宽度且无横向溢出', !!mob && mob.w === mob.vw && !mob.overflow, JSON.stringify(mob));
  await shoot('mobile');

  // 移动端结果卡片：下载 / 转存 / 测活 / 直达 四个操作不能把卡片挤爆
  await evaluate(`${VM}.closeTransfer()`);
  await sleep(400);
  const cardMobile = await evaluate(`(() => {
    const card = document.querySelector('.card-hover-effect');
    if (!card) return null;
    const row = card.querySelector('.flex.items-center.space-x-2');
    return { overflow: row ? row.scrollWidth > row.clientWidth + 1 : null, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  })()`);
  check('移动端卡片操作区无横向溢出', !!cardMobile && cardMobile.overflow === false && cardMobile.docOverflow === false, JSON.stringify(cardMobile));
  await shoot('mobile-card');
  await viewport(1440, 1100);
  await sleep(300);

  check('浏览器控制台无 JS 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  console.error('验证脚本异常:', e.message);
  results.push(false);
} finally {
  try {
    await post('/api/admin/settings', { transferEnabled: false, transferCookies: { quark: '', uc: '', baidu: '' } }, adm);
  } catch {}
  cleanup();
}

const pass = results.filter(Boolean).length;
console.log(`\n==== 一键下载 UI 验证：${pass}/${results.length} 通过 ====`);
process.exit(pass === results.length ? 0 : 1);
