# dsh-desktop-plugin

> **版本规则(2026-08-16 起)**:本插件与桌面应用**版本线解耦**——应用经 GitHub Release 自由前进(现 v1.6.63,已适配 dsh web 0.1.6-alpha 新版),npm 包随插件内容变更发布(仓库 manifest 现 1.5.13,本版仅新增 DSH Store 兼容矩阵声明、未发 npm;npm 仍为 1.5.12,随下次代码变更发布)。两线版本号不一致是**有意设计**:纯版本号空包只会触发所有用户的插件市场更新提示与重复下载。桌面应用启动时自动把已装插件对齐 npm 最新版(只升不降)。

DSH 插件:安装并启动 [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) 桌面壳(DeepSeek Harness 的 Windows 托盘应用)。

- 插件激活时自动确保桌面应用就绪:缺失则从 GitHub Releases 下载 exe 到 `%LOCALAPPDATA%\Programs\dsh-desktop-windowos\`,并在桌面创建/刷新**不带版本号**的快捷方式「DeepSeek Harness」;已存在则跳过下载
- **自动升级**:每次激活时比对已装版本与最新 Release,有新版自动下载替换(运行中也能安全替换,旧文件保留为 `.old`);下载走多路由链(assetProxy → 直连 → 环境代理 → 本机常见代理端口探活 → 公共镜像)并经 **sha256+大小完整性校验**,镜像被投毒/截断自动换路
- 同时在桌面创建/刷新 `.url` 快捷方式「DeepSeek Harness Web」,用默认浏览器打开 DSH 前端(默认 `http://127.0.0.1:3080`);exe 已安装时复用其鲸鱼图标
- 注册 `desktop_launch` 工具:对话里说"打开桌面应用"即可安装并拉起, agent 可直接调用;exe 缺失时走**后台任务安装**(标准 job_output/job_list 可轮询,完成后自动启动),exe 已存在则前台秒开
- 安装/下载失败不影响 DSH 启动,错误只记录日志,下次激活或调用工具时重试

> **首次双击 exe 会弹 Windows SmartScreen 蓝色警告**("Windows 已保护你的电脑")——exe 未签名所致,点「**更多信息** → **仍要运行**"即可,以后不再弹。

## 安装

```sh
dsh plugin --profile web add dsh-desktop-plugin
```

重启 DSH(`dsh web`)后生效。要求 Windows + Node ^22.19 或 ≥ 24。

## 配置(cordis.patch.yml)

| 字段 | 默认 | 说明 |
|---|---|---|
| autoInstall | true | 激活时自动安装/刷新 |
| autoUpdate | true | 激活时检查并升级新 Release |
| assetProxy | (空) | Release 资产下载镜像前缀(路由链第一跳)。**通常无需配置**:下载会自动尝试 直连→环境代理→本机常见代理端口→公共镜像;仅在需要强制指定镜像时填写 |
| createShortcut | true | 创建桌面应用快捷方式 |
| createWebShortcut | true | 创建前端 Web 快捷方式(.url) |
| installDir | %LOCALAPPDATA%\Programs\dsh-desktop-windowos | exe 安装目录 |
| shortcutName | DeepSeek Harness | 快捷方式名称(无版本号) |
| webShortcutName | DeepSeek Harness Web | Web 快捷方式名称(无扩展名) |
| webUrl | http://127.0.0.1:3080 | Web 快捷方式打开的地址 |
| repoSlug | RAFOLIE/dsh-desktop-windowos | exe 的 GitHub Release 来源 |
| backgroundInstall | true | 工具装 exe 走后台任务;关闭则永远前台安装 |

# English

> **Versioning rule** (since 2026-08-16): npm and the app version lines are decoupled — the app advances freely via GitHub Releases (currently v1.6.63, adapted to dsh web 0.1.6-alpha) while this package ships only when the plugin code changes. The repo manifest is currently 1.5.13 — a manifest-only bump that adds the DSH Store compatibility matrix and is intentionally **not** published to npm (npm stays at 1.5.12 and ships with the next code change). The mismatch is deliberate: identical empty packages would just trigger update prompts for every plugin user. The desktop app aligns installed plugins to npm latest (upgrade only).

DSH plugin that installs and launches [dsh-desktop-windowos](https://github.com/RAFOLIE/dsh-desktop-windowos) — the Windows tray shell for DeepSeek Harness.

- On activation it ensures the desktop app is ready: downloads the exe from GitHub Releases into `%LOCALAPPDATA%\Programs\dsh-desktop-windowos` when missing and creates/refreshes a version-less desktop shortcut "DeepSeek Harness"; existing installs are left alone
- **Auto-update**: each activation compares the installed version with the latest Release and swaps in the new exe when one exists (safe even while the app is running; the old file is kept as `.old`); downloads run a multi-route chain (assetProxy → direct → env proxies → local proxy-port probe → public mirrors) with **sha256 + size integrity checks**, discarding any tampered or truncated mirror automatically
- It also creates/refreshes a "DeepSeek Harness Web" `.url` desktop shortcut that opens the DSH web UI in the default browser (default `http://127.0.0.1:3080`), reusing the desktop exe's whale icon when installed
- Registers the `desktop_launch` tool — say "open the desktop app" in chat and the agent installs/launches it; a missing exe installs as a **background job** (pollable via the standard job_output/job_list tools, auto-launches when done) while an existing exe launches instantly in the foreground
- A failed install never blocks DSH startup; errors are logged and retried on next activation or tool call

> **First launch of the exe shows the Windows SmartScreen warning** ("Windows protected your PC") because the exe is unsigned — click **More info → Run anyway**; it will not appear again.

## Install

```sh
dsh plugin --profile web add dsh-desktop-plugin
```

Restart DSH (`dsh web`) to activate. Requires Windows + Node ^22.19 or ≥ 24.

## Configuration

See the table above; all keys are optional with those defaults.

## 快捷方式配置 / Shortcut configuration

本插件目前不提供 GUI 配置开关。编辑 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`（使用其他 profile 或 `DSH_HOME` 时替换对应路径），在现有 YAML 列表中合并下面的覆盖项。已有相同 id 时合并其 config，不要重复添加或覆盖整个文件：

```yaml
- id: dsh-desktop-plugin
  name: dsh-desktop-plugin
  config:
    createShortcut: false
    createWebShortcut: false
```

保存后重启 `dsh web` 生效。关闭配置只会停止创建/刷新，不会删除已有快捷方式；可自行删除桌面副本或移到开始菜单。配置开启时插件激活会创建/刷新桌面固定位置，移动副本不会改变这个行为。桌面 v1.6.52+ 会把已有的默认 Web 地址迁移为登录入口；本次源码修复使插件保留该迁移结果，旧 npm 1.5.12 仍可能重写裸地址，桌面运行时会修回。

The plugin currently has no GUI configuration switches. Edit the profile's `cordis.patch.yml` at the path above (adjust for your profile or `DSH_HOME`), merging this entry into the existing list and merging `config` when the same id already exists. Restart `dsh web` after saving. Disabling creation does not delete existing shortcuts; remove or move them yourself. When enabled, plugin activation creates/refreshes the fixed desktop locations. Moving a copy does not disable recreation. The source fix preserves the desktop's migrated default login entry; published npm 1.5.12 can still overwrite it, which a running desktop repairs.
