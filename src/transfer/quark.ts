/**
 * 转存驱动：夸克网盘 / UC 网盘
 * ========================
 * 两者是同一套接口家族（UC 是夸克同源产品），只在 **API 域名** 与 **pr 参数** 上不同：
 *
 * | | 夸克 | UC |
 * | :-- | :-- | :-- |
 * | API | `drive-pc.quark.cn/1/clouddrive` | `pc-api.uc.cn/1/clouddrive` |
 * | pr | `ucpro` | `UCBrowser` |
 * | 登录 Cookie | `__puus` | `__puus` |
 *
 * 链路：
 *   解析分享  share/sharepage/token → share/sharepage/detail   （匿名即可）
 *   转存      share/sharepage/save → task 轮询                   （需要 Cookie）
 *   自己网盘  file/sort（列目录）/ file（建目录）/ file/download（取直链）
 *
 * 接口形状参照 OpenList-Worker 的 quark 驱动，并用真实分享链接实测过匿名部分：
 *   - token 成功：`{status:200, code:0, data:{stoken}}`
 *   - detail 成功：`data.share.title` + `data.list[].{fid,file_name,dir,file,size}`
 *   - 单文件分享 detail 的 list 为空，条目在 `data.share.first_fid`
 *   - 失效码：41004 不存在 / 41012 已取消 / 41031 分享者被封 / 41001·41002 需要或错误提取码
 */
import {
  ShareItem,
  PreviewResult,
  SaveResult,
  ListResult,
  OwnEntry,
  LinkResult,
  TransferError,
  TransferErrorCode
} from './types';
import {
  BROWSER_UA,
  httpFetch,
  cookieValue,
  applySetCookies,
  unescapeHtml,
  splitDirPath,
  joinDirPath,
  sanitizeFileName
} from './util';

/** 所有网盘驱动都实现这一套方法，由 index.ts 的注册表统一调度 */
export interface TransferDriver {
  preview(url: string, password: string, credential: string): Promise<PreviewResult>;
  save(
    url: string,
    password: string,
    credential: string,
    toPath: string,
    ids: string[],
    subDir: boolean
  ): Promise<SaveResult>;
  list(credential: string, path: string): Promise<ListResult>;
  link(credential: string, id: string, path: string): Promise<LinkResult>;
}

interface Variant {
  api: string;
  pr: string;
  site: string;
}

const VARIANTS: Record<string, Variant> = {
  quark: { api: 'https://drive-pc.quark.cn/1/clouddrive', pr: 'ucpro', site: 'https://pan.quark.cn' },
  uc: { api: 'https://pc-api.uc.cn/1/clouddrive', pr: 'UCBrowser', site: 'https://drive.uc.cn' }
};

const SHARE_ID_RE: Record<string, RegExp> = {
  quark: /quark\.cn\/s\/([A-Za-z0-9_-]+)/i,
  uc: /drive\.uc\.cn\/s\/([A-Za-z0-9_-]+)/i
};

/** 这些 Cookie 会被服务端不定期轮换，响应里的新值要回写给前端 */
const ROTATING_COOKIES = ['__puus', '__pus'];

/** 转存任务最多等多久（毫秒）与轮询间隔 */
const TASK_WAIT_MS = 9000;
const TASK_POLL_MS = 500;

/** 自己网盘列目录每页条数（接口对过大的 _size 会静默压小，保守取 100 并翻页） */
const PAGE_SIZE = 100;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function parseShareId(kind: string, url: string): string {
  const m = String(url || '').match(SHARE_ID_RE[kind] || /^$/);
  return m && m[1] ? m[1] : '';
}

/** 把接口返回的 code/message 翻译成带语义的错误 */
function translateError(json: any, status: number, passcodeGiven: boolean): TransferError {
  const code = json && typeof json.code !== 'undefined' ? Number(json.code) : status;
  const message = String((json && (json.message || json.msg)) || '') || `HTTP ${status}`;

  if (status === 401 || /登录|login|not\s*login/i.test(message)) {
    return new TransferError('need_login', '网盘登录已失效，请重新获取 Cookie', 401);
  }
  if (code === 41001 || code === 41002) {
    return passcodeGiven
      ? new TransferError('wrong_password', '提取码错误，请核对后重试')
      : new TransferError('need_password', '该分享需要提取码');
  }
  if (code === 41004 || code === 41027) {
    return new TransferError('share_not_found', message || '分享不存在');
  }
  if ([41006, 41008, 41010, 41012, 41013, 31001].indexOf(code) >= 0) {
    // 同一批失效码里「不存在」与「被取消」并存：按文案细分，提示才准确
    if (/不存在|已删除|已过期/.test(message)) {
      return new TransferError('share_not_found', message);
    }
    return new TransferError('share_cancelled', message || '分享已失效或被取消');
  }
  if (code === 41031) {
    return new TransferError('share_forbidden', message || '分享者账号受限，链接无法查看');
  }
  return new TransferError('upstream_error', `[${code}] ${message}`, 502);
}

