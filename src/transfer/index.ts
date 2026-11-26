/**
 * 转存模块入口：驱动注册表 + 统一调度
 * ========================
 * Worker 路由层（src/index.ts 里的 /api/transfer/*）只调用这里导出的函数，
 * 不直接碰具体网盘。要新增一个网盘 = 写一个驱动 + 在 DRIVERS 里登记一行。
 *
 * 支持矩阵（V1.6）
 * | 网盘 | 解析分享 | 转存 | 取直链 | 说明 |
 * | :-- | :-- | :-- | :-- | :-- |
 * | 夸克 | 匿名 | ✓ | ✓ | Cookie 为 pan.quark.cn 的 __puus |
 * | UC   | 匿名 | ✓ | ✓ | 与夸克同族接口；Cookie 为 drive.uc.cn 的 __puus |
 * | 百度 | 需 Cookie | ✓ | ✓ | Cookie 需含 BDUSS；直链受会员状态与风控影响 |
 *
 * 阿里云盘 / 123 / 115 本期不做，原因都实测过，不是拍脑袋：
 *   - 阿里：分享文件可匿名列出，但取直链三个变体（alipan / aliyundrive / 加 Referer）均回 410 空包；
 *     转存需要网页版登录态签名，Workers 里无法稳定复现（OpenList-Worker 也只做只读挂载）。
 *   - 123 / 115：取到的真实样本分享全部已失效（5103 / 4100033），无活链接验证成功回包。
 */
import { TransferError, TransferCap, PreviewResult, SaveResult, ListResult, LinkResult } from './types';
import { TransferDriver, createQuarkUcDriver } from './quark';
import { createBaiduDriver } from './baidu';
import { identifyCloudType } from '../parser';

export { TransferError };

const DRIVERS: Record<string, TransferDriver> = {
  quark: createQuarkUcDriver('quark'),
  uc: createQuarkUcDriver('uc'),
  baidu: createBaiduDriver()
};

/** 能力表：由 /api/ui-config 下发给前端，前端据此决定哪些结果卡片显示「转存」 */
export const TRANSFER_CAPS: TransferCap[] = [
  {
    key: 'quark',
    label: '夸克网盘',
    can_save: true,
    credential_label: '夸克网盘 Cookie',
    cookie_key: '__puus',
    cookie_site: 'https://pan.quark.cn',
    default_dir: '/来自PanSou',
    web_url: 'https://pan.quark.cn/list',
    anonymous_preview: true
  },
  {
    key: 'uc',
    label: 'UC网盘',
    can_save: true,
    credential_label: 'UC网盘 Cookie',
    cookie_key: '__puus',
    cookie_site: 'https://drive.uc.cn',
    default_dir: '/来自PanSou',
    web_url: 'https://drive.uc.cn/list',
    anonymous_preview: true
  },
  {
    key: 'baidu',
    label: '百度网盘',
    can_save: true,
    credential_label: '百度网盘 Cookie',
    cookie_key: 'BDUSS',
    cookie_site: 'https://pan.baidu.com',
    default_dir: '/来自PanSou',
    web_url: 'https://pan.baidu.com/disk/main',
    anonymous_preview: false
  }
];

export function isTransferSupported(kind: string): boolean {
  return !!kind && !!DRIVERS[kind];
}

/**
 * 判定一条结果属于哪个可转存网盘。
 * 优先按链接本体识别（上游频道/插件常把网盘类型标错），其次才信调用方传入的 type。
 */
export function detectTransferKind(url: string, type?: string): string {
  const byUrl = String(identifyCloudType(url) || '');
  if (isTransferSupported(byUrl)) return byUrl;
  const byType = String(type || '');
  return isTransferSupported(byType) ? byType : '';
}

export function getDriver(kind: string): TransferDriver {
  const d = DRIVERS[kind];
  if (!d) throw new TransferError('not_supported', `「${kind || '该网盘'}」暂不支持转存`);
  return d;
}

/** 解析分享：列出分享里的文件，供用户勾选 */
export async function transferPreview(input: {
  kind: string;
  url: string;
  password?: string;
  credential?: string;
}): Promise<PreviewResult> {
  const d = getDriver(input.kind);
  if (!/^https?:\/\//i.test(String(input.url || ''))) {
    throw new TransferError('invalid_url', '不是合法的分享链接');
  }
  return d.preview(String(input.url), String(input.password || ''), String(input.credential || ''));
}

/** 转存到指定目录 */
export async function transferSave(input: {
  kind: string;
  url: string;
  password?: string;
  credential?: string;
  to_path?: string;
  ids?: string[];
  sub_dir?: boolean;
}): Promise<SaveResult> {
  const d = getDriver(input.kind);
  if (!/^https?:\/\//i.test(String(input.url || ''))) {
    throw new TransferError('invalid_url', '不是合法的分享链接');
  }
  const toPath = String(input.to_path || '').trim() || '/';
  const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
  return d.save(
    String(input.url),
    String(input.password || ''),
    String(input.credential || ''),
    toPath,
    ids,
    input.sub_dir !== false
  );
}

/** 列自己网盘的目录（用于「选择目录」与验证 Cookie） */
export async function transferList(input: {
  kind: string;
  credential?: string;
  path?: string;
}): Promise<ListResult> {
  const d = getDriver(input.kind);
  return d.list(String(input.credential || ''), String(input.path || '/'));
}

/** 取下载直链：Worker 随后带着必要的头把文件流式转发给浏览器 */
export async function transferLink(input: {
  kind: string;
  credential?: string;
  id?: string;
  path?: string;
}): Promise<LinkResult> {
  const d = getDriver(input.kind);
  return d.link(String(input.credential || ''), String(input.id || ''), String(input.path || ''));
}
