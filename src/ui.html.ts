import { VENDOR_VERSION } from './vendor.generated';
import { ICONS_CSS } from './icons';
import { CLOUD_BADGE_CSS } from './cloud';
import { APP_VERSION_LABEL, APP_NAME } from './version';

export const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <!-- viewport-fit=cover：让 iPhone 刘海 / 底部小黑条区域能被 CSS 安全区变量正确识别 -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${APP_NAME} · 极速网盘搜索聚合 ${APP_VERSION_LABEL}</title>
  <meta name="application-name" content="${APP_NAME}">
  <meta name="description" content="极速全网盘资源聚合搜索，支持阿里、夸克、百度、115、123、迅雷等 15+ 类网盘，内置链接失效检测。">
  <meta name="theme-color" content="#2563eb">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${APP_NAME}">
  <meta name="format-detection" content="telephone=no">
  <!-- PWA：Manifest + 图标（全部同源自托管，无外部依赖） -->
  <link rel="manifest" href="/manifest.webmanifest?v=${VENDOR_VERSION}">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=${VENDOR_VERSION}">
  <link rel="apple-touch-icon" href="/assets/icon.svg?v=${VENDOR_VERSION}">
  <!-- 全部前端资源同源自托管（无 unpkg / cdnjs / cdn.tailwindcss.com 等海外 CDN 依赖） -->
  <link rel="stylesheet" href="/assets/app.css?v=${VENDOR_VERSION}">
  <style>
