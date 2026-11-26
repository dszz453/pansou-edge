/**
 * 转存文件展开的离线单测（V1.6.1）
 * ========================
 * 用假目录树验证 src/transfer/collect.ts 的遍历与三个上限（文件数 / 层级 / 列目录次数），
 * 不连任何网盘，可离线反复跑：
 *
 *   node verify_transfer_collect.mjs
 *
 * 之所以单独测这一段：整季剧集的分享是「文件夹套文件夹」，
 * 展开逻辑错了会表现成「转存成功但下载列表是空的」，线上很难复现。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const outDir = mkdtempSync(join(tmpdir(), 'collect-test-'));
const entry = join(outDir, 'entry.ts');
const bundle = join(outDir, 'entry.mjs');

writeFileSync(
  entry,
  "export { collectFiles } from " + JSON.stringify(join(root, 'src/transfer/collect.ts').replace(/\\/g, '/')) + ";\n"
);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'error'
});

const { collectFiles } = await import(pathToFileURL(bundle).href);

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    fail++;
    console.log('  ❌ ' + name + (extra ? ' → ' + extra : ''));
  }
};

/** 简单的假目录树：path → 子条目 */
const makeLister = tree => {
  const calls = [];
  const fn = async p => {
    calls.push(p);
    const entries = tree[p];
    if (!entries) throw new Error('no such dir: ' + p);
    return { path: p, entries };
  };
  fn.calls = calls;
  return fn;
};

const F = (id, name, size = 100) => ({ id, name, is_dir: false, size });
const D = (id, name) => ({ id, name, is_dir: true, size: 0 });

console.log('\n=== 1. 单层：文件与文件夹混合 ===');
{
  const lister = makeLister({
    '/来自PanSou/剧集/S01': [F('f2', 'E01.mkv', 300), F('f3', 'E02.mkv', 400)]
  });
  const r = await collectFiles(
    '/来自PanSou/剧集',
    [F('f1', 'readme.txt', 10), D('d1', 'S01')],
    lister
  );
  check('文件数 = 3', r.files.length === 3, JSON.stringify(r.files.map(f => f.name)));
  check('保留根目录下的文件', r.files.some(f => f.name === 'readme.txt'));
  check('子目录文件被展开', r.files.some(f => f.name === 'E01.mkv'));
  check('路径按网盘目录拼接', r.files.find(f => f.name === 'E01.mkv').path === '/来自PanSou/剧集/S01/E01.mkv', r.files.find(f => f.name === 'E01.mkv').path);
  check('size 透传', r.files.find(f => f.name === 'E02.mkv').size === 400);
  check('未截断', r.truncated === false && r.skipped === 0);
}

console.log('\n=== 2. 多层嵌套（3 层内） ===');
{
  const lister = makeLister({
    '/a/b': [D('d2', 'c')],
    '/a/b/c': [F('f9', 'deep.mp4', 999)]
  });
  const r = await collectFiles('/a', [D('d1', 'b')], lister);
  check('递归到第 3 层拿到文件', r.files.length === 1 && r.files[0].name === 'deep.mp4');
  check('路径完整', r.files[0].path === '/a/b/c/deep.mp4', r.files[0].path);
}

console.log('\n=== 3. 层级上限：超过 maxDepth 的目录只标记截断 ===');
{
  const lister = makeLister({
    '/a/b': [D('d2', 'c')],
    '/a/b/c': [D('d3', 'd')],
    '/a/b/c/d': [F('fx', 'never.mp4')]
  });
  const r = await collectFiles('/a', [D('d1', 'b')], lister, { maxDepth: 2 });
  check('未展开到第 4 层', r.files.length === 0);
  check('标记 truncated', r.truncated === true, String(r.truncated));
  check('skipped 记录跳过的目录', r.skipped === 1, String(r.skipped));
  check('没有发起超限的列目录', lister.calls.length === 1, lister.calls.join(','));
}

console.log('\n=== 4. 文件数上限 ===');
{
  const many = Array.from({ length: 30 }, (_, i) => F('f' + i, 'E' + i + '.mkv'));
  const lister = makeLister({});
  const r = await collectFiles('/a', many, lister, { maxFiles: 10 });
  check('只取前 10 个', r.files.length === 10, String(r.files.length));
  check('标记 truncated', r.truncated === true);
}

console.log('\n=== 5. 列目录次数上限 ===');
{
  const dirs = Array.from({ length: 5 }, (_, i) => D('d' + i, 'dir' + i));
  const tree = {};
  dirs.forEach((d, i) => {
    tree['/a/' + d.name] = [D('dd' + i, 'sub')];
    tree['/a/' + d.name + '/sub'] = [F('ff' + i, 'x' + i + '.mkv')];
  });
  const lister = makeLister(tree);
  const r = await collectFiles('/a', dirs, lister, { maxListCalls: 3, maxDepth: 9 });
  check('列目录调用不超过 3 次', lister.calls.length <= 3, String(lister.calls.length));
  check('标记 truncated', r.truncated === true);
}

console.log('\n=== 6. 子目录读失败：跳过而不是整单失败 ===');
{
  const lister = async p => {
    if (p === '/a/bad') throw new Error('风控');
    return { path: p, entries: [F('ok1', 'good.mkv')] };
  };
  const r = await collectFiles('/a', [D('d1', 'bad'), D('d2', 'goodDir')], lister);
  check('失败目录被跳过', r.skipped === 1, String(r.skipped));
  check('其它目录照常展开', r.files.length === 1 && r.files[0].name === 'good.mkv');
}

console.log('\n=== 7. 空条目 / 缺 id 的脏数据 ===');
{
  const lister = makeLister({});
  const r = await collectFiles('/a', [null, {}, { name: 'no-id' }, F('f1', 'real.mkv')], lister);
  check('只保留有 id 的文件', r.files.length === 1 && r.files[0].name === 'real.mkv');
}

console.log('\n=== 8. 百度风格：条目自带绝对 path 时优先用它 ===');
{
  const lister = makeLister({});
  const r = await collectFiles('/来自PanSou', [{ id: 'x', name: 'a.mkv', is_dir: false, size: 5, path: '/来自PanSou/子/a.mkv' }], lister);
  check('沿用条目自带 path', r.files[0].path === '/来自PanSou/子/a.mkv', r.files[0].path);
}

console.log('\n================ 合计 ' + pass + ' 通过 / ' + fail + ' 失败 ================\n');
rmSync(outDir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
