/**
 * 转存驱动：百度网盘
 * ========================
 * 链路：
 *   解析分享  GET /s/1<surl> 页面里取 shareid / share_uk
 *             POST share/verify（带提取码换 randsk，匿名可用，已实测）
 *             GET  share/list（列分享根目录，**必须带登录 Cookie**，匿名会回 9019 need verify）
 *   转存      POST share/transfer（异步任务，回 taskid）
 *   自己网盘  api/list（列目录）/ api/create（建目录）
 *   下载直链  d.pcs.baidu.com locatedownload → dlink（下载 dlink 必须带 netdisk UA + Cookie）
 *
 * 已实测（2026-11，真实链接）的报文形状：
 *   - 页面里有 `"shareid":32756894009` 与 `"share_uk":4032843623`
 *   - verify 成功 `{errno:0, randsk:"..."}`，同时下发 Set-Cookie: BDCLND=<randsk>
 *   - 分享被取消 errno -21「来晚啦，该分享已被取消」
 *   - 未登录调用 transfer errno -6「账户已过期，重新登陆」
 *
 * ⚠️ 需要登录 Cookie 的步骤（列目录 / 转存 / 直链）只能用真实账号验证，
 *    错误码语义取自百度网盘网页版的通用约定；实测若有出入，以本文件为准修订。
 */
import { TransferDriver } from './quark';
import {
  ShareItem,
  PreviewResult,
  SaveResult,
  ListResult,
  OwnEntry,
  LinkResult,
  TransferError
} from './types';
import {
  BROWSER_UA,
  httpFetch,
  formBody,
  cookieValue,
  applySetCookies,
  splitDirPath,
  joinDirPath,
  sanitizeFileName
} from './util';

const BASE = 'https://pan.baidu.com';
/** 网页版接口的公共参数 */
const COMMON = 'channel=chunlei&web=1&app_id=250528&clienttype=0';
/** 下载 dlink 时必须伪装成官方客户端，否则 403 */
const NETDISK_UA = 'netdisk;7.0.0.0;android-android';

/** 转存异步任务最多等多久 */
const TASK_WAIT_MS = 6000;
const TASK_POLL_MS = 600;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function parseBaiduSurl(url: string): string {
  const m = String(url || '').match(
    /baidu\.com\/(?:s\/1|s\/|share\/init\?surl=)([A-Za-z0-9_-]+)/i
  );
  return m && m[1] ? m[1] : '';
}

function needLogin(errno: number): boolean {
  return errno === -6 || errno === 111 || errno === 9019;
}

/** 列分享目录失败的语义 */
function shareListError(errno: number, message: string, pwdGiven: boolean): TransferError {
  if (needLogin(errno)) {
    return new TransferError(
      'need_login',
      errno === 9019
        ? '百度要求安全验证，请重新登录百度网盘网页版后复制完整 Cookie（需包含 BDUSS）'
        : '百度登录已失效，请重新获取 Cookie',
      401
    );
  }
  if (errno === -9) {
    return pwdGiven
      ? new TransferError('wrong_password', '提取码错误，请核对后重试')
      : new TransferError('need_password', '该分享需要提取码');
  }
  if (errno === -21) return new TransferError('share_cancelled', message || '该分享已被取消');
  if ([-7, 105, 110, 112, 113, 2, 4].indexOf(errno) >= 0) {
    return new TransferError('share_not_found', message || '链接不存在或已失效');
  }
  return new TransferError('upstream_error', `[${errno}] ${message}`, 502);
}

class Session {
  /** 用户提供的登录 Cookie（至少含 BDUSS） */
  private base: string;
  /** verify 换到的分享访问凭据，随请求以 BDCLND 下发 */
  private randsk = '';
  rotated = false;

  constructor(credential: string) {
    let cred = String(credential || '').trim();
    if (cred && cred.indexOf('=') < 0) cred = 'BDUSS=' + cred;
    this.base = cred;
  }

  get hasCookie(): boolean {
    return !!cookieValue(this.base, 'BDUSS');
  }

  get currentCookie(): string {
    return this.base;
  }

  requireCookie(): void {
    if (!this.hasCookie) throw new TransferError('need_login', '尚未填写百度网盘 Cookie（需包含 BDUSS）', 401);
  }

  private fullCookie(): string {
    return this.randsk ? `${this.base}; BDCLND=${this.randsk}` : this.base;
  }

