/**
 * 转存后的文件展开（V1.6.1）
 * ========================
 * 转存整文件夹时，网盘返回的落盘条目里只有文件夹本身，要再列一次目录才知道里面是什么。
 * 这里把「按目录树递归找文件」抽成纯逻辑，列目录的动作由调用方注入（ListFn），
 * 好处是能不连网盘就测边界：层级、文件数、列目录次数三个上限都不能被打满。
 *
 * 上限存在的理由：Cloudflare Workers 单请求最多 50 个子请求，
 * 一个「整季 60 集 + 多级目录」的分享如果不限制，会把配额直接吃光。
 */
import { joinDirPath } from './util';

export interface CollectFile {
  id: string;
  name: string;
  path: string;
  size: number;
}

export interface CollectResult {
  files: CollectFile[];
  /** 触到任一上限就为 true，前端据此提示「只列出了一部分」 */
  truncated: boolean;
  /** 读失败的子目录个数（风控 / 权限），不阻断整体流程 */
  skipped: number;
}

export interface CollectOptions {
  maxFiles?: number;
  maxDepth?: number;
  maxListCalls?: number;
}

export type ListFn = (path: string) => Promise<{ path?: string; entries: any[] }>;

const DEFAULT_MAX_FILES = 60;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_LIST_CALLS = 10;

export async function collectFiles(
  basePath: string,
  entries: any[],
  listDir: ListFn,
  opts: CollectOptions = {}
): Promise<CollectResult> {
  const maxFiles = opts.maxFiles || DEFAULT_MAX_FILES;
  const maxDepth = opts.maxDepth || DEFAULT_MAX_DEPTH;
  const maxListCalls = opts.maxListCalls || DEFAULT_MAX_LIST_CALLS;

  const files: CollectFile[] = [];
  let listCalls = 0;
  let truncated = false;
  let skipped = 0;

  const walk = async (list: any[], parentPath: string, depth: number): Promise<void> => {
    for (const e of list) {
      if (!e || !e.id) continue;

      if (!e.is_dir) {
        if (files.length >= maxFiles) {
          truncated = true;
          continue;
        }
        files.push({
          id: String(e.id),
          name: String(e.name || ''),
          // 百度按完整路径定位文件，路径必须保留；夸克只认 id，带路径也无害
          path: String(e.path || joinDirPath(parentPath, e.name)),
          size: Number(e.size) || 0
        });
        continue;
      }

      // 目录：层级或列目录次数到顶就跳过（不是失败，只是没展开）
      if (depth >= maxDepth || listCalls >= maxListCalls) {
        truncated = true;
        skipped++;
        continue;
      }

      const dirPath = String(e.path || joinDirPath(parentPath, e.name));
      listCalls++;
      try {
        const r = await listDir(dirPath);
        await walk((r && r.entries) || [], (r && r.path) || dirPath, depth + 1);
      } catch (err) {
        skipped++;
      }
    }
  };

  await walk(entries || [], basePath, 1);
  return { files, truncated, skipped };
}
