/**
 * 转存模块（V1.6）：共享类型与错误定义
 * ========================
 * 「搜索结果 → 一键转存到自己网盘的指定目录 → 从网盘下载」这条链路里，
 * 各网盘驱动对外吐出的数据结构统一放在这里，Worker 路由层与前端只认这一套。
 */

/** 分享里的一个条目（文件或文件夹） */
export interface ShareItem {
  /** 网盘侧的条目 id：夸克/UC 为 fid，百度为 fs_id */
  id: string;
  name: string;
  is_dir: boolean;
  size: number;
}

/** 解析分享链接的结果 */
export interface PreviewResult {
  kind: string;
  share_id: string;
  /** 分享标题（分享者填写的标题，没有则用首个条目名兜底） */
  title: string;
  items: ShareItem[];
  /** 分享需要提取码，但本次没有给 */
  need_password: boolean;
  /**
   * 网盘在本次请求中**轮换**了凭据（夸克/UC 的 __puus 会不定期刷新）。
   * 返回新的凭据串，前端用它覆盖本地保存的旧值，否则旧 Cookie 过一阵就会失效。
   */
  credential?: string;
}

/** 转存结果 */
export interface SaveResult {
  kind: string;
  /** 资源最终落在自己网盘里的完整目录 */
  path: string;
  items: ShareItem[];
  credential?: string;
  /**
   * 网盘的转存任务在等待窗口内没有明确结束。
   * 此时 items 是「按目标目录前后差异」算出来的已落盘条目，仍然可用。
   */
  task_pending?: boolean;
}

/** 自己网盘里的一个条目 */
export interface OwnEntry extends ShareItem {
  /** 百度按完整路径定位文件，下载时需要带上 */
  path?: string;
  updated_at?: number;
}

export interface ListResult {
  path: string;
  entries: OwnEntry[];
  credential?: string;
}

/** 取到的下载直链（可能要求附带特定请求头才能拉到文件） */
export interface LinkResult {
  url: string;
  headers: Record<string, string>;
  name: string;
  size: number;
}

/** 驱动的能力描述：前端据此决定显示「转存」按钮还是「暂不支持」 */
export interface TransferCap {
  key: string;
  label: string;
  can_save: boolean;
  /** 凭据的中文名（夸克/UC/百度都是 Cookie） */
  credential_label: string;
  /** 取凭据时网页上真正需要的那个 Cookie 键名，供前端给出精准指引 */
  cookie_key: string;
  /** 凭据从哪个网页地址获取 */
  cookie_site: string;
  default_dir: string;
  /** 官方网页版地址：转存完成后「去网盘查看」用 */
  web_url: string;
  /** 免登录即可解析分享（百度必须带 Cookie 才能列目录） */
  anonymous_preview: boolean;
}

/** 统一错误码：前端据此给出针对性的提示文案 */
export type TransferErrorCode =
  | 'disabled'
  | 'invalid_url'
  | 'not_supported'
  | 'share_not_found'
  | 'share_cancelled'
  | 'share_forbidden'
  | 'need_password'
  | 'wrong_password'
  | 'need_login'
  | 'dir_failed'
  | 'save_failed'
  | 'link_failed'
  | 'upstream_error'
  | 'network_error'
  | 'bad_request';

export class TransferError extends Error {
  code: TransferErrorCode;
  status: number;
  constructor(code: TransferErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'TransferError';
    this.code = code;
    this.status = status;
  }
}