${ICONS_CSS}
${CLOUD_BADGE_CSS}
    :root {
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      -webkit-tap-highlight-color: transparent;
      /* 关掉 iOS 的整页橡皮筋回弹，让内部滚动区域自己滚，避免误触时页面整体晃动 */
      overscroll-behavior-y: none;
    }
    .glass {
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .card-hover-effect {
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .card-hover-effect:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
    }

    /* 状态指示胶囊 */
    .status-valid { background-color: #ecfdf5; color: #047857; border-color: #a7f3d0; }
    .status-invalid { background-color: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .status-unknown { background-color: #f8fafc; color: #64748b; border-color: #e2e8f0; }
    .status-checking { background-color: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }

    /* 横向滚动容器：手机上分类 Tab / 快捷标签横滑时隐藏滚动条 */
    .no-scrollbar { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .no-scrollbar::-webkit-scrollbar { display: none; }

    /* iOS 安全区适配 */
    .safe-top { padding-top: var(--safe-top); }
    .safe-bottom { padding-bottom: calc(8px + var(--safe-bottom)); }

    [v-cloak] { display: none; }

    /* ---------------- 移动端专项优化 ----------------
       1. 输入框字号强制 16px：iOS Safari 对 <16px 的输入框聚焦时会自动放大整页 ——
          这正是「手机上一点搜索框，页面突然变大」的根因。
       2. 触控目标至少 44px，符合 iOS 人机界面指南。
       3. 卡片内边距在小屏收紧，一屏能多展示一条结果。 */
    @media (max-width: 767px) {
      input, select, textarea { font-size: 16px !important; }
      .tap-target { min-height: 44px; }
    }
  </style>
  <script src="/assets/vue.js?v=${VENDOR_VERSION}"></script>
</head>
<body class="bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/60 text-slate-800 min-h-screen flex flex-col font-sans antialiased">
  <div id="app" v-cloak class="flex flex-col min-h-screen">

    <!-- ============ 前台访问密码（V1.3） ============
         后台开启「前台访问密码」后，访客必须先解锁才能搜索。
         首页 HTML 与 /api/ui-config 保持公开，所以这一层是前端渲染的登录门，
         真正的拦截发生在数据接口（无令牌一律 401）。 -->
    <div v-if="locked" class="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-slate-50">
      <div class="w-full max-w-sm">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/60 p-6 sm:p-7">
          <div class="text-center mb-6">
            <div class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-500/25 mb-3">
              <i class="fa-solid fa-lock"></i>
            </div>
            <h2 class="font-bold text-lg text-slate-800">需要访问密码</h2>
            <p class="text-xs text-slate-400 mt-1">本站已开启访问保护，请输入密码后继续</p>
          </div>

          <form @submit.prevent="unlock" class="space-y-3">
            <div class="relative">
              <input
                :type="showUnlockPwd ? 'text' : 'password'"
                v-model="unlockInput"
                autocomplete="current-password"
                placeholder="访问密码"
                class="w-full pl-10 pr-10 py-3 text-base border-2 border-slate-200 rounded-xl outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
              <i class="fa-solid fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-sm"></i>
              <button type="button" @click="showUnlockPwd = !showUnlockPwd" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <i class="fa-solid text-sm" :class="showUnlockPwd ? 'fa-eye-slash' : 'fa-eye'"></i>
              </button>
            </div>
            <button
              type="submit"
              :disabled="unlocking || !unlockInput"
              class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold text-sm rounded-xl transition shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <i class="fa-solid" :class="unlocking ? 'fa-circle-notch fa-spin' : 'fa-unlock'"></i>
              <span>{{ unlocking ? '验证中…' : '解锁' }}</span>
            </button>
          </form>

          <p v-if="unlockError" class="mt-3 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <i class="fa-solid fa-circle-exclamation mt-0.5"></i><span>{{ unlockError }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- 顶栏导航 -->
    <header class="border-b border-slate-200/80 glass sticky top-0 z-40">
      <div class="safe-top"></div>
      <div class="max-w-6xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
        <div class="flex items-center space-x-2.5 cursor-pointer group min-w-0" @click="resetToHome">
          <div class="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <i class="fa-solid fa-bolt text-sm sm:text-base"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center space-x-1.5">
              <h1 class="font-bold text-base sm:text-lg leading-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 bg-clip-text text-transparent truncate">PanSou Edge</h1>
              <span class="shrink-0 text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100/60">{{ versionLabel }}</span>
            </div>
            <p class="text-[11px] text-slate-400 truncate hidden sm:block">极速全网盘聚合 · 智能失效检测</p>
          </div>
        </div>

        <div class="flex items-center space-x-1 sm:space-x-2 shrink-0">
          <!-- 安装到桌面（PWA）：仅在浏览器支持且尚未安装时出现 -->
          <button
            v-if="canInstall"
            @click="installPwa"
            class="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition flex items-center gap-1"
            title="把本站安装到桌面，像 App 一样打开"
          >
            <i class="fa-solid fa-mobile-screen-button"></i>
            <span class="hidden sm:inline">安装到桌面</span>
          </button>
          <!-- V1.3：首页不再放任何管理入口 —— 配置与 API 文档统一在 /admin，
               首页只做搜索这一件事。（从站外地址栏直接访问 /admin 即可） -->
        </div>
      </div>
    </header>

    <!-- 主搜索内容区 -->
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
      <!-- 搜索框区域 -->
      <div class="text-center mb-6 sm:mb-8 pt-1 sm:pt-4">
        <h2 class="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-4xl mb-2 sm:mb-3">
          搜你想搜，即刻触达
        </h2>
        <p class="text-slate-500 max-w-xl mx-auto text-xs sm:text-sm px-2">
          原生并发抓取 Telegram 公开频道与聚合插件，支持阿里、夸克、百度、UC、天翼、迅雷、123 等 15+ 类主流网盘
        </p>

        <!-- 搜索表单
             关键点：按钮**参与 flex 布局**（不再用 absolute），并设 shrink-0，
             因此无论窗口多窄，按钮都不会被压缩、文字也不会溢出到框外；
             输入框 flex-1 + min-w-0 只占用剩余空间。 -->
        <div class="mt-5 sm:mt-7 w-full max-w-3xl mx-auto">
          <form @submit.prevent="doSearch" class="w-full">
            <div
              id="search-box"
              class="flex items-center gap-1.5 p-1.5 bg-white border-2 border-slate-200 rounded-2xl shadow-lg shadow-slate-200/60 transition
                     focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10"
            >
              <span class="pl-2.5 flex items-center text-slate-400 shrink-0">
                <i class="fa-solid fa-magnifying-glass text-sm"></i>
              </span>
              <input
                id="search-input"
                type="search"
                v-model="keyword"
                autocomplete="off"
                enterkeyhint="search"
                placeholder="搜索电影、剧集、动漫、电子书…"
                class="flex-1 min-w-0 bg-transparent border-0 outline-none py-2.5 sm:py-3 text-base text-slate-800 placeholder-slate-400"
              />
              <button
                v-if="keyword"
                type="button"
                @click="keyword = ''"
                class="shrink-0 px-2 py-1 text-slate-300 hover:text-slate-500 transition tap-target flex items-center"
                title="清空"
              >
                <i class="fa-solid fa-circle-xmark text-base"></i>
              </button>
              <button
                id="search-submit"
                type="submit"
                :disabled="loading"
                class="shrink-0 whitespace-nowrap px-4 sm:px-5 py-2.5 sm:py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium text-sm rounded-xl transition shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                <i class="fa-solid" :class="loading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'"></i>
                <span>{{ loading ? '检索中' : '搜索' }}</span>
              </button>
            </div>
          </form>

          <!-- 热门搜索推荐 -->
          <!-- 热门搜索推荐：手机端单行横滑（不换行，避免占满三行把结果挤下去），桌面端自动居中换行 -->
          <div class="mt-3 sm:mt-4 flex flex-nowrap sm:flex-wrap items-center sm:justify-center gap-1.5 sm:gap-2 text-xs text-slate-500 overflow-x-auto no-scrollbar px-1">
            <span class="font-medium text-slate-400 flex items-center shrink-0">
              <i class="fa-solid fa-fire text-amber-500 mr-1"></i>大家都在搜:
            </span>
            <span
              v-for="tag in hotSearches"
              :key="tag"
              @click="quickSearch(tag)"
              class="cursor-pointer shrink-0 bg-white hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-slate-200/60 px-2.5 py-1.5 rounded-full transition shadow-2xs text-[11px] sm:text-xs"
            >
              {{ tag }}
            </span>
          </div>
        </div>
      </div>

      <!-- 检索进度与状态 -->
      <div v-if="searched && loading" class="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-slate-500 bg-white p-3 rounded-xl border border-slate-200/60 shadow-2xs max-w-xl mx-auto">
        <div class="flex items-center space-x-2">
          <i class="fa-solid fa-circle-notch fa-spin text-blue-600"></i>
          <span>
            正在检索多路频道与插件源
            <strong class="text-slate-700">{{ searchProgress.done }}</strong>
            /
            <strong class="text-slate-700">{{ searchProgress.total }}</strong>
          </span>
        </div>
        <div class="flex items-center space-x-2">
          <div class="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div
              class="h-full bg-blue-600 transition-all duration-300"
              :style="{ width: searchProgress.total ? (searchProgress.done / searchProgress.total * 100) + '%' : '0%' }"
            ></div>
          </div>
          <span v-if="totalCount > 0" class="text-blue-600 font-semibold">已汇总 {{ totalCount }} 条</span>
        </div>
      </div>

      <!-- 搜索结果区 -->
      <div v-if="searched" class="mt-6 sm:mt-8">
        <!-- 分类切换 Tabs & 工具条 -->
        <div class="mb-4 sm:mb-6">
          <!-- 网盘分类：自动换行，保证每个分类都完整可见（不做横向截断）。
               手机端内边距收紧、字号降一档，一屏能塞下更多分类。 -->
          <div id="cloud-tabs" class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              @click="activeTab = 'all'"
              :class="activeTab === 'all'
                ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm shadow-blue-500/25'
                : 'bg-white border-slate-200/80 text-slate-600 hover:border-blue-200 hover:text-blue-600'"
              class="px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-xl border text-xs sm:text-sm transition flex items-center gap-1.5"
            >
              <span>全部网盘</span>
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                :class="activeTab === 'all' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'"
              >{{ totalCount }}</span>
            </button>
            <button
              v-for="type in tabTypes"
              :key="type"
              @click="activeTab = type"
              :class="activeTab === type
                ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm shadow-blue-500/25'
                : 'bg-white border-slate-200/80 text-slate-600 hover:border-blue-200 hover:text-blue-600'"
              class="px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl border text-xs sm:text-sm transition flex items-center gap-1.5"
            >
              <span>{{ getCloudLabel(type) }}</span>
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                :class="activeTab === type ? 'bg-white/25' : 'bg-slate-100 text-slate-500'"
              >{{ mergedResults[type].length }}</span>
            </button>
          </div>

          <!-- 工具条：自动测活开关 / 只看有效 / 批量检测
               手机端允许横向滑动，避免三个控件被挤成三行、把结果推下去 -->
          <div id="result-toolbar" class="mt-3 pt-3 border-t border-slate-200/80 flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs overflow-x-auto no-scrollbar">
            <!-- 自动测活开关（后台可关闭；关闭后不渲染） -->
            <button
              v-if="showAutoCheck"
              @click="toggleAutoCheck"
              class="flex items-center gap-2 pl-2.5 pr-3 py-2 sm:py-1.5 rounded-xl border font-medium transition shrink-0"
              :class="autoCheck
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-white border-slate-200/80 text-slate-500 hover:bg-slate-50'"
              :title="autoCheck ? '已开启：搜索结果会自动检测链接有效性' : '点击开启：搜索结果自动检测链接有效性'"
            >
              <span
                class="relative inline-block w-9 h-5 rounded-full transition-colors shrink-0"
                :class="autoCheck ? 'bg-emerald-500' : 'bg-slate-300'"
              >
                <span
                  class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                  :class="autoCheck ? 'translate-x-4' : 'translate-x-0'"
                ></span>
              </span>
              <span>自动测活</span>
            </button>

            <!-- 仅显示有效筛选 -->
            <label
              v-if="hasCheckedAny"
              class="flex items-center gap-1.5 cursor-pointer select-none px-2.5 py-2 sm:py-1.5 rounded-xl border border-slate-200/80 bg-white text-slate-600 hover:text-blue-600 transition shrink-0"
            >
              <input type="checkbox" v-model="filterValidOnly" class="w-4 h-4 rounded text-blue-600 focus:ring-0">
              <span>只看有效 ({{ validOnlyCount }})</span>
            </label>

            <!-- 批量一键检测按钮 -->
            <button
              @click="batchCheckCurrent"
              :disabled="batchChecking || currentList.length === 0"
              class="px-3 py-2 sm:py-1.5 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200/80 rounded-xl transition flex items-center gap-1.5 font-medium disabled:opacity-50 shrink-0"
              title="检测当前分类下所有网盘链接是否失效"
            >
              <i class="fa-solid" :class="batchChecking ? 'fa-circle-notch fa-spin text-blue-600' : 'fa-stethoscope text-emerald-600'"></i>
              <span v-if="batchChecking">检测中 {{ checkedCount }}/{{ checkingTarget }}</span>
              <span v-else>检测本页有效性</span>
            </button>

            <span class="text-slate-400 sm:ml-auto whitespace-nowrap shrink-0 pl-0.5">
              共 {{ displayedList.length }} 条<span v-if="hasCheckedAny"> · 已检测 {{ checkedCount }}</span>
            </span>
          </div>
        </div>

        <!-- 结果卡片网格 -->
        <div v-if="displayedList.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="(item, idx) in displayedList"
            :key="idx"
            class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 card-hover-effect flex flex-col justify-between"
          >
            <div>
              <!-- 顶部标签与时间 -->
              <div class="flex items-center justify-between gap-2 mb-2.5">
                <div class="flex items-center space-x-1.5">
                  <span
                    class="text-[11px] font-semibold px-2.5 py-0.5 rounded-md shadow-2xs"
                    :class="'badge-' + (item.cloudType || activeTab)"
                  >
                    {{ getCloudLabel(item.cloudType || activeTab) }}
                  </span>

                  <!-- 失效状态徽标 -->
                  <span
                    v-if="itemStatusMap[item.url]"
                    class="text-[10px] font-medium px-2 py-0.5 rounded-md border flex items-center space-x-1"
                    :class="getStatusClass(itemStatusMap[item.url].status)"
                  >
                    <i class="fa-solid text-[9px]" :class="getStatusIcon(itemStatusMap[item.url].status)"></i>
                    <span>{{ itemStatusMap[item.url].label }}</span>
                  </span>
                </div>

                <span class="text-[11px] text-slate-400 flex items-center">
                  <i class="fa-regular fa-clock mr-1 text-[10px]"></i>
                  {{ formatDateTime(item.datetime) }}
                </span>
              </div>

              <!-- 资源标题 -->
              <h3 class="text-sm sm:text-base font-semibold text-slate-800 line-clamp-2 hover:text-blue-600 transition leading-snug">
                <a :href="item.url" target="_blank" rel="noopener noreferrer">
                  {{ item.note || item.title || '网盘分享链接' }}
                </a>
              </h3>
            </div>

            <!-- 底部来源与操作按钮 -->
            <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <!-- 来源渠道 -->
              <div class="flex items-center space-x-1.5 text-slate-400 truncate max-w-[45%]" :title="item.source || 'TG 频道'">
                <i class="fa-solid fa-bullhorn text-slate-300 text-[11px]"></i>
                <span class="truncate text-[11px] text-slate-500">{{ item.source || 'TG 频道' }}</span>
              </div>

              <!-- 右侧操作区：提取码 + 检测 + 直达 -->
              <div class="flex items-center space-x-2">
                <!-- 提取码 -->
                <span
                  v-if="item.password"
                  @click="copyText(item.password, '提取码已复制')"
                  class="cursor-pointer bg-amber-50 hover:bg-amber-100 text-amber-700 font-mono font-medium px-2 py-0.5 rounded border border-amber-200/80 transition text-[11px] flex items-center space-x-1"
                  title="点击复制提取码"
                >
                  <i class="fa-regular fa-copy text-[10px]"></i>
                  <span>{{ item.password }}</span>
                </span>

                <!-- 单项有效性检测按钮 -->
                <button
                  @click="checkSingle(item)"
                  class="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition text-[11px] border border-slate-200/60"
                  title="检测此链接是否失效"
                >
                  <i class="fa-solid fa-rotate text-[10px]" :class="{ 'fa-spin text-blue-600': itemStatusMap[item.url]?.status === 'checking' }"></i>
                  <span class="ml-1 hidden sm:inline">测活</span>
                </button>

                <!-- V1.6.1：一键下载（仅后台开启、且该网盘在支持列表内时显示）
                     点一下 = 自动转存到网盘目录 → 展开文件 → 直接开始下载 -->
                <button
                  v-if="canTransfer(item.cloudType)"
                  @click="quickDownload(item)"
                  class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition text-[11px] font-medium flex items-center space-x-1"
                  title="自动转存到你配置的网盘，然后直接下载"
                >
                  <i class="fa-solid fa-download text-[10px]"></i>
                  <span>下载</span>
                </button>

                <!-- 转存：可勾选文件、指定目录（进阶用法，图标按钮不占地方） -->
                <button
                  v-if="canTransfer(item.cloudType)"
                  @click="openTransfer(item)"
                  class="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition text-[11px] border border-indigo-200/60"
                  title="转存到自己网盘的指定目录（可勾选文件）"
                >
                  <i class="fa-solid fa-cloud-arrow-up text-[10px]"></i>
                </button>

                <!-- 直达链接 -->
                <a
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="px-3 py-1 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded-lg font-medium transition text-[11px] sm:text-xs flex items-center space-x-1"
                >
                  <span>直达</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- 筛选后无有效结果 -->
        <div v-else-if="filterValidOnly && currentList.length > 0" class="text-center py-16 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <div class="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto text-amber-500 text-2xl mb-3">
            <i class="fa-solid fa-filter-circle-xmark"></i>
          </div>
          <h3 class="text-slate-700 font-semibold mb-1 text-sm">当前分类下未检测出「确定有效」的链接</h3>
          <p class="text-slate-400 text-xs mb-4">可以关闭「只看有效」筛选，或点击右上角「检测本页有效性」触发全面测活</p>
          <button @click="filterValidOnly = false" class="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100">
            查看全部 {{ currentList.length }} 条资源
          </button>
        </div>

        <!-- 空数据提示 -->
        <div v-else-if="!loading" class="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto text-slate-400 text-2xl mb-4">
            <i class="fa-regular fa-folder-open"></i>
          </div>
          <h3 class="text-slate-700 font-semibold mb-1">未找到相关资源</h3>
          <p class="text-slate-400 text-xs">请尝试更换更简短的关键词，或稍后重试（上游频道偶发限流）</p>
        </div>
      </div>
    </main>

    <!-- 页脚 -->
    <footer class="border-t border-slate-200/80 bg-white/70 py-6 mt-auto text-center text-xs text-slate-400 backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          Powered by <strong>Cloudflare Workers & KV</strong> · 边缘高速计算与智能测活
        </div>
        <div class="flex space-x-4">
          <span>兼容 pansou-web / panhub 协议</span>
          <span>原生 TG 分片调度</span>
        </div>
      </div>
    </footer>

    <!-- ============ 转存弹窗（V1.6） ============
         流程：填网盘 Cookie → 解析分享 → 勾选文件 → 转存到指定目录 → 从网盘下载。
         Cookie 只存在浏览器 localStorage，随请求发给 Worker 转发，Worker 不落盘。 -->
    <div
      v-if="tr.open"
      class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4"
      @click.self="closeTransfer"
    >
      <div class="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col">
        <!-- 头部 -->
        <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div class="min-w-0">
            <h2 class="font-bold text-base text-slate-800 flex items-center gap-2">
              <i class="fa-solid" :class="tr.quick ? 'fa-download text-indigo-600' : 'fa-cloud-arrow-up text-indigo-600'"></i>
              {{ tr.quick ? '下载到' + (tr.cap.label || '网盘') : '转存到' + (tr.cap.label || '网盘') }}
            </h2>
            <p class="text-xs text-slate-400 mt-1 truncate" :title="tr.title || tr.url">{{ tr.title || tr.url }}</p>
          </div>
          <button @click="closeTransfer" class="text-slate-400 hover:text-slate-600 tap-target shrink-0" title="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="px-5 py-4 overflow-y-auto space-y-4">
          <!-- 提取码（分享要求但未带时出现） -->
          <div v-if="tr.needPwd" class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-600">提取码</label>
            <div class="flex gap-2">
              <input
                v-model="tr.pwd"
                @keyup.enter="doPreview"
                maxlength="12"
                class="flex-1 px-3 py-2 text-base font-mono tracking-widest border-2 border-amber-300 rounded-xl outline-none focus:border-indigo-500"
                placeholder="请输入分享提取码"
              />
              <button @click="doPreview" :disabled="tr.busy" class="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-xs font-medium disabled:opacity-50">确定</button>
            </div>
          </div>

          <!-- 网盘 Cookie（一键下载成功后再显示就没意义了，只在需要用户补 Cookie 时露出） -->
          <div v-if="!tr.quick || tr.step === 'cred'" class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold text-slate-600">{{ tr.cap.credential_label || '网盘 Cookie' }}</label>
              <a :href="tr.cap.cookie_site" target="_blank" rel="noopener noreferrer" class="text-[11px] text-blue-600 hover:underline flex items-center gap-1">
                去获取<i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
            </div>
            <textarea
              v-model="tr.cred"
              rows="2"
              spellcheck="false"
              :placeholder="credReady(tr.kind) ? '可留空：本站已配置账号，留空即用站长账号转存' : '粘贴 ' + (tr.cap.cookie_key || 'Cookie') + ' 的值（也可粘贴整段 Cookie）'"
              class="w-full px-3 py-2 text-base font-mono text-xs border-2 border-slate-200 rounded-xl outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            ></textarea>
            <p v-if="credReady(tr.kind) && !tr.cred.trim()" class="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5 leading-relaxed">
              <i class="fa-solid fa-circle-check mr-1"></i>本站已配置{{ tr.cap.label }}账号：留空即用站长账号转存下载，填自己的则以你的为准。
            </p>
            <p class="text-[11px] text-slate-400 leading-relaxed">{{ cookieHint }}</p>
            <label class="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
              <input type="checkbox" v-model="tr.remember" class="w-4 h-4 rounded text-indigo-600 focus:ring-0">
              记住此 Cookie（仅保存在本机浏览器，服务器不存储）
            </label>
          </div>

          <!-- 目标目录 -->
          <div v-if="!tr.quick || tr.step === 'cred'" class="space-y-1.5">
            <label class="text-xs font-semibold text-slate-600">转存到目录</label>
            <div class="flex gap-2">
              <input
                v-model="tr.dir"
                class="flex-1 min-w-0 px-3 py-2 text-base font-mono text-xs border-2 border-slate-200 rounded-xl outline-none transition focus:border-indigo-500"
                placeholder="/来自PanSou"
              />
              <button
                @click="browseDir(tr.dir)"
                :disabled="tr.busy || (!tr.cred.trim() && !credReady(tr.kind))"
                class="px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-600 font-medium disabled:opacity-50 flex items-center gap-1 shrink-0"
                title="需要 Cookie（自己的或站长配置的）才能浏览网盘目录"
              >
                <i class="fa-solid fa-folder-open text-[10px]"></i>浏览
              </button>
            </div>
            <!-- 目录浏览器 -->
            <div v-if="tr.browseOpen" class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="flex items-center gap-2 px-3 py-2 bg-slate-50 text-[11px] text-slate-500 border-b border-slate-100">
                <button @click="browseDir(parentDir(tr.browsePath))" class="hover:text-blue-600 shrink-0">上一级</button>
                <span class="truncate font-mono">{{ tr.browsePath }}</span>
                <button @click="pickDir(tr.browsePath)" class="ml-auto text-indigo-600 hover:underline shrink-0">选这里</button>
              </div>
              <div class="max-h-44 overflow-y-auto">
                <div v-if="tr.browseLoading" class="px-3 py-3 text-xs text-slate-400 flex items-center gap-1.5"><i class="fa-solid fa-circle-notch fa-spin"></i>读取中…</div>
                <div v-else-if="tr.browseEntries.length === 0" class="px-3 py-3 text-xs text-slate-400">此目录下没有子文件夹</div>
                <button
                  v-for="e in tr.browseEntries"
                  :key="e.id"
                  @click="browseDir(joinDir(tr.browsePath, e.name))"
                  class="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
                >
                  <i class="fa-solid fa-folder-open text-amber-400 text-[10px]"></i><span class="truncate">{{ e.name }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- 一键下载进度（V1.6.1）：解析 → 转存 → 展开 → 下载，前端只能拿到整体结果，用时间轴给个反馈 -->
          <div v-if="tr.step === 'auto'" class="space-y-3 py-1">
            <div class="flex items-center gap-3">
              <i class="fa-solid fa-circle-notch fa-spin text-indigo-600 text-lg"></i>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-slate-700">{{ tr.stage || '正在解析分享…' }}</p>
                <p class="text-[11px] text-slate-400 mt-0.5">已用时 {{ tr.elapsed }} 秒，整季剧集可能需要 10–30 秒</p>
              </div>
            </div>
            <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full transition-all duration-500" :style="{ width: tr.progress + '%' }"></div>
            </div>
            <p class="text-[11px] text-slate-400 leading-relaxed">
              会先把资源转存到 <span class="font-mono">{{ tr.dir }}</span>，再从网盘取直链下载；本站只做转发，不缓存文件。
            </p>
          </div>

          <!-- 错误提示 -->
          <div v-if="tr.error" class="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <i class="fa-solid fa-circle-xmark mt-0.5"></i><span>{{ tr.error }}</span>
          </div>

          <!-- 第二步：分享内容清单 -->
          <div v-if="tr.step === 'files'" class="space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold text-slate-600">分享内容<span class="text-slate-400 font-normal">（{{ tr.items.length }} 项）</span></span>
              <button @click="toggleAllItems" class="text-blue-600 hover:underline">{{ allSelected ? '全不选' : '全选' }}</button>
            </div>
            <div class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
              <label v-for="it in tr.items" :key="it.id" class="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" :value="it.id" v-model="tr.selected" class="w-4 h-4 rounded text-indigo-600 focus:ring-0 shrink-0">
                <i class="fa-solid text-[11px] shrink-0" :class="it.is_dir ? 'fa-folder-open text-amber-400' : 'fa-file-import text-slate-300'"></i>
                <span class="flex-1 min-w-0 text-xs text-slate-700 truncate" :title="it.name">{{ it.name }}</span>
                <span class="text-[10px] text-slate-400 shrink-0">{{ it.is_dir ? '文件夹' : sizeLabel(it) }}</span>
              </label>
            </div>
          </div>

          <!-- 第三步：转存结果 -->
          <div v-if="tr.step === 'done'" class="space-y-2">
            <div class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <i class="fa-solid fa-circle-check mt-0.5"></i>
              <span>已转存 {{ tr.saved.length }} 项到 <span class="font-mono break-all">{{ tr.savedPath }}</span></span>
            </div>
            <div class="flex flex-wrap gap-2">
              <a :href="tr.cap.web_url" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1">
                去网盘查看<i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
              <button @click="copyText(tr.savedPath, '目录路径已复制')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1">
                <i class="fa-solid fa-copy text-[10px]"></i>复制路径
              </button>
              <button
                v-if="downloadable.length > 1"
                @click="downloadAll"
                :disabled="tr.dlAll"
                class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-60"
              >
                <i class="fa-solid text-[10px]" :class="tr.dlAll ? 'fa-circle-notch fa-spin' : 'fa-download'"></i>
                {{ tr.dlAll ? '下载中…' : '全部下载（' + downloadable.length + '）' }}
              </button>
            </div>
            <div class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
              <div v-for="it in tr.saved" :key="it.id" class="flex items-center gap-2.5 px-3 py-2">
                <i class="fa-solid text-[11px] shrink-0" :class="it.is_dir ? 'fa-folder-open text-amber-400' : 'fa-file-import text-slate-300'"></i>
                <span class="flex-1 min-w-0 text-xs text-slate-700 truncate" :title="it.name">{{ it.name }}</span>
                <span v-if="!it.is_dir" class="text-[10px] text-slate-400 shrink-0">{{ sizeLabel(it) }}</span>
                <button
                  v-if="!it.is_dir"
                  @click="downloadItem(it)"
                  :disabled="tr.dlId === it.id"
                  class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-medium disabled:opacity-60 flex items-center gap-1 shrink-0"
                >
                  <i class="fa-solid text-[10px]" :class="tr.dlId === it.id ? 'fa-circle-notch fa-spin' : 'fa-download'"></i>{{ tr.dlId === it.id ? '准备中…' : '下载' }}
                </button>
              </div>
            </div>
            <p v-if="tr.pending" class="text-[11px] text-amber-600 leading-relaxed">网盘仍在后台处理部分文件，若下载报错请稍等片刻后再点下载。</p>
            <p v-if="tr.truncated" class="text-[11px] text-amber-600 leading-relaxed">分享里文件较多，这里只列出了前 {{ tr.saved.length }} 个；其余请到上方「去网盘查看」里的目录找。</p>
            <p class="text-[11px] text-slate-400 leading-relaxed">下载由本站代理转发，大文件会显示为浏览器下载任务；PWA 全屏模式下同样可用。若浏览器询问「是否允许下载多个文件」，请选择允许。</p>
          </div>
        </div>

        <!-- 底部操作 -->
        <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-2 safe-bottom">
          <template v-if="tr.step === 'cred'">
            <button
              @click="tr.quick ? doAuto() : doPreview()"
              :disabled="tr.busy || (!tr.cred.trim() && !credReady(tr.kind) && !tr.cap.anonymous_preview)"
              class="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-md shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <i class="fa-solid" :class="tr.busy ? 'fa-circle-notch fa-spin' : (tr.quick ? 'fa-download' : 'fa-magnifying-glass')"></i>
              <span>{{ tr.busy ? (tr.quick ? '处理中…' : '解析中…') : (tr.quick ? '开始下载' : '解析分享') }}</span>
            </button>
          </template>
          <template v-else-if="tr.step === 'auto'">
            <button @click="closeTransfer" class="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium">关闭</button>
          </template>
          <template v-else-if="tr.step === 'files'">
            <button @click="tr.step = 'cred'" :disabled="tr.busy" class="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium disabled:opacity-50">上一步</button>
            <button
              @click="doSave"
              :disabled="tr.busy || tr.selected.length === 0 || (!tr.cred.trim() && !credReady(tr.kind))"
              class="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-md shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <i class="fa-solid" :class="tr.busy ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-up'"></i>
              <span>{{ tr.busy ? '转存中…' : '转存 ' + tr.selected.length + ' 项' }}</span>
            </button>
          </template>
          <template v-else>
            <button @click="closeTransfer" class="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium">完成</button>
          </template>
        </div>
      </div>
    </div>

    <!-- 下载用隐藏 iframe：表单 POST 走浏览器原生下载，大文件不占内存，PWA standalone 也兼容 -->
    <iframe name="tr-dl-frame" src="about:blank" style="display:none" title="download"></iframe>

    <!-- 全局轻提示 -->
    <div
      v-if="toast.show"
      class="fixed left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium max-w-[90vw] text-white"
      :class="toast.type === 'error' ? 'bg-rose-600' : toast.type === 'ok' ? 'bg-emerald-600' : 'bg-slate-800'"
      style="bottom: calc(24px + var(--safe-bottom))"
    >{{ toast.msg }}</div>


  </div>

  <script>
    const { createApp, ref, computed, onMounted } = Vue;

    const app = createApp({
      setup() {
        const keyword = ref('');
        const searched = ref(false);
        const loading = ref(false);
        const activeTab = ref('all');

        /* ---------------- 前台访问密码（V1.3） ----------------
           令牌由服务端下发、存在本地，之后所有数据接口都带 X-Frontend-Token。
           它由密码哈希派生，所以后台一改密码，这边的旧令牌就会自动 401 并被清掉。 */
        const FE_TOKEN_KEY = 'pansou_fe_token';
        const locked = ref(false);
        const unlockInput = ref('');
        const unlockError = ref('');
        const unlocking = ref(false);
        const showUnlockPwd = ref(false);
        // 隐私模式 / 禁用存储时 localStorage 会直接抛错，这里必须兜住
        let savedFeToken = '';
        try { savedFeToken = localStorage.getItem(FE_TOKEN_KEY) || ''; } catch (e) {}
        const feToken = ref(savedFeToken);

        const hotSearches = ref(['热辣滚烫', '周处除三害', '沙丘2', '繁花', '三体', '庆余年', '黑神话悟空', '流浪地球2']);
        const mergedResults = ref({});
        const totalCount = ref(0);
        const searchProgress = ref({ done: 0, total: 0 });

        // 失效检测状态映射: { [url]: { status: 'checking'|'valid'|'invalid'|'unknown', label: '有效'|'已失效'|'需提取码' } }
        const itemStatusMap = ref({});
        const batchChecking = ref(false);
        const filterValidOnly = ref(false);
        // 自动测活：是否显示由后台控制（showAutoCheck），默认开启
        const autoCheck = ref(false);
        const checkingTarget = ref(0);

        /* ---------------- 后台可配置项（来自 /api/ui-config） ---------------- */
        // 版本号：优先用接口返回值，接口未返回时兜底构建期常量
        const versionLabel = ref('${APP_VERSION_LABEL}');
        // 是否展示「自动测活」开关
        const showAutoCheck = ref(true);
        // 搜索结果中允许展示的网盘类型（按后台配置的顺序渲染分类 Tab）
        const visibleCloudTypes = ref([]);
        // 云端配置是否已加载：加载前不启用网盘过滤，避免首屏空白
        const cloudFilterActive = ref(false);
        // 网盘中文名映射（由后台下发，前端不再硬编码）
        const cloudLabels = ref({});

        /* ---------------- 网盘转存（V1.6） ----------------
           凭据（网盘 Cookie）只存浏览器 localStorage，随请求体发给 Worker 转发；
           Worker 不落盘。网盘轮换凭据时会把新值带回来，这里顺手覆盖本地旧值。 */
        const transferEnabled = ref(false);
        const transferCaps = ref({});
        /** V1.6.1：哪些网盘已在后台配好站长 Cookie（前端只拿到布尔值） */
        const transferReady = ref({});
        const credReady = (kind) => !!(kind && transferReady.value[kind]);
        const BS = String.fromCharCode(92);
        const normDir = (p) => {
          const segs = [];
          String(p || '').trim().split(BS).join('/').split('/').forEach(x => {
            x = x.trim();
            if (x && x !== '.') segs.push(x);
          });
          return '/' + segs.join('/');
        };
        const joinDir = (base, name) => normDir(base + '/' + name);
        const parentDir = (p) => {
          const segs = normDir(p).split('/').filter(Boolean);
          segs.pop();
          return '/' + segs.join('/');
        };
        const fmtSize = (n) => {
          n = Number(n) || 0;
          if (n < 1024) return n + ' B';
          const units = ['KB', 'MB', 'GB', 'TB'];
          let i = -1;
          do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
          return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
        };
        // 上游偶尔不带文件大小（返回 0），显示「—」比「0 B」更不容易误解
        const sizeLabel = (it) => (Number(it && it.size) > 0 ? fmtSize(it.size) : '—');
        const toast = ref({ show: false, msg: '', type: 'info' });
        let toastTimer = null;
        const showToast = (msg, type) => {
          toast.value = { show: true, msg: String(msg || ''), type: type || 'info' };
          if (toastTimer) clearTimeout(toastTimer);
          toastTimer = setTimeout(() => { toast.value.show = false; }, type === 'error' ? 5000 : 2600);
        };
        const credKey = (k) => 'pansou_tr_cred_' + k;
        const dirKey = (k) => 'pansou_tr_dir_' + k;
        const loadLocal = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
        const saveLocal = (k, v) => {
          try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {}
        };
        const COOKIE_HINTS = {
          quark: '电脑浏览器登录 pan.quark.cn → F12 开发者工具 → 应用/Application → Cookie → 复制 __puus 的值。',
          uc: '电脑浏览器登录 drive.uc.cn → F12 开发者工具 → 应用/Application → Cookie → 复制 __puus 的值。',
          baidu: '电脑浏览器登录 pan.baidu.com → F12 → 应用/Application → Cookie → 复制 BDUSS 的值（也可直接粘贴整段 Cookie）。'
        };
        const emptyTr = () => ({
          open: false, step: 'cred', busy: false, error: '', kind: '', cap: {}, url: '', pwd: '',
          cred: '', remember: true, dir: '/', needPwd: false, title: '',
          items: [], selected: [], saved: [], savedPath: '', pending: false,
          browseOpen: false, browsePath: '/', browseEntries: [], browseLoading: false, dlId: '',
          // V1.6.1：一键下载（自动转存 → 直接开始下载）
          quick: false, stage: '', progress: 0, elapsed: 0, dlAll: false, truncated: false
        });
        const tr = ref(emptyTr());
        const allSelected = computed(() =>
          tr.value.items.length > 0 && tr.value.selected.length === tr.value.items.length
        );
        /** 结果清单里真正能下载的（文件夹不参与，文件夹在转存时已被展开） */
        const downloadable = computed(() => (tr.value.saved || []).filter(x => x && !x.is_dir));
        const canTransfer = (type) => !!(transferEnabled.value && type && transferCaps.value[type]);
        const cookieHint = computed(() => COOKIE_HINTS[tr.value.kind] || '从网盘网页版的开发者工具中复制登录 Cookie 后粘贴到此处。');

        // 不走通用的 apiFetch：那个把任何 401 都当成「前台密码失效」并锁屏，
        // 而转存接口的 401 还可能是「网盘 Cookie 失效」，这里按 error 字段区分。
        const transferApi = async (action, body) => {
          const headers = { 'Content-Type': 'application/json' };
          if (feToken.value) headers['X-Frontend-Token'] = feToken.value;
          const res = await fetch('/api/transfer/' + action, { method: 'POST', headers, body: JSON.stringify(body) });
          const d = await res.json().catch(() => ({}));
          if (d.error === 'unauthorized') {
            feToken.value = '';
            try { localStorage.removeItem(FE_TOKEN_KEY); } catch (e) {}
            locked.value = true;
            throw { code: 'unauthorized', message: '需要访问密码，请先解锁' };
          }
          if (!res.ok || d.code !== 0) {
            throw { code: d.error || 'error', message: d.message || ('请求失败（HTTP ' + res.status + '）') };
          }
          return d.data || {};
        };
        const trFriendly = (e) => {
          const c = e && e.code;
          const m = (e && e.message) || '';
          if (c === 'need_login') {
            return credReady(tr.value.kind)
              ? '本站配置的网盘 Cookie 已失效，可填入自己的 Cookie 重试，或联系站长更新'
              : '网盘登录已失效：请重新复制 ' + (tr.value.cap.cookie_key || 'Cookie') + ' 后再试';
          }
          if (c === 'wrong_password') return '提取码不正确，请检查后重试';
          if (c === 'share_cancelled' || c === 'share_not_found') return m || '分享已失效';
          if (c === 'disabled') return '站长未开放转存功能';
          if (c === 'not_supported') return m || '该网盘暂不支持转存';
          if (c === 'network_error') return (m || '无法连接网盘接口') + '，请稍后重试';
          if (c === 'unauthorized') return m;
          return m || '操作失败，请稍后重试';
        };
        // 网盘轮换了凭据 → 回写输入框与本地
        const absorbCred = (r) => {
          if (r && r.credential) {
            tr.value.cred = r.credential;
            if (tr.value.remember) saveLocal(credKey(tr.value.kind), r.credential);
          }
        };

        const openTransfer = (item) => {
          const kind = item.cloudType;
          const cap = transferCaps.value[kind] || {};
          const dir = loadLocal(dirKey(kind)) || cap.default_dir || '/';
          const cred = loadLocal(credKey(kind));
          tr.value = Object.assign(emptyTr(), {
            open: true, kind, cap, dir, cred,
            url: item.url, pwd: item.password || '',
            title: item.note || item.title || '',
            remember: true
          });
          // 夸克 / UC 可匿名解析；百度必须先有 Cookie（自己填的或后台配置的）才能列目录
          if (cred || cap.anonymous_preview || credReady(kind)) doPreview();
        };
        const closeTransfer = () => { tr.value.open = false; };

        /**
         * V1.6.1 一键下载：点结果卡片的「下载」后自动完成
         *   解析分享 → 转存到网盘默认目录 → 展开文件夹 → 取直链开始下载
         * 全程只发一个 /api/transfer/fetch 请求，进度用计时器做视觉反馈。
         */
        let autoTimer = null;
        const stopAutoTimer = () => {
          if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
        };
        const quickDownload = (item) => {
          const kind = item.cloudType;
          const cap = transferCaps.value[kind] || {};
          tr.value = Object.assign(emptyTr(), {
            open: true, kind, cap,
            cred: loadLocal(credKey(kind)),
            dir: loadLocal(dirKey(kind)) || cap.default_dir || '/',
            url: item.url, pwd: item.password || '',
            title: item.note || item.title || '',
            quick: true, step: 'auto', stage: '正在解析分享…'
          });
          doAuto();
        };

        const doAuto = async () => {
          const t = tr.value;
          if (t.busy) return;
          t.busy = true;
          t.error = '';
          t.quick = true;
          t.step = 'auto';
          t.progress = 8;
          t.elapsed = 0;
          t.stage = '正在解析分享…';
          stopAutoTimer();
          const startedAt = Date.now();
          autoTimer = setInterval(() => {
            const sec = Math.floor((Date.now() - startedAt) / 1000);
            t.elapsed = sec;
            t.progress = Math.min(92, 8 + sec * 4);
            t.stage =
              sec < 3 ? '正在解析分享…'
              : sec < 9 ? '正在转存到网盘目录…'
              : sec < 18 ? '正在确认文件…'
              : '正在准备下载…';
          }, 1000);
          try {
            const r = await transferApi('fetch', {
              url: t.url, password: t.pwd, type: t.kind,
              credential: t.cred.trim(), to_path: t.dir
            });
            if (r.need_password) {
              stopAutoTimer();
              t.step = 'cred';
              t.needPwd = true;
              t.error = '该分享需要提取码，请填写后重试';
              return;
            }
            absorbCred(r);
            const files = (r.files || []).map(f => ({
              id: f.id, name: f.name, path: f.path || '', size: f.size || 0, is_dir: false
            }));
            t.saved = files;
            t.savedPath = r.path || normDir(t.dir);
            t.pending = !!r.task_pending;
            t.truncated = !!r.truncated;
            if (t.remember && t.savedPath) saveLocal(dirKey(t.kind), t.savedPath);
            stopAutoTimer();
            t.progress = 100;
            t.elapsed = Math.floor((Date.now() - startedAt) / 1000);
            t.step = 'done';
            if (files.length === 1) {
              await startDownload(files[0]);
              showToast('已开始下载：' + files[0].name, 'ok');
            } else {
              // 多个文件：先自动下前 3 个（浏览器可能拦截多文件下载），其余留给用户点
              showToast('已转存 ' + files.length + ' 个文件，正在依次下载', 'ok');
              downloadAll(3);
            }
          } catch (e) {
            stopAutoTimer();
            t.step = 'cred';
            t.error = trFriendly(e);
          } finally {
            t.busy = false;
          }
        };

        const doPreview = async () => {
          const t = tr.value;
          if (t.busy) return;
          t.busy = true;
          t.error = '';
          try {
            const r = await transferApi('preview', {
              url: t.url, password: t.pwd, type: t.kind, credential: t.cred.trim()
            });
            absorbCred(r);
            if (r.need_password) { t.needPwd = true; return; }
            t.needPwd = false;
            if (r.title) t.title = r.title;
            t.items = r.items || [];
            t.selected = t.items.map(x => x.id);
            if (t.remember) saveLocal(credKey(t.kind), t.cred.trim());
            if (t.items.length === 0) { t.error = '分享里没有可转存的内容（可能已被分享者清空）'; return; }
            t.step = 'files';
          } catch (e) {
            t.error = trFriendly(e);
          } finally {
            t.busy = false;
          }
        };

        const toggleAllItems = () => {
          const t = tr.value;
          t.selected = allSelected.value ? [] : t.items.map(x => x.id);
        };

        const doSave = async () => {
          const t = tr.value;
          if (t.busy || t.selected.length === 0) return;
          t.busy = true;
          t.error = '';
          const dir = normDir(t.dir);
          t.dir = dir;
          try {
            const r = await transferApi('save', {
              url: t.url, password: t.pwd, type: t.kind, credential: t.cred.trim(),
              to_path: dir, ids: t.selected
            });
            absorbCred(r);
            if (t.remember) saveLocal(dirKey(t.kind), dir);
            t.saved = r.items || [];
            t.savedPath = r.path || dir;
            t.pending = !!r.task_pending;
            t.step = 'done';
            showToast('已转存 ' + t.saved.length + ' 项到 ' + t.savedPath, 'ok');
          } catch (e) {
            t.error = trFriendly(e);
          } finally {
            t.busy = false;
          }
        };

        const browseDir = async (p) => {
          const t = tr.value;
          const target = normDir(p);
          t.browseOpen = true;
          t.browseLoading = true;
          t.browsePath = target;
          try {
            const r = await transferApi('list', { type: t.kind, credential: t.cred.trim(), path: target });
            absorbCred(r);
            t.browsePath = r.path || target;
            t.browseEntries = (r.entries || []).filter(e => e.is_dir);
          } catch (e) {
            t.browseOpen = false;
            t.error = trFriendly(e);
          } finally {
            t.browseLoading = false;
          }
        };
        const pickDir = (p) => {
          tr.value.dir = p;
          tr.value.browseOpen = false;
          saveLocal(dirKey(tr.value.kind), p);
        };

        /**
         * 真正触发一次浏览器下载：先 link 校验（拿不到文件名/大小说明 Cookie 失效或文件不存在），
         * 再用隐藏表单 POST 到 iframe，交给浏览器原生下载（大文件不占内存，PWA 全屏也兼容）。
         */
        const startDownload = async (it) => {
          const t = tr.value;
          await transferApi('link', {
            type: t.kind, credential: t.cred.trim(), id: it.id, path: it.path || ''
          });
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/api/transfer/download';
          form.target = 'tr-dl-frame';
          form.style.display = 'none';
          const fields = { kind: t.kind, credential: t.cred.trim(), id: it.id, path: it.path || '' };
          if (feToken.value) fields.token = feToken.value;
          Object.keys(fields).forEach(k => {
            const el = document.createElement('input');
            el.type = 'hidden';
            el.name = k;
            el.value = fields[k];
            form.appendChild(el);
          });
          document.body.appendChild(form);
          form.submit();
          setTimeout(() => {
            try { document.body.removeChild(form); } catch (e) {}
          }, 1000);
        };

        const downloadItem = async (it) => {
          const t = tr.value;
          if (t.dlId) return;
          t.dlId = it.id;
          t.error = '';
          try {
            await startDownload(it);
            showToast('已开始下载：' + it.name);
          } catch (e) {
            t.error = trFriendly(e);
          } finally {
            setTimeout(() => { tr.value.dlId = ''; }, 1500);
          }
        };

        /** 依次下载多个文件；max 限制自动下载的个数，避免浏览器把多文件下载当弹窗拦掉 */
        const downloadAll = async (max) => {
          const t = tr.value;
          if (t.dlAll) return;
          const list = downloadable.value.slice(0, max || downloadable.value.length);
          if (!list.length) return;
          t.dlAll = true;
          t.error = '';
          try {
            for (const it of list) {
              await startDownload(it);
              // 每个文件之间留一点间隔，浏览器才不会把后面的都拦掉
              await new Promise(r => setTimeout(r, 1200));
            }
            showToast('已开始下载 ' + list.length + ' 个文件', 'ok');
          } catch (e) {
            t.error = trFriendly(e);
          } finally {
            t.dlAll = false;
          }
        };
        // iframe 里的下载失败时，Worker 回一段 HTML 向父窗口 postMessage
        window.addEventListener('message', (ev) => {
          const d = ev && ev.data;
          if (d && d.type === 'transfer-download-error') {
            if (d.error === 'unauthorized') { showToast('需要访问密码，请先解锁', 'error'); return; }
            showToast('下载失败：' + (d.message || '未知错误'), 'error');
          }
        });

        /* ---------------- PWA 安装 ---------------- */
        const canInstall = ref(false);
        let deferredPrompt = null;

        const getCloudLabel = (type) => cloudLabels.value[type] || type || '其他网盘';

        /* ---------------- 带访问令牌的数据请求 ----------------
           后台开启前台密码后，搜索/测活/频道/插件接口都要求令牌；
           这里统一注入请求头，并在收到 401 时立即退回登录门。 */
        const apiFetch = async (url, init) => {
          const opts = Object.assign({}, init || {});
          const headers = Object.assign({}, opts.headers || {});
          if (feToken.value) headers['X-Frontend-Token'] = feToken.value;
          opts.headers = headers;

          const res = await fetch(url, opts);
          if (res.status === 401) {
            feToken.value = '';
            try { localStorage.removeItem(FE_TOKEN_KEY); } catch (e) {}
            locked.value = true;
          }
          return res;
        };

        const unlock = async () => {
          const pwd = unlockInput.value.trim();
          if (!pwd) return;
          unlocking.value = true;
          unlockError.value = '';
          try {
            const res = await fetch('/api/frontend/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pwd })
            });
            const d = await res.json().catch(() => ({}));
            if (res.ok && d.code === 0 && (d.token || d.enabled === false)) {
              if (d.token) {
                feToken.value = d.token;
                try { localStorage.setItem(FE_TOKEN_KEY, d.token); } catch (e) {}
              }
              unlockInput.value = '';
              locked.value = false;
            } else {
              unlockError.value = d.message || '密码错误，请重新输入';
            }
          } catch (e) {
            unlockError.value = '无法连接服务，请检查网络';
          } finally {
            unlocking.value = false;
          }
        };

        // 扁平化全部结果列表
        const allList = computed(() => {
          const list = [];
          for (const [type, items] of Object.entries(mergedResults.value)) {
            items.forEach(it => list.push({ ...it, cloudType: type }));
          }
          return list;
        });

        /**
         * 分类 Tab 的展示顺序：
         * 先按后台配置的 visible_cloud_types 顺序，未在配置里登记的类型追加在后面。
         */
        const tabTypes = computed(() => {
          const types = Object.keys(mergedResults.value);
          const pref = visibleCloudTypes.value.filter(t => types.indexOf(t) >= 0);
          const rest = types.filter(t => pref.indexOf(t) < 0);
          return pref.concat(rest);
        });

        // 当前 Tab 选中的结果列表
        const currentList = computed(() => {
          if (activeTab.value === 'all') {
            return allList.value;
          }
          return (mergedResults.value[activeTab.value] || []).map(it => ({
            ...it,
            cloudType: activeTab.value
          }));
        });

        // 根据「只看有效」过滤后的列表
        const displayedList = computed(() => {
          if (!filterValidOnly.value) return currentList.value;
          return currentList.value.filter(it => {
            const st = itemStatusMap.value[it.url];
            return st && (st.status === 'valid' || st.valid === true);
          });
        });

        const hasCheckedAny = computed(() => Object.keys(itemStatusMap.value).length > 0);

        // 已出结果的检测条数（不含仍在检测中的）
        const checkedCount = computed(
          () => Object.values(itemStatusMap.value).filter(s => s && s.status !== 'checking').length
        );
        const validOnlyCount = computed(() => {
          return currentList.value.filter(it => {
            const st = itemStatusMap.value[it.url];
            return st && (st.status === 'valid' || st.valid === true);
          }).length;
        });

        const getStatusClass = (status) => {
          if (status === 'valid') return 'status-valid';
          if (status === 'invalid') return 'status-invalid';
          if (status === 'checking') return 'status-checking';
          return 'status-unknown';
        };

        const getStatusIcon = (status) => {
          if (status === 'valid') return 'fa-circle-check text-emerald-600';
          if (status === 'invalid') return 'fa-circle-xmark text-rose-600';
          if (status === 'checking') return 'fa-circle-notch fa-spin text-blue-600';
          return 'fa-circle-question text-slate-400';
        };

        const formatDateTime = (dt) => {
          if (!dt) return '刚刚';
          try {
            const d = new Date(dt);
            if (isNaN(d.getTime())) return dt.slice(0, 10);
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return m + '-' + day;
          } catch (e) {
            return dt.slice(0, 10);
          }
        };

        const copyText = (txt, msg) => {
          if (!txt) return;
          navigator.clipboard.writeText(txt).then(() => {
            alert(msg || '已复制到剪贴板');
          }).catch(() => {
            prompt('请手动复制：', txt);
          });
        };

        // 单个链接测活
        const checkSingle = async (item) => {
          if (!item || !item.url) return;
          itemStatusMap.value[item.url] = { status: 'checking', label: '检测中...' };
          try {
            const r = await apiFetch('/api/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: item.url,
                password: item.password || '',
                type: item.cloudType || ''
              })
            });
            const d = await r.json();
            itemStatusMap.value[item.url] = {
              status: d.status || (d.valid ? 'valid' : 'invalid'),
              label: d.label || (d.valid ? '有效' : '已失效'),
              valid: d.valid
            };
          } catch (e) {
            itemStatusMap.value[item.url] = { status: 'unknown', label: '未知', valid: undefined };
          }
        };

        // 测活队列：4 路并发消费（复用同一套 worker，避免重复发起）
        const runCheckQueue = async (list) => {
          if (batchChecking.value || !list || list.length === 0) return;
          batchChecking.value = true;
          checkingTarget.value = checkedCount.value + list.length;

          const queue = [...list];
          const worker = async () => {
            while (queue.length > 0) {
              const it = queue.shift();
              if (!it) break;
              if (itemStatusMap.value[it.url] && itemStatusMap.value[it.url].status !== 'unknown') {
                continue;
              }
              await checkSingle(it);
            }
          };

          await Promise.all([worker(), worker(), worker(), worker()]);
          batchChecking.value = false;
        };

        // 手动批量：检测当前分类下所有链接（最多前 40 条）
        const batchCheckCurrent = () => runCheckQueue(currentList.value.slice(0, 40));

        // 自动测活：搜索完成后检测前若干条，数量刻意压小以免拖慢首屏
        const AUTO_CHECK_LIMIT = 24;
        const runAutoCheck = () => {
          if (!autoCheck.value) return;
          const list = currentList.value
            .slice(0, AUTO_CHECK_LIMIT)
            .filter(it => !itemStatusMap.value[it.url]);
          return runCheckQueue(list);
        };

        // 开关：开启时立即对当前结果补测一次
        const toggleAutoCheck = () => {
          autoCheck.value = !autoCheck.value;
          if (autoCheck.value) runAutoCheck();
        };

        /* ---------------- PWA：安装到桌面 ---------------- */
        const installPwa = async () => {
          if (!deferredPrompt) return;
          try {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
          } catch (e) {}
          deferredPrompt = null;
          canInstall.value = false;
        };

        const SHARD_CONCURRENCY = 4;
        let cachedChannelsInfo = null;
        let cachedPluginsInfo = null;

        const doSearch = async () => {
          const kw = keyword.value.trim();
          if (!kw) return;

          loading.value = true;
          searched.value = true;
          activeTab.value = 'all';
          mergedResults.value = {};
          totalCount.value = 0;
          itemStatusMap.value = {};
          filterValidOnly.value = false;
          searchProgress.value = { done: 0, total: 0 };

          const merged = {};
          const seen = new Set();
          const commit = () => {
            const snapshot = {};
            for (const k in merged) snapshot[k] = merged[k].slice();
            mergedResults.value = snapshot;
            totalCount.value = seen.size;
          };
          const bump = () => {
            searchProgress.value = {
              done: searchProgress.value.done + 1,
              total: searchProgress.value.total
            };
          };
          // 后端仍会把全部网盘类型返回给第三方 API 调用方，
          // 网页端则在这里按后台配置过滤掉「不在展示白名单里」的网盘。
          const mergeInto = (byType) => {
            for (const type in byType) {
              if (cloudFilterActive.value && visibleCloudTypes.value.indexOf(type) < 0) continue;
              if (!merged[type]) merged[type] = [];
              for (const item of byType[type]) {
                if (seen.has(item.url)) continue;
                seen.add(item.url);
                merged[type].push(item);
              }
            }
          };

          try {
            if (!cachedChannelsInfo) {
              const chRes = await apiFetch('/api/channels');
              cachedChannelsInfo = await chRes.json();
            }
            if (!cachedPluginsInfo) {
              try {
                const plRes = await apiFetch('/api/plugins');
                cachedPluginsInfo = await plRes.json();
              } catch (e) {
                cachedPluginsInfo = { plugins: [] };
              }
            }
            const all = (cachedChannelsInfo && cachedChannelsInfo.channels) || [];
            const size = (cachedChannelsInfo && cachedChannelsInfo.shard_size) || 8;
            const pluginIds = ((cachedPluginsInfo && cachedPluginsInfo.plugins) || [])
              .map(p => p && p.id)
              .filter(Boolean);

            const shards = [];
            for (let i = 0; i < all.length; i += size) shards.push(all.slice(i, i + size));

            // 插件（原生源）同样要分片：每个源都是一次独立的外部 HTTP 抓取，
            // 全塞进一个请求会撞上 Workers 的子请求/CPU 上限，前面的源超时后面的就再也跑不到。
            const PLUGIN_SHARD_SIZE = 3;
            const pluginShards = [];
            for (let i = 0; i < pluginIds.length; i += PLUGIN_SHARD_SIZE) {
              pluginShards.push(pluginIds.slice(i, i + PLUGIN_SHARD_SIZE));
            }

            searchProgress.value = { done: 0, total: shards.length + pluginShards.length };

            // 频道分片任务
            const shardTask = async () => {
              if (shards.length === 0) return;
              let cursor = 0;
              const worker = async () => {
                while (true) {
                  const idx = cursor++;
                  if (idx >= shards.length) return;
                  try {
                    const r = await apiFetch('/api/search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ kw, channels: shards[idx], res: 'merge' })
                    });
                    const d = await r.json();
                    mergeInto(d.merged_by_type || {});
                    commit();
                  } catch (e) {
                    console.warn('分片检索失败', shards[idx], e);
                  }
                  bump();
                }
              };
              await Promise.all(
                new Array(Math.min(SHARD_CONCURRENCY, shards.length)).fill(0).map(worker)
              );
            };

            // 插件任务（按片并发）
            const pluginTask = async () => {
              if (pluginShards.length === 0) return;
              let cursor = 0;
              const worker = async () => {
                while (true) {
                  const idx = cursor++;
                  if (idx >= pluginShards.length) return;
                  try {
                    const r = await apiFetch('/api/search', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ kw, plugins: pluginShards[idx], res: 'merge' })
                    });
                    const d = await r.json();
                    mergeInto(d.merged_by_type || {});
                    commit();
                  } catch (e) {
                    console.warn('插件分片检索失败', pluginShards[idx], e);
                  }
                  bump();
                }
              };
              await Promise.all(
                new Array(Math.min(SHARD_CONCURRENCY, pluginShards.length)).fill(0).map(worker)
              );
            };

            await Promise.all([shardTask(), pluginTask()]);
          } catch (e) {
            console.error('搜索异常', e);
            alert('搜索请求失败，请检查网络连接');
          } finally {
            loading.value = false;
            // 自动测活（默认开启）：结果落盘后立刻开始检测
            if (autoCheck.value) runAutoCheck();
          }
        };

        const quickSearch = (tag) => {
          keyword.value = tag;
          doSearch();
        };

        const resetToHome = () => {
          keyword.value = '';
          searched.value = false;
          mergedResults.value = {};
          itemStatusMap.value = {};
          activeTab.value = 'all';
        };

        onMounted(async () => {
          // 后台可配置项：版本号 / 展示哪些网盘 / 是否展示自动测活
          try {
            const res = await fetch('/api/ui-config');
            const cfg = await res.json();
            if (cfg && cfg.code === 0) {
              if (cfg.version_label) versionLabel.value = cfg.version_label;
              if (Array.isArray(cfg.visible_cloud_types)) {
                visibleCloudTypes.value = cfg.visible_cloud_types;
                cloudFilterActive.value = true;
              }
              if (cfg.cloud_labels && typeof cfg.cloud_labels === 'object') {
                cloudLabels.value = cfg.cloud_labels;
              }
              showAutoCheck.value = cfg.show_auto_check !== false;
              autoCheck.value = showAutoCheck.value;
              // V1.3：后台开了前台访问密码 → 没有本地令牌就先弹登录门
              // （本地令牌若已失效，第一次数据请求会 401，再由 apiFetch 退回登录门）
              if (cfg.frontend_auth_enabled) {
                locked.value = !feToken.value;
              } else {
                locked.value = false;
              }
              // V1.6：转存功能（后台开启时下发能力表）
              transferEnabled.value = cfg.transfer_enabled === true && Array.isArray(cfg.transfer_caps);
              const caps = {};
              (cfg.transfer_caps || []).forEach(c => { caps[c.key] = c; });
              transferCaps.value = caps;
              // V1.6.1：哪些网盘已有站长配置好的 Cookie（只拿到布尔值）
              transferReady.value = cfg.transfer_cred_ready && typeof cfg.transfer_cred_ready === 'object'
                ? cfg.transfer_cred_ready
                : {};
            }
          } catch (e) {}

          try {
            const res = await fetch('/api/hot');
            const data = await res.json();
            if (data.hotSearches && data.hotSearches.length > 0) {
              hotSearches.value = data.hotSearches;
            }
          } catch (e) {}

          // PWA：捕获安装事件，供顶栏「安装到桌面」按钮使用
          window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            canInstall.value = true;
          });
          window.addEventListener('appinstalled', () => {
            deferredPrompt = null;
            canInstall.value = false;
          });

          // 注册 Service Worker：必须由根路径 /sw.js 提供才能拿到全站作用域
          if ('serviceWorker' in navigator && location.protocol === 'https:') {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        });

        return {
          keyword,
          searched,
          loading,
          activeTab,
          hotSearches,
          mergedResults,
          tabTypes,
          totalCount,
          currentList,
          displayedList,
          searchProgress,
          itemStatusMap,
          batchChecking,
          filterValidOnly,
          autoCheck,
          toggleAutoCheck,
          checkingTarget,
          checkedCount,
          hasCheckedAny,
          validOnlyCount,
          getStatusClass,
          getStatusIcon,
          formatDateTime,
          copyText,
          checkSingle,
          batchCheckCurrent,
          getCloudLabel,
          // V1.2 新增
          versionLabel,
          showAutoCheck,
          canInstall,
          installPwa,
          doSearch,
          quickSearch,
          resetToHome,
          // V1.3：前台访问密码
          locked,
          unlockInput,
          unlockError,
          unlocking,
          showUnlockPwd,
          unlock,
          // V1.6：网盘转存
          tr,
          toast,
          transferEnabled,
          transferCaps,
          transferReady,
          credReady,
          cookieHint,
          allSelected,
          downloadable,
          canTransfer,
          openTransfer,
          closeTransfer,
          quickDownload,
          doAuto,
          downloadAll,
          doPreview,
          doSave,
          toggleAllItems,
          browseDir,
          pickDir,
          downloadItem,
          joinDir,
          parentDir,
          fmtSize,
          sizeLabel
        };
      }
    });

    // 仅当 URL 带 ?debug=1 时暴露调试句柄：
    // Vue 生产版不会设置 container.__vue_app__，自动化脚本（ui_shot.mjs）
    // 需要它来注入模拟数据、读取内部状态做布局回归验证。
    if (location.search.indexOf('debug=1') >= 0) {
      window.__pansouApp = app;
    }

    app.mount('#app');
  </script>
</body>
</html>
`;