  async call(
    method: 'GET' | 'POST',
    url: string,
    body?: Record<string, string>,
    withCookie = true
  ): Promise<{ status: number; json: any; text: string }> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      Referer: BASE + '/',
      'User-Agent': BROWSER_UA
    };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    if (withCookie && this.hasCookie) headers['Cookie'] = this.fullCookie();
    const r = await httpFetch(url, { method, headers, body: body ? formBody(body) : undefined });
    // verify 接口会把 randsk 写进 Set-Cookie: BDCLND，这里同步记下来
    const next = applySetCookies(this.base, r.setCookies, ['BDUSS', 'STOKEN']);
    if (next !== this.base) {
      this.base = next;
      this.rotated = true;
    }
    return { status: r.status, json: r.json, text: r.text };
  }

  /** 打开分享页，取 shareid / share_uk（页面里直接内嵌） */
  async shareInfo(surl: string): Promise<{ shareid: string; uk: string }> {
    const page = await this.call('GET', `${BASE}/s/1${surl}`);
    const html = page.text || '';
    const pick = (k: string) => {
      const m = html.match(new RegExp(`"${k}"\\s*:\\s*"?(-?\\d+)`));
      return m && m[1] ? m[1] : '';
    };
    const shareid = pick('shareid');
    const uk = pick('share_uk') || pick('uk');
    if (!shareid || !uk) {
      if (/已经被取消|链接不存在|分享已失效|啊哦，链接出错了/.test(html)) {
        throw new TransferError('share_cancelled', '该分享已被取消或不存在');
      }
      throw new TransferError('upstream_error', '无法从分享页取到 shareid，请在浏览器里确认链接可打开', 502);
    }
    return { shareid, uk };
  }

  /** 用提取码换 randsk（BDCLND） */
  async verify(surl: string, pwd: string): Promise<void> {
    const t = Math.floor(Date.now() / 1000);
    const r = await this.call(
      'POST',
      `${BASE}/share/verify?surl=${encodeURIComponent(surl)}&t=${t}&${COMMON}`,
      { pwd, vcode: '', vcode_str: '' },
      false
    );
    const errno = Number(r.json?.errno);
    if (r.json && errno === 0 && r.json.randsk) {
      this.randsk = String(r.json.randsk);
      return;
    }
    if (errno === -9) throw new TransferError('wrong_password', '提取码错误，请核对后重试');
    if (errno === -21) throw new TransferError('share_cancelled', '该分享已被取消');
    if (errno === -12) throw new TransferError('upstream_error', '百度要求输入验证码，请稍后重试', 502);
    throw new TransferError('upstream_error', `[${r.json?.errno ?? r.status}] ${r.json?.err_msg || r.json?.show_msg || '校验提取码失败'}`, 502);
  }

  /** 列分享根目录 */
  async listShare(surl: string, pwdGiven: boolean): Promise<ShareItem[]> {
    const r = await this.call(
      'GET',
      `${BASE}/share/list?shorturl=${encodeURIComponent(surl)}&root=1&page=1&num=200&order=name&desc=0&showempty=0&${COMMON}`
    );
    const errno = Number(r.json?.errno);
    if (r.status !== 200 || !r.json || errno !== 0) {
      throw shareListError(isFinite(errno) ? errno : r.status, String(r.json?.show_msg || r.json?.errmsg || ''), pwdGiven);
    }
    return (Array.isArray(r.json.list) ? r.json.list : []).map((f: any) => ({
      id: String(f.fs_id || ''),
      name: String(f.server_filename || f.name || ''),
      is_dir: Number(f.isdir) === 1,
      size: Number(f.size) || 0
    }));
  }

  async bdstoken(): Promise<string> {
    const r = await this.call(
      'GET',
      `${BASE}/api/gettemplatevariable?fields=${encodeURIComponent('["bdstoken"]')}&${COMMON}`
    );
    const errno = Number(r.json?.errno);
    const token = r.json?.result?.bdstoken;
    if (needLogin(errno) || !token) {
      throw new TransferError('need_login', '百度登录已失效，请重新获取 Cookie', 401);
    }
    return String(token);
  }

  /** 列自己网盘某目录 */
  async ownList(dirPath: string): Promise<OwnEntry[]> {
    const r = await this.call(
      'GET',
      `${BASE}/api/list?dir=${encodeURIComponent(dirPath || '/')}&${COMMON}&order=name&desc=0&showempty=0&page=1&num=1000`
    );
    const errno = Number(r.json?.errno);
    if (needLogin(errno)) {
      throw new TransferError('need_login', '百度登录已失效，请重新获取 Cookie', 401);
    }
    if (errno === -9) throw new TransferError('dir_failed', `目录「${dirPath}」不存在`, 404);
    if (r.status !== 200 || !r.json || errno !== 0) {
      throw new TransferError('upstream_error', `[${errno}] ${r.json?.show_msg || r.json?.errmsg || '列目录失败'}`, 502);
    }
    return (Array.isArray(r.json.list) ? r.json.list : []).map((f: any) => ({
      id: String(f.fs_id || ''),
      name: String(f.server_filename || ''),
      is_dir: Number(f.isdir) === 1,
      size: Number(f.size) || 0,
      path: String(f.path || (dirPath === '/' ? '/' : dirPath + '/') + (f.server_filename || '')),
      updated_at: Number(f.mtime || f.ctime || 0) || undefined
    }));
  }

  /** 逐级确保目录存在（只查找与创建，不覆盖） */
  async ensureDir(path: string): Promise<string> {
    const token = await this.bdstoken();
    let cur = '';
    for (const seg of splitDirPath(path)) {
      cur = cur + '/' + seg;
      const hit = (await this.ownList(cur)).find(e => e.name === seg && e.is_dir);
      if (hit) continue;
      const r = await this.call('POST', `${BASE}/api/create?a=commit&${COMMON}&bdstoken=${encodeURIComponent(token)}`, {
        path: cur,
        isdir: '1',
        block_list: '[]'
      });
      const errno = Number(r.json?.errno);
      // -8 = 同名目录已存在（并发或刚建过），视为成功；其余按语义报错
      if (errno !== 0 && errno !== -8) {
        if (needLogin(errno)) throw new TransferError('need_login', '百度登录已失效，请重新获取 Cookie', 401);
        throw new TransferError('dir_failed', `创建目录「${cur}」失败：${r.json?.show_msg || errno}`, 502);
      }
    }
    return splitDirPath(path).length ? '/' + splitDirPath(path).join('/') : '/';
  }
}