/** 一次会话：持有 Cookie，负责发请求并把轮换后的 Cookie 记下来 */
class Session {
  readonly kind: string;
  readonly conf: Variant;
  private cookie: string;
  /** Cookie 是否在本次会话里被服务端刷新过 */
  rotated = false;

  constructor(kind: string, credential: string) {
    this.kind = kind;
    this.conf = VARIANTS[kind];
    let cred = String(credential || '').trim();
    // 允许只贴 __puus 的值：没有等号就当作单个 Cookie 值
    if (cred && cred.indexOf('=') < 0) cred = '__puus=' + cred;
    this.cookie = cred;
  }

  get currentCookie(): string {
    return this.cookie;
  }

  get hasCookie(): boolean {
    return !!cookieValue(this.cookie, '__puus');
  }

  requireCookie(): void {
    if (!this.hasCookie) {
      throw new TransferError('need_login', '尚未填写网盘 Cookie', 401);
    }
  }

  async request(
    path: string,
    method: 'GET' | 'POST',
    query: Record<string, string> = {},
    body?: any,
    withCookie = true
  ): Promise<{ status: number; json: any }> {
    const u = new URL(this.conf.api + path);
    u.searchParams.set('pr', this.conf.pr);
    u.searchParams.set('fr', 'pc');
    u.searchParams.set('uc_param_str', '');
    for (const k of Object.keys(query)) u.searchParams.set(k, query[k]);

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      Referer: this.conf.site + '/',
      Origin: this.conf.site,
      'User-Agent': BROWSER_UA
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withCookie && this.hasCookie) headers['Cookie'] = this.cookie;

    const r = await httpFetch(u.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    // 服务端会不定期下发新的 __puus / __pus：不回写的话旧 Cookie 很快就会失效
    const next = applySetCookies(this.cookie, r.setCookies, ROTATING_COOKIES);
    if (next !== this.cookie) {
      this.cookie = next;
      this.rotated = true;
    }

    return { status: r.status, json: r.json };
  }
}

/** 把 detail 返回的条目归一化 */
function toItem(f: any): ShareItem {
  const isDir = f.dir === true || f.file === false;
  return {
    id: String(f.fid || ''),
    name: unescapeHtml(f.file_name || f.name || ''),
    is_dir: isDir,
    size: Number(f.size) || 0
  };
}

/** 解析分享：拿 stoken 并列出根目录条目（匿名） */
async function resolveShare(
  s: Session,
  pwdId: string,
  passcode: string
): Promise<{ stoken: string; title: string; items: ShareItem[] }> {
  const tok = await s.request(
    '/share/sharepage/token',
    'POST',
    {},
    { pwd_id: pwdId, passcode: passcode || '' },
    false
  );
  if (tok.status !== 200 || Number(tok.json?.code) !== 0 || !tok.json?.data?.stoken) {
    throw translateError(tok.json, tok.status, !!passcode);
  }
  const stoken: string = tok.json.data.stoken;

  const det = await s.request(
    '/share/sharepage/detail',
    'GET',
    {
      pwd_id: pwdId,
      stoken,
      pdir_fid: '0',
      force: '0',
      _page: '1',
      _size: String(PAGE_SIZE),
      _fetch_banner: '0',
      _fetch_share: '1',
      _fetch_total: '1',
      _sort: 'file_type:asc,file_name:asc'
    },
    undefined,
    false
  );
  if (det.status !== 200 || Number(det.json?.code) !== 0) {
    throw translateError(det.json, det.status, !!passcode);
  }

  const data = det.json.data || {};
  const share = data.share || {};
  let items: ShareItem[] = (Array.isArray(data.list) ? data.list : []).map(toItem);

  // 单文件分享：detail 不返回 list，唯一的条目就是 share.first_fid
  if (items.length === 0 && share.first_fid) {
    items = [{ id: String(share.first_fid), name: unescapeHtml(share.title || pwdId), is_dir: false, size: Number(share.size) || 0 }];
  }

  return { stoken, title: unescapeHtml(share.title || items[0]?.name || pwdId), items };
}

