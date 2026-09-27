# v1.6.64 npm 更新超时修复

## 触发与边界

安装前查询目标版本时连续 ECONNRESET，原 30 秒外层等待终止 npm；未进入安装。此版本修复查询等待和诊断，不更换 registry，不自动升级用户的 DSH。

查询策略：20 秒单次请求、2 次重试、重试间隔 2 秒、90 秒外层上限。安装仍为 600 秒，无应用层自动重跑。查询失败发生在 teardown 前；重试前后端再次核验运行路径、PID、版本、管理权限，成功只认新进程实际运行目标版本。

诊断只保留允许的 npm 错误代码，加上耗时、退出状态和操作名；不复制任意 stderr，以免将认证信息或私人路径写入界面日志。输出缓存有上限；进程结束后的读取等待也有上限，超时前已捕获的错误不会丢失。

## 验证命令

- cargo test --release --manifest-path src-tauri/Cargo.toml --lib --features custom-protocol
- pnpm test:backend-update
- pnpm test:appearance
- node tests/npm-query-retry.cjs
- node tests/backend-update-ui.cjs
- node tests/startup-ui.cjs
- pnpm tauri build

真实 npm 只读查询使用本地模拟 registry，测试断连后恢复、持续断连的三次请求上限、404。独立临时缓存防止 npm 读缓存掩盖失败，测试专用代理排除只作用于该子进程。

界面使用隔离浏览器和 Tauri mock，覆盖等待进度、安装前/安装失败差异、切页恢复、日志入口、重新读取来源后重试、中英文和明暗截图。未执行用户全局 DSH 安装，也未强制停止当前后端。

## 发布状态

此修复随 v1.6.65 预发布版首次发布，GitHub 稳定版仍为 v1.6.63。npm 插件版本保持 1.5.12。
