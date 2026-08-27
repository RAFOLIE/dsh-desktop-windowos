import { createContext, useContext } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Supported UI locales. Adding a language = add a Dict entry below + a segment
 *  in the settings「语言」row — no component changes needed. */
export type Locale = "zh" | "en";

/** Source-of-truth dictionary (Chinese). Every key must exist in every locale:
 *  `Dict = Record<keyof typeof zh>` turns a missed translation into a compile
 *  error instead of leaked CJK. `{name}`-style tokens interpolate via t(). */
export const zh = {
  // --- shell boot views ---
  "boot.starting": "正在启动 DSH…",
  "boot.npxFirstRun": "首次运行需下载 DSH 包,可能需要几分钟,请耐心等待",
  "boot.updateDownloading": "正在更新应用 v{version}…完成后自动进入",
  "boot.updateDoneRestarting": "已更新到 v{version},正在自动重启…",
  "boot.updateFailedSkipped":
    "应用更新失败(网络),已跳过——下次启动自动重试,或稍后用托盘「检查前端更新」",
  "boot.viewLog": "查看日志",
  "boot.waitingUpdate": "等待应用更新完成…",
  "boot.newReadyRestarting": "新版本已就绪,自动重启中…",
  "boot.opening": "正在打开…",
  "boot.newVersionReady": "新版本 v{version} 已就绪,应用即将自动重启生效",

  // --- notfound chooser ---
  "nf.title": "未找到本机 DSH",
  "nf.detail":
    "已搜索 PATH(where dsh,含 npm 全局 dsh/dsh.cmd)、应用目录与用户目录,均未发现 DSH 安装。推荐一键安装:",
  "nf.installFastest": "一键全局安装并启动(已选最快:{source} {ms})",
  "nf.installPlain": "一键全局安装并启动(推荐,约 1-3 分钟)",
  "nf.switchInstall": "改用{source}安装({ms})",
  "nf.sourceOfficial": "官方源",
  "nf.sourceMirror": "国内镜像",
  "nf.msUnreachable": "不通",
  "nf.downloadNpx": "下载并启动(npx 缓存,备选)",
  "nf.pathPlaceholder": "已知安装位置?粘贴 dsh.cmd 完整路径",
  "nf.usePath": "使用此路径启动",
  "nf.reScan": "重新检测",
  "nf.exit": "退出",
  "nf.globalHint":
    "全局安装后终端可用 dsh 命令,应用启动最快且无需网络;不想全局装就选 npx 备选或填路径",

  // --- error view ---
  "err.title": "DSH 启动失败",
  "err.retry": "重试",
  "err.npxFallback": "改用 npx 下载启动",

  // --- titlebar ---
  "tb.manage": "环境管理",
  "tb.minimize": "最小化",
  "tb.restore": "还原",
  "tb.maximize": "最大化",
  "tb.closeHint": "关闭(隐藏到托盘,DSH 继续运行)",

  // --- shared ---
  "common.notDetected": "未检测到",
  "common.copy": "复制",
  "common.openDir": "打开目录",
  "common.copied": "已复制",
  "common.checking": "检测中…",
  "common.close": "关闭",

  // --- relative time ---
  "time.justNow": "刚刚",
  "time.minAgo": "{n} 分钟前",
  "time.hourAgo": "{n} 小时前",
  "time.dayAgo": "{n} 天前",

  // --- tabs ---
  "tab.env": "环境",
  "tab.log": "日志",
  "tab.update": "更新",
  "tab.settings": "设置",

  // --- log viewer ---
  "log.pauseAuto": "暂停自动刷新",
  "log.resumeAuto": "恢复自动刷新",
  "log.copyAll": "复制全部",
  "log.clearDisplay": "清空显示",
  "log.jumpLatest": "跳到最新",
  "log.reading": "读取中…",
  "log.cleared": "(已清空显示,新日志继续到达)",
  "log.empty": "(空)",

  // --- update tab ---
  "upd.installed": "已安装版本",
  "upd.latest": "最新版本",
  "upd.lastCheck": "上次检查",
  "upd.check": "检查",
  "upd.channelTitle": "更新通道",
  "upd.channelHelpBackend": "选择全局 dsh 升级时要安装的 npm 发行通道",
  "upd.channelHelpApp": "桌面壳自动更新追踪的发行通道",
  "upd.bchLatestTitle": "npm latest — 推荐",
  "upd.bchLatestDesc": "稳定通道,大多数用户使用",
  "upd.bchNextTitle": "npm next — 预发布",
  "upd.bchNextDesc": "rc 候选通道,抢先体验新功能",
  "upd.achStableTitle": "稳定版 — 推荐",
  "upd.achStableDesc": "跟踪 latest,不含开发版",
  "upd.achDevTitle": "预发布版 — 开发通道",
  "upd.achDevDesc": "含每轮迭代与稳定性检查版",
  "upd.copyAndUpdate": "复制并更新",
  "upd.updateNow": "立即更新",
  "upd.nowUpdating": "更新中…(约 1 分钟)",
  "upd.confirmUpgrade": "升级全局 dsh 到 {label}?会重启 DSH 后端(会话数据保留)",
  "upd.npmLatest": "npm latest(稳定版)",
  "upd.npmNext": "npm next(rc 预发布)",
  "upd.doneNote": "升级完成({stamp}),后端已按新版本重启",
  "upd.failNote": "升级失败,详见日志",
  "upd.badgeHasUpdate": "有可用更新",
  "upd.badgeStable": "稳定版",
  "upd.badgePreview": "预览版",
  "upd.autoOn": "自动更新开启:发现新版即下载换装并自动重启",
  "upd.autoOff": "自动更新已关闭:启动仍检测并播报新版,不下载",
  "upd.autoUpdate": "自动更新",
  "upd.manualHint":
    "立即更新按所选通道检查并安装(不受自动更新开关限制);验证后旧 exe 保留为 .old",

  // --- settings tab ---
  "set.groupAppearance": "外观",
  "set.groupWindow": "窗口",
  "set.groupPanel": "面板",
  "set.theme": "界面主题",
  "set.themeDesc": "壳界面即时生效；内嵌网页在重启应用后跟随所选配色",
  "set.themeSystem": "跟随系统",
  "set.themeDark": "深色",
  "set.themeLight": "浅色",
  "set.language": "语言 / Language",
  "set.langDesc": "切换即时生效；托盘菜单同步更新。Embedded page follows after restart.",
  "set.alwaysOnTop": "窗口置顶",
  "set.alwaysOnTopDesc": "总是保持在其他窗口最前",
  "set.autostart": "开机自启",
  "set.autostartDesc": "登录 Windows 后自动启动(最小化待命,后端随应用走)",
  "set.closeAction": "关闭按钮行为",
  "set.closeActionHelp": "决定点击标题栏 X 键时应用做什么",
  "set.closeTray": "隐藏到托盘 — 推荐",
  "set.closeTrayDesc": "关闭窗口后 DSH 继续运行,双击托盘图标找回",
  "set.closeExit": "直接退出",
  "set.closeExitDesc": "点击 X 即退出应用并关闭 DSH 后端",
  "set.rememberTab": "记住上次页签",
  "set.rememberTabDesc": "重新打开面板时落在上次停留的页签(日志直落入口不受影响)",

  // --- env tab ---
  "env.searchPlaceholder": "搜索环境信息",
  "env.resizingHint": "拖动调整宽度 · 双击重置",
  "env.collecting": "正在采集环境信息…",
  "env.detectFailed": "检测失败:",
  "env.reDetect": "重新检测",
  "env.secRuntime": "运行状态",
  "env.secCore": "DSH 内核",
  "env.secVersions": "组件版本",
  "env.secStorage": "位置与存储",
  "env.appStatus": "应用状态",
  "env.statusRunning": "运行正常",
  "env.statusNoReply": "无应答",
  "env.ownerPid": "占用进程 PID",
  "env.procCmdline": "进程命令行",
  "env.ownership": "归属",
  "env.ownLocal": "本地",
  "env.ownExternal": "外部",
  "env.ownMonitored": "本应用子进程(受监护)",
  "env.ownForeign": "外部实例(不归本应用管)",
  "env.parentChain": "父链",
  "env.customPath": "自定义路径",
  "env.localInstall": "本地安装",
  "env.dshCmdVar": "DSH_CMD 环境变量",
  "env.dshCwdVar": "DSH_CWD 环境变量",
  "env.npxAuthorized": "npx 回退已授权",
  "env.yes": "是",
  "env.no": "否",
  "env.backendVersion": "DSH 后端 (dsh web)",
  "env.dhVersion": "DeepSeek Harness 版本",
  "env.profileDir": "Profile 目录",
  "env.workDir": "工作目录",
  "env.logDir": "日志目录",
  "env.cacheDir": "缓存目录",
  "env.diskUsage": "磁盘占用 (Profile)",

  // --- panel chrome / bottom bar ---
  "panel.dialogAria": "环境管理",
  "panel.refreshCheck": "刷新检测",
  "panel.restartBackend": "重启后端",
  "panel.moreRestarts": "更多重启方式",
  "panel.fullRestart": "前后端重启",
  "panel.more": "更多",
  "panel.openWorkDir": "打开工作目录",
  "panel.openLogDir": "打开日志目录",
  "panel.copyAllEnv": "复制全部环境信息",
  "panel.envCopied": "环境信息已复制",
  "panel.exportDiag": "导出诊断信息",
  "panel.diagExported": "诊断包已复制+已导出",
  "panel.diagFailed": "诊断包导出失败",
  "panel.confirmRestart": "重启 dsh web 后端?会话数据不丢失,窗口将短暂回到启动页",
  "panel.confirmFullRestart": "前后端重启?应用与 DSH 后端都会重启,会话数据不丢失",
} as const;