/** 列出自己网盘某目录下的条目（自动翻页） */
async function ownList(s: Session, pdirFid: string): Promise<OwnEntry[]> {
  const out: OwnEntry[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await s.request('/file/sort', 'GET', {
      pdir_fid: pdirFid,
      _page: String(page),
      _size: String(PAGE_SIZE),
      _fetch_total: '1',
      fetch_all_file: '1'
    });
    if (r.status !== 200 || Number(r.json?.code) !== 0) throw translateError(r.json, r.status, false);
    const list: any[] = (r.json.data && r.json.data.list) || [];
    for (const f of list) {
      out.push({ ...toItem(f), updated_at: Number(f.l_updated_at || f.updated_at || 0) || undefined });
    }
    if (list.length < PAGE_SIZE) break;
  }
  return out;
}

/** 确保目录路径存在并返回最末级目录的 fid（逐级查找，找不到就创建） */
async function ensureDir(s: Session, path: string): Promise<{ fid: string; path: string }> {
  let fid = '0';
  const segs = splitDirPath(path);
  for (const seg of segs) {
    const children = await ownList(s, fid);
    const hit = children.find(c => c.name === seg);
    if (hit) {
      if (!hit.is_dir) {
        throw new TransferError('dir_failed', `「${seg}」已存在同名文件，无法作为目录`, 409);
      }
      fid = hit.id;
      continue;
    }
    const mk = await s.request(
      '/file',
      'POST',
      {},
      { dir_init_lock: false, dir_path: '', file_name: seg, pdir_fid: fid }
    );
    if (mk.status !== 200 || Number(mk.json?.code) !== 0) {
      throw translateError(mk.json, mk.status, false);
    }
    const d = mk.json.data;
    const newFid = String((Array.isArray(d) ? d[0]?.fid : d?.fid) || '');
    if (!newFid) throw new TransferError('dir_failed', `创建目录「${seg}」失败`, 502);
    fid = newFid;
  }
  return { fid, path: segs.length ? '/' + segs.join('/') : '/' };
}