export function createBaiduDriver(): TransferDriver {
  return {
    async preview(url, password, credential) {
      const surl = parseBaiduSurl(url);
      if (!surl) throw new TransferError('invalid_url', '无法识别百度网盘分享链接');

      const s = new Session(credential);
      const pwd = String(password || '').trim();
      const info = await s.shareInfo(surl);
      if (pwd) await s.verify(surl, pwd);

      try {
        s.requireCookie();
        const items = await s.listShare(surl, !!pwd);
        return { kind: 'baidu', share_id: surl, title: items[0]?.name || '', items, need_password: false };
      } catch (e) {
        if (e instanceof TransferError && e.code === 'need_password') {
          return { kind: 'baidu', share_id: surl, title: '', items: [], need_password: true };
        }
        throw e;
      }
    },

    async save(url, password, credential, toPath, ids, subDir) {
      const surl = parseBaiduSurl(url);
      if (!surl) throw new TransferError('invalid_url', '无法识别百度网盘分享链接');

      const s = new Session(credential);
      s.requireCookie();
      const pwd = String(password || '').trim();
      const info = await s.shareInfo(surl);
      if (pwd) await s.verify(surl, pwd);

      const items = await s.listShare(surl, !!pwd);
      if (items.length === 0) throw new TransferError('share_not_found', '分享里没有可转存的文件');

      const want = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null;
      const picked = want ? items.filter(i => want.has(i.id)) : items;
      if (picked.length === 0) throw new TransferError('bad_request', '没有选中任何要转存的条目');

      // 百度分享的标题就是「根目录里唯一那个条目的名字」：单个文件夹时直接落到目标目录，
      // 不再套一层同名子目录；多个条目 / 单个文件时才新建一层。
      let destPath = joinDirPath(toPath);
      const singleFolder = picked.length === 1 && picked[0].is_dir;
      if (subDir && !singleFolder) {
        destPath = joinDirPath(toPath, sanitizeFileName(items[0]?.name) || surl);
      }
      await s.ensureDir(destPath);

      const before = new Set((await s.ownList(destPath)).map(e => e.id));
      const token = await s.bdstoken();

      const tr = await s.call(
        'POST',
        `${BASE}/share/transfer?shareid=${encodeURIComponent(info.shareid)}&from=${encodeURIComponent(info.uk)}&ondup=newcopy&async=1&${COMMON}&bdstoken=${encodeURIComponent(token)}`,
        { fsidlist: JSON.stringify(picked.map(i => i.id)), path: destPath }
      );
      const errno = Number(tr.json?.errno);
      const msg = String(tr.json?.show_msg || tr.json?.errmsg || '');
      if (needLogin(errno)) throw new TransferError('need_login', '百度登录已失效，请重新获取 Cookie', 401);
      if (errno === -33) {
        throw new TransferError('save_failed', '转存失败：可能是网盘容量不足，或今日转存次数已达上限', 502);
      }
      if (errno === -7 || errno === -21) throw new TransferError('share_cancelled', msg || '分享已失效');
      if (errno === 4 || errno === 105 || errno === 110) throw new TransferError('share_not_found', msg || '分享文件不存在');
      if (errno === 12 || errno === -30) {
        // 12 = 相同任务正在进行；-30 = 已转存过。都按「已在处理」往下走，靠目录差异出结果
      } else if (errno !== 0) {
        throw new TransferError('save_failed', `转存失败：${msg || ('errno ' + errno)}`, 502);
      }

      const taskId = tr.json?.taskid || tr.json?.task_id || tr.json?.extra?.taskid || '';
      let finished = !taskId;
      if (taskId) {
        const deadline = Date.now() + TASK_WAIT_MS;
        while (Date.now() < deadline) {
          await sleep(TASK_POLL_MS);
          const q = await s.call('GET', `${BASE}/share/taskquery?taskid=${encodeURIComponent(String(taskId))}&${COMMON}`);
          const resp = q.json?.response || q.json || {};
          const st = resp.taskstatus;
          // taskstatus: 0 进行中；非 0 视为已结束（成功与否靠目录差异判定）
          if (st === undefined || Number(st) !== 0) {
            finished = true;
            break;
          }
        }
      }

      let saved = (await s.ownList(destPath)).filter(e => !before.has(e.id)).map(e => ({ ...e }));
      if (saved.length === 0) {
        await sleep(1500);
        saved = (await s.ownList(destPath)).filter(e => !before.has(e.id)).map(e => ({ ...e }));
      }
      if (saved.length === 0) {
        throw new TransferError(
          'save_failed',
          '转存任务已提交，但没有在目标目录里看到新文件。请稍后到百度网盘确认，或更换目标目录重试',
          504
        );
      }

      const out: SaveResult = { kind: 'baidu', path: destPath, items: saved };
      if (!finished) out.task_pending = true;
      if (s.rotated) out.credential = s.currentCookie;
      return out;
    },

    async list(credential, path) {
      const s = new Session(credential);
      s.requireCookie();
      const segs = splitDirPath(path);
      const target = segs.length ? '/' + segs.join('/') : '/';
      const out: ListResult = { path: target, entries: await s.ownList(target) };
      if (s.rotated) out.credential = s.currentCookie;
      return out;
    },

    async link(credential, id, path) {
      const s = new Session(credential);
      s.requireCookie();
      if (!id) throw new TransferError('bad_request', '缺少文件 id');

      // locatedownload 按完整路径定位；调用方没带路径时用 filemetas 查一次
      let filePath = String(path || '');
      if (!filePath) {
        const meta = await s.call('GET', `${BASE}/api/filemetas?dlist=${encodeURIComponent('[' + id + ']')}&${COMMON}&web=1`);
        filePath = String(meta.json?.info?.[0]?.path || '');
      }
      if (!filePath) throw new TransferError('link_failed', '找不到该文件在网盘中的路径', 404);

      const dl = await s.call(
        'GET',
        `https://d.pcs.baidu.com/rest/2.0/pcs/file?method=locatedownload&app_id=250528&ver=4.0&dtype=0&essspeed=0&is_dlink=1&clienttype=12&dp-logid=${Date.now()}&type=dlink&cache=0&check_blue=1&path=${encodeURIComponent(filePath)}`
      );
      const dlink: string =
        (Array.isArray(dl.json?.dlink) && dl.json.dlink[0]) ||
        (Array.isArray(dl.json?.dlink_by_api) && dl.json.dlink_by_api[0]) ||
        '';
      if (!dlink) {
        throw new TransferError('link_failed', '百度没有返回下载地址（文件可能违规或账号被风控）', 502);
      }
      const name = filePath.split('/').pop() || '';
      return {
        url: dlink,
        // dlink 只认官方客户端 UA，且必须带 Cookie：由 Worker 代理下载
        headers: { Cookie: s.currentCookie, 'User-Agent': NETDISK_UA, Referer: BASE + '/' },
        name,
        size: Number(dl.json?.size) || 0
      };
    }
  };
}