export type TKey = keyof typeof zh;
type Dict = Record<TKey, string>;

const en: Dict = {
  "boot.starting": "Starting DSH…",
  "boot.npxFirstRun":
    "First run downloads the DSH package — this can take a few minutes, please wait",
  "boot.updateDownloading": "Updating app to v{version}… entering automatically when done",
  "boot.updateDoneRestarting": "Updated to v{version}, restarting automatically…",
  "boot.updateFailedSkipped":
    "App update failed (network) and was skipped — retried automatically next launch, or use tray \"Check for updates\" later",
  "boot.viewLog": "View log",
  "boot.waitingUpdate": "Waiting for the app update to finish…",
  "boot.newReadyRestarting": "New version is ready, restarting automatically…",
  "boot.opening": "Opening…",
  "boot.newVersionReady": "New version v{version} is ready — the app restarts shortly",

  "nf.title": "No local DSH found",
  "nf.detail":
    "Searched PATH (where dsh, incl. npm global dsh/dsh.cmd), the app directory and the user directory — no DSH installation found. One-click install recommended:",
  "nf.installFastest": "Install globally & start (fastest picked: {source} {ms})",
  "nf.installPlain": "Install globally & start (recommended, ~1-3 min)",
  "nf.switchInstall": "Install from {source} instead ({ms})",
  "nf.sourceOfficial": "official registry",
  "nf.sourceMirror": "China mirror",
  "nf.msUnreachable": "unreachable",
  "nf.downloadNpx": "Download & start (npx cache, fallback)",
  "nf.pathPlaceholder": "Know the install location? Paste the full dsh.cmd path",
  "nf.usePath": "Start with this path",
  "nf.reScan": "Re-scan",
  "nf.exit": "Exit",
  "nf.globalHint":
    "After global install the terminal gains the dsh command and startup is fastest/offline-free; otherwise pick the npx fallback or paste a path",

  "err.title": "DSH failed to start",
  "err.retry": "Retry",
  "err.npxFallback": "Try npx download instead",

  "tb.manage": "Environment manager",
  "tb.minimize": "Minimize",
  "tb.restore": "Restore",
  "tb.maximize": "Maximize",
  "tb.closeHint": "Close (hide to tray, DSH keeps running)",

  "common.notDetected": "Not detected",
  "common.copy": "Copy",
  "common.openDir": "Open folder",
  "common.copied": "Copied",
  "common.checking": "Checking…",
  "common.close": "Close",

  "time.justNow": "just now",
  "time.minAgo": "{n} min ago",
  "time.hourAgo": "{n} h ago",
  "time.dayAgo": "{n} d ago",

  "tab.env": "Env",
  "tab.log": "Log",
  "tab.update": "Update",
  "tab.settings": "Settings",

  "log.pauseAuto": "Pause auto-refresh",
  "log.resumeAuto": "Resume auto-refresh",
  "log.copyAll": "Copy all",
  "log.clearDisplay": "Clear view",
  "log.jumpLatest": "Jump to latest",
  "log.reading": "Reading…",
  "log.cleared": "(view cleared; new lines keep arriving)",
  "log.empty": "(empty)",

  "upd.installed": "Installed version",
  "upd.latest": "Latest version",
  "upd.lastCheck": "Last check",
  "upd.check": "Check",
  "upd.channelTitle": "Update channel",
  "upd.channelHelpBackend": "Which npm release channel upgrades of the global dsh use",
  "upd.channelHelpApp": "Release channel this desktop shell auto-updates through",
  "upd.bchLatestTitle": "npm latest — recommended",
  "upd.bchLatestDesc": "Stable channel, most users",
  "upd.bchNextTitle": "npm next — prerelease",
  "upd.bchNextDesc": "rc candidate channel, early features",
  "upd.achStableTitle": "Stable — recommended",
  "upd.achStableDesc": "Tracks latest, no dev builds",
  "upd.achDevTitle": "Prerelease — dev channel",
  "upd.achDevDesc": "Every iteration & stability-check build",
  "upd.copyAndUpdate": "Copy & update",
  "upd.updateNow": "Update now",
  "upd.nowUpdating": "Updating… (~1 min)",
  "upd.confirmUpgrade":
    "Upgrade the global dsh to {label}? The DSH backend restarts (session data is kept)",
  "upd.npmLatest": "npm latest (stable)",
  "upd.npmNext": "npm next (rc prerelease)",
  "upd.doneNote": "Upgrade finished ({stamp}); backend restarted onto the new version",
  "upd.failNote": "Upgrade failed, see log",
  "upd.badgeHasUpdate": "Update available",
  "upd.badgeStable": "Stable",
  "upd.badgePreview": "Preview",
  "upd.autoOn": "Auto-update on: new versions download, swap and restart automatically",
  "upd.autoOff": "Auto-update off: launches still check and announce, never download",
  "upd.autoUpdate": "Auto-update",
  "upd.manualHint":
    "\"Update now\" checks & installs via the selected channel (ignores the auto-update switch); the old exe is kept as .old after verification",

  "set.groupAppearance": "Appearance",
  "set.groupWindow": "Window",
  "set.groupPanel": "Panel",
  "set.theme": "Theme",
  "set.themeDesc":
    "Shell applies instantly; the embedded page follows after an app restart",
  "set.themeSystem": "System",
  "set.themeDark": "Dark",
  "set.themeLight": "Light",
  "set.language": "Language / Language",
  "set.langDesc":
    "Applies instantly; tray menu follows. 内嵌网页重启应用后跟随所选语言。",
  "set.alwaysOnTop": "Always on top",
  "set.alwaysOnTopDesc": "Keep the window above all others",
  "set.autostart": "Launch at login",
  "set.autostartDesc": "Start automatically on Windows login (minimized to tray; backend rides along)",
  "set.closeAction": "Close button behavior",
  "set.closeActionHelp": "What happens when the titlebar X is clicked",
  "set.closeTray": "Hide to tray — recommended",
  "set.closeTrayDesc": "DSH keeps running; double-click the tray icon to restore",
  "set.closeExit": "Quit outright",
  "set.closeExitDesc": "Clicking X quits the app and stops the DSH backend",
  "set.rememberTab": "Remember last tab",
  "set.rememberTabDesc": "Reopen the panel on the last visited tab (direct log entries unaffected)",

  "env.searchPlaceholder": "Search environment info",
  "env.resizingHint": "Drag to resize · double-click resets",
  "env.collecting": "Collecting environment info…",
  "env.detectFailed": "Detection failed:",
  "env.reDetect": "Re-scan",
  "env.secRuntime": "Runtime status",
  "env.secCore": "DSH core",
  "env.secVersions": "Component versions",
  "env.secStorage": "Locations & storage",
  "env.appStatus": "App status",
  "env.statusRunning": "Running",
  "env.statusNoReply": "No response",
  "env.ownerPid": "Owner process PID",
  "env.procCmdline": "Process command line",
  "env.ownership": "Ownership",
  "env.ownLocal": "Local",
  "env.ownExternal": "External",
  "env.ownMonitored": "Child of this app (supervised)",
  "env.ownForeign": "External instance (not managed here)",
  "env.parentChain": "Parent chain",
  "env.customPath": "Custom path",
  "env.localInstall": "Local install",
  "env.dshCmdVar": "DSH_CMD environment variable",
  "env.dshCwdVar": "DSH_CWD environment variable",
  "env.npxAuthorized": "npx fallback authorized",
  "env.yes": "Yes",
  "env.no": "No",
  "env.backendVersion": "DSH backend (dsh web)",
  "env.dhVersion": "DeepSeek Harness version",
  "env.profileDir": "Profile directory",
  "env.workDir": "Workspace directory",
  "env.logDir": "Log directory",
  "env.cacheDir": "Cache directory",
  "env.diskUsage": "Disk usage (Profile)",

  "panel.dialogAria": "Environment manager",
  "panel.refreshCheck": "Refresh scan",
  "panel.restartBackend": "Restart backend",
  "panel.moreRestarts": "More restart options",
  "panel.fullRestart": "Restart shell & backend",
  "panel.more": "More",
  "panel.openWorkDir": "Open workspace folder",
  "panel.openLogDir": "Open log folder",
  "panel.copyAllEnv": "Copy all environment info",
  "panel.envCopied": "Environment info copied",
  "panel.exportDiag": "Export diagnostics",
  "panel.diagExported": "Diagnostics copied + exported",
  "panel.diagFailed": "Diagnostic export failed",
  "panel.confirmRestart":
    "Restart the dsh web backend? Session data is kept; the window briefly returns to the splash",
  "panel.confirmFullRestart":
    "Restart shell & backend? Both the app and the DSH backend restart; session data is kept",
};

const dicts: Record<Locale, Dict> = { zh, en };

/** Translator for a locale; interpolates {token} placeholders. */
export function makeT(locale: Locale) {
  return (key: TKey, vars?: Record<string, string | number>): string => {
    let text = dicts[locale][key] ?? zh[key];
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.split(`{${k}}`).join(String(v));
      }
    }
    return text;
  };
}

export type T = ReturnType<typeof makeT>;

/** Context value: translator + live preference + setter (App owns persistence,
 *  tray rebuild happens Rust-side inside app_set_ui_locale). */
export type I18n = { t: T; locale: Locale; setLocale: (l: Locale) => void };

export const LocaleContext = createContext<I18n>({
  t: makeT("zh"),
  locale: "zh",
  setLocale: () => {},
});

export function useI18n(): I18n {
  return useContext(LocaleContext);
}

/** Read the persisted locale; anything unknown falls back to "zh". */
export async function loadUiLocale(): Promise<Locale> {
  try {
    const s = await invoke<{ uiLocale?: string }>("app_get_shell_settings");
    return s.uiLocale === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

/** Keep <html lang> aligned (a11y + font shaping). */
export function applyHtmlLang(locale: Locale): void {
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
}