export function createQuarkUcDriver(kind: 'quark' | 'uc'): TransferDriver {
  return {
    async preview(url, password) {
      const pwdId = parseShareId(kind, url);
      if (!pwdId) throw new TransferError('invalid_url', '无法识别分享链接');

      const s = new Session(kind, '');
      try {
        const share = await resolveShare(s, pwdId, String(password || '').trim());
        return {
          kind,
          share_id: pwdId,
          title: share.title,
          items: share.items,
          need_password: false
        };
      } catch (e) {
        // 没给提取码 / 提取码不对：仍要把「需要提取码」告诉前端，由前端提示补充
        if (e instanceof TransferError && e.code === 'need_password') {
          return { kind, share_id: pwdId, title: '', items: [], need_password: true };
        }
        throw e;
      }
    },

    async save(url, password, credential, toPath, ids, subDir) {
      const pwdId = parseShareId(kind, url);
      if (!pwdId) throw new TransferError('invalid_url', '无法识别分享链接');

      const s = new Session(kind, credential);
      s.requireCookie();

      const share = await resolveShare(s, pwdId, String(password || '').trim());
      if (share.items.length === 0) throw new TransferError('share_not_found', '分享里没有可转存的文件');

      const want = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null;
      const picked = want ? share.items.filter(i => want.has(i.id)) : share.items;
      if (picked.length === 0) throw new TransferError('bad_request', '没有选中任何要转存的条目');

      // 目标目录：多个条目、或单个文件时，再套一层以分享标题命名的子目录，
      // 这样每部剧/每个资源各占一个文件夹，不会全部摊在同一个目录里。
      let destPath = joinDirPath(toPath);
      const singleFolder = picked.length === 1 && picked[0].is_dir;
      if (subDir && !singleFolder) {
        const sub = sanitizeFileName(share.title) || pwdId;
        destPath = joinDirPath(toPath, sub);
      }
      const dest = await ensureDir(s, destPath);

      // 转存前先记下目标目录里已有的条目，结束后用「差异」得到真正落盘的条目 ——
      // 比依赖任务回包里的字段稳：各网盘任务状态字段经常变，目录内容不会骗人。
      const before = new Set((await ownList(s, dest.fid)).map(c => c.id));

      const res = await s.request('/share/sharepage/save', 'POST', {}, {
        pwd_id: pwdId,
        stoken: share.stoken,
        to_pdir_fid: dest.fid,
        fid_list: picked.map(i => i.id),
        pdir_fid: '0',
        scene: 'link'
      });
      if (res.status !== 200 || Number(res.json?.code) !== 0) {
        throw translateError(res.json, res.status, !!password);
      }

      const taskId = res.json?.data?.task_id;
      let finished = !taskId;
      let failure = '';
      if (taskId) {
        const deadline = Date.now() + TASK_WAIT_MS;
        while (Date.now() < deadline) {
          await sleep(TASK_POLL_MS);
          const t = await s.request('/task', 'GET', { task_id: String(taskId) });
          const d = t.json?.data;
          const st = d?.status;
          // 实测过 success 的回包带 save_as；状态值各版本不一，两种信号都认
          if (st === 2 || st === 'ok' || st === 'success' || st === 'finished' || (st === undefined && d?.save_as)) {
            finished = true;
            break;
          }
          if (st === 'error' || st === 'failed' || st === 3) {
            failure = String(d?.title || d?.message || t.json?.message || '');
            break;
          }
          // 0 / 1 / 'running'：还在转，继续等
        }
      }

      const after = await ownList(s, dest.fid);
      const saved = after.filter(c => !before.has(c.id)).map(c => ({ ...c }));
      // 任务刚提交、目录还没刷新出来时，再给一次机会
      if (saved.length === 0 && !failure) {
        await sleep(1200);
        const again = await ownList(s, dest.fid);
        for (const c of again) if (!before.has(c.id)) saved.push({ ...c });
      }

      if (saved.length === 0) {
        if (failure) throw new TransferError('save_failed', failure, 502);
        throw new TransferError(
          'save_failed',
          '转存任务已提交，但没有在目标目录里看到新文件。请稍后到网盘确认，或更换目标目录重试',
          504
        );
      }

      const out: SaveResult = { kind, path: dest.path, items: saved };
      if (!finished) out.task_pending = true;
      if (s.rotated) out.credential = s.currentCookie;
      return out;
    },

    async list(credential, path) {
      const s = new Session(kind, credential);
      s.requireCookie();
      const target = splitDirPath(path);
      let fid = '0';
      // 列目录只查找、不创建：路径不存在要如实告诉用户
      for (const seg of target) {
        const children = await ownList(s, fid);
        const hit = children.find(c => c.name === seg);
        if (!hit || !hit.is_dir) throw new TransferError('dir_failed', `目录「${seg}」不存在`, 404);
        fid = hit.id;
      }
      const out: ListResult = {
        path: target.length ? '/' + target.join('/') : '/',
        entries: await ownList(s, fid)
      };
      if (s.rotated) out.credential = s.currentCookie;
      return out;
    },

    async link(credential, id) {
      const s = new Session(kind, credential);
      s.requireCookie();
      if (!id) throw new TransferError('bad_request', '缺少文件 id');
      const r = await s.request('/file/download', 'POST', {}, { fids: [String(id)] });
      if (r.status !== 200 || Number(r.json?.code) !== 0) {
        const err: TransferError = translateError(r.json, r.status, false);
        if (err.code === 'upstream_error') err.code = 'link_failed' as TransferErrorCode;
        throw err;
      }
      const item = Array.isArray(r.json.data) ? r.json.data[0] : r.json.data;
      const url = item?.download_url;
      if (!url) throw new TransferError('link_failed', '网盘没有返回下载地址（该文件可能不允许下载）', 502);
      // 夸克/UC 的直链校验 Cookie 与 Referer，必须由 Worker 代理下载，浏览器直接打开会 403
      return {
        url,
        headers: { Cookie: s.currentCookie, Referer: s.conf.site + '/', 'User-Agent': BROWSER_UA },
        name: unescapeHtml(item?.file_name || ''),
        size: Number(item?.size) || 0
      };
    }
  };
}
