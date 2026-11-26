/**
 * 转存模块：通用 HTTP / Cookie / 路径工具
 * ========================
 * 只放各驱动都要用的纯函数与小包装，不夹带任何网盘业务逻辑。
 */
import { TransferError } from './types';

/** 浏览器 UA：各网盘网页版接口对非浏览器 UA 的容忍度不一致，统一伪装成桌面 Chrome */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 单次上游请求的默认超时 */
export const DEFAULT_TIMEOUT_MS = 15000;

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json: any;
  /** 响应里的全部 Set-Cookie（Workers / Node ≥ 20 都提供 getSetCookie） */
  setCookies: string[];
}

/**
 * 带超时的 fetch。
 * 网络层失败（断连 / 超时 / DNS）统一抛 `network_error`，驱动不必逐处 try/catch。
 */
export async function httpFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<HttpResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal, redirect: 'follow' });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    const h = res.headers as any;
    const setCookies: string[] =
      typeof h.getSetCookie === 'function'
        ? h.getSetCookie()
        : [res.headers.get('set-cookie')].filter((x): x is string => !!x);
    return { status: res.status, headers: res.headers, text, json, setCookies };
  } catch (e: any) {
    if (e && e.name === 'AbortError') {
      throw new TransferError('network_error', '网盘接口响应超时，请稍后重试', 504);
    }
    throw new TransferError('network_error', '无法连接网盘接口，请稍后重试', 502);
  } finally {
    clearTimeout(timer);
  }
}

export function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** 从 Cookie 串里取某个键的值（取不到返回空串） */
export function cookieValue(cookieStr: string, key: string): string {
  for (const raw of String(cookieStr || '').split(';')) {
    const part = raw.trim();
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() === key) return part.slice(idx + 1).trim();
  }
  return '';
}

/**
 * 用响应里的 Set-Cookie 回写本地 Cookie 串。
 * 只回写 `keys` 里列出的键 —— 其余（埋点、风控临时态）一律不碰，避免 Cookie 越滚越长。
 */
export function applySetCookies(cookieStr: string, setCookies: string[], keys: string[]): string {
  let out = String(cookieStr || '');
  for (const sc of setCookies || []) {
    const first = String(sc).split(';')[0];
    const idx = first.indexOf('=');
    if (idx <= 0) continue;
    const k = first.slice(0, idx).trim();
    if (keys.indexOf(k) < 0) continue;
    const v = first.slice(idx + 1).trim();
    if (!v) continue;
    out = setCookieValue(out, k, v);
  }
  return out;
}

export function setCookieValue(cookieStr: string, key: string, value: string): string {
  const parts = String(cookieStr || '')
    .split(';')
    .map(p => p.trim())
    .filter(Boolean);
  const prefix = key + '=';
  const idx = parts.findIndex(p => p.startsWith(prefix));
  if (idx >= 0) parts[idx] = prefix + value;
  else parts.push(prefix + value);
  return parts.join('; ');
}

export function unescapeHtml(str: string): string {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** 文件体积转可读文本 */
export function formatSize(n: number): string {
  const size = Number(n) || 0;
  if (size <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = size;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)) + ' ' + units[i];
}

/**
 * 把用户填写的目录路径规范化成段数组。
 * 规则：去掉首尾斜杠与空段，剔除文件系统非法字符，禁止 `.` / `..`。
 */
export function splitDirPath(path: string): string[] {
  const raw = String(path || '').replace(/\\/g, '/');
  const out: string[] = [];
  for (const seg of raw.split('/')) {
    const cleaned = seg
      .trim()
      .replace(/[\/:*?"<>|\u0000-\u001f]/g, '')
      .slice(0, 120);
    if (!cleaned || cleaned === '.' || cleaned === '..') continue;
    out.push(cleaned);
  }
  return out;
}

export function joinDirPath(path: string, extra?: string): string {
  const segs = splitDirPath(path);
  const tail = extra ? splitDirPath(extra) : [];
  const all = segs.concat(tail);
  return all.length ? '/' + all.join('/') : '/';
}

/** 分享标题里常见的一堆装饰符号，落成文件夹名前先去掉 */
export function sanitizeFileName(name: string): string {
  return splitDirPath(String(name || ''))[0] || '';
}
