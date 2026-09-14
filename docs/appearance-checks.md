# 桌面外观设置

已实现 Codex 设置风格的双主题编辑、DSH / Codex 预设、强调色 / 背景色 / 文字色、层次对比度、独立预览、字体 / 字号、手形光标、半透明侧栏及主题复制、粘贴导入和重置。语言移到常规，保留跟随系统及六种语言；搜索也随之调整。

## 配置与范围

- `uiTheme` 继续保存到原来的原生 `settings.json`，影响下次启动的 WebView 明暗模式。主题写入先暂存再替换，失败返回前端，不报告保存成功。
- 其他外观配置保存在桌面 WebView 的 localStorage：`dsh.appearance.v1`。替换 exe 不清理此存储；开发预览使用独立的浏览器存储。损坏配置回退到默认值。
- 自定义颜色、字体、字号应用于桌面外壳（标题栏、设置、启动页、菜单和日志）。聊天是独立 iframe，本次不注入它的 DOM 或 CSS；聊天明暗仍在重启后同步。
- 字体选择提供本地常见字体建议，也可输入已安装字体名称。不存在的字体由浏览器回退到系统 / 等宽字体；不联网下载、不扫描整个字体目录。
- 半透明侧栏混合应用内部的背景，不启用 Windows 桌面玻璃效果。
- 字号独立于已有的原生窗口缩放。界面 12–20 px，代码 11–22 px。

## 主题格式

复制与导入使用 DSH 自有格式；不宣称与 Codex 剪贴板主题格式互通。导入按 `scheme` 只替换指定的主题，不改变另一套主题、字体或当前模式。

```json
{
  "format": "dsh-theme",
  "version": 1,
  "scheme": "dark",
  "theme": {
    "accent": "#4d6bfe",
    "background": "#191919",
    "foreground": "#ededed",
    "contrast": 50
  }
}
```

校验拒绝未知字段、未知版本、超过 8 KiB 的输入、非六位 HEX 色值、越界数字和文字/背景对比度小于 3:1 的组合。不会执行传入样式。导入与保存失败保留旧配置，错误直接显示在页面内。复制失败提供可选择的文本。

## 验证

- `pnpm test:appearance`：主题往返、非法导入、配色层次、字体回退。
- `pnpm build`：TypeScript 与生产前端构建。
- `tests/appearance-ui.cjs`：在已运行的 `pnpm dev` 上用 Playwright / Edge 测试。通过 `PLAYWRIGHT_MODULE` 指定 Playwright 模块路径；`DSH_SCREENSHOT_DIR` 可指定截图位置。Tauri 调用被模拟，不会更改真实 DSH 或执行安装。
- 浏览器覆盖：语言迁移、浅深主题独立编辑、主题持久化、系统模式、字体字号、透明度、光标、导入校验、剪贴板失败回退、存储失败保留旧值、重置、六语言、窄窗口以及聊天草稿保留。
- 原有设置和更新逻辑做浏览器回归；Rust 运行 release 测试。

## 本地交付

按用户约定用 `pnpm tauri build` 构建，保留旧 exe 的时间戳备份，校验 SHA-256 后同步到 `%LOCALAPPDATA%\Programs\dsh-desktop-windowos`。不修改版本号，不推送远端。若旧进程还在运行，需从托盘退出再打开新文件。

2026-09-14 已交付：5,027,840 字节，SHA-256 `57BF488BD9F8594DB07DA848838246A0B765FAC84BCBC2725437886FDBBE24C9`。旧版备份为安装目录中的 `dsh-desktop-windowos.before-appearance-20260914-143056.exe.bak`。前端构建、4 项外观模型测试、4 项更新模型测试、外观/设置/更新浏览器交互检查通过；Rust 15 项通过、1 项只读主机检查按定义跳过。原有 4 个 Rust 警告仍存在。

随后用户明确要求发布稳定版，应用版本提升至 v1.6.51，npm 插件保持 1.5.12。重新执行 `pnpm tauri build`，验证 Windows 版本资源为 1.6.51，且 exe 含最终 dist 的 JS/CSS 资产指纹。稳定版产物 SHA-256 为 `6194fc5c18e07f5f91dc453b6b0cae9cb963246e23fe263563e4e6c8120a2d00`（5,027,840 字节），并已同步本地安装目录。正式发布说明见 CHANGELOG v1.6.51。
