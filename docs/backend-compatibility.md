# DSH 双版本连接兼容性

桌面版本：v1.6.65 预发布版。检查日期：2026-09-27。npm 插件版本保持 1.5.12。

| 检查 | 0.1.6-alpha.2 | 0.1.7-alpha.2 |
| --- | --- | --- |
| 已安装 CLI 的 --no-open 能力识别 | 通过 | 通过 |
| 真实内核启动与生产 RPC 就绪探测 | 通过 | 通过 |
| 未鉴权访问 401、进程 token 换取 303 + Cookie | 通过 | 通过 |
| 生产 Cookie 解析、浏览器入口 URL 验证 | 通过 | 通过 |
| Edge 独立网页加载聊天界面 | 通过 | 通过 |
| 跨站 iframe 使用 SameSite=None + Secure Cookie | 通过 | 通过 |
| 聊天输入区逐键输入草稿（不发送） | 通过 | 通过 |
| 刷新后重新加载聊天输入区 | 通过 | 通过 |
| 更新页版本比较、状态恢复与迁移提示 | 通过 | 通过 |

## 范围与首次启动差异

测试使用真实 npm 包、临时 DSH_HOME、随机端口及空白配置。旧版需要添加工作区，测试通过该版公开 workspace/create 接口在临时目录创建工作区，再通过界面选择；新版默认提供工作区。两版首次使用声明、可选的 API Key 向导均在隔离配置中处理，不使用用户凭据或历史会话。

原生 Rust 检查复用生产的就绪探测、启动参数识别、Cookie 解析和浏览器入口验证逻辑。跨站嵌入检查由 Edge 浏览器执行，采用 localhost 外层与 127.0.0.1 内层，以及与桌面 WebView2 注入相同的 Cookie 属性；这不是对 Windows COM 注入动作或完整 Tauri 窗口的端到端自动化。

未调用模型、发送消息或执行真实全局内核升级。第三方插件和历史数据迁移不在这套连接回归的保证范围内。保留其他旧版本的协议适配，但不据此承诺所有版本、插件组合都已验证。

## 防止升级误判

- 桌面升级不要求内核同步升级。
- 更新页列出上述两个连接验证版本。
- 从早于 0.1.7-alpha.1 的版本升级到 0.1.7 设置接口时，页面与安装确认框均提示 settingsScope 插件兼容性变化。
- 同一设置接口内更新不重复显示迁移提醒；降级仍使用原有降级确认。
- 不自动更改、卸载或升级用户插件；内核运行版本核验不等于全部插件激活成功。

## 重跑方式（Windows）

1. 在独立 npm prefix 安装确切版本，不覆盖全局安装：
   npm install --prefix <fixture-prefix> @deepseek-ai/dsh@<exact-version> --save-exact --no-audit --no-fund
2. cargo test --release --manifest-path src-tauri/Cargo.toml --lib --features custom-protocol
3. 指定环境变量：
   - DSH_COMPAT_INSTALLS：JSON 对象，两个版本号分别映射到对应的 @deepseek-ai/dsh 包目录。
   - DSH_COMPAT_TEST_BIN：上一步构建的 dsh_desktop_lib-*.exe 测试程序绝对路径。
   - PLAYWRIGHT_MODULE：已安装 Playwright 模块的位置（可选，缺省从 node_modules 解析）。
4. pnpm test:backend-compatibility
5. pnpm test:backend-update；使用 Vite 1420 端口运行 node tests/backend-update-ui.cjs。

报告写入系统临时目录 dsh-backend-compatibility-results.json，各隔离目录保留截图。脚本只结束自己启动的测试进程，不停止用户后端。测试版本矩阵变更时，应同步 src/backendUpdateModel.ts 中 verifiedBackendVersions。
