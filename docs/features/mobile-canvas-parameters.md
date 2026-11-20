# 手机画布生成参数

2026-11-21，功能提交 `e7904e6` 合入 `supabase`，生产部署提交为 `ecd8cd5706da28504c50d1a1ed0f2d5e97605436`。合并保留当时线上 `0b3908f` 的 RunningHub 媒体归档修复。

手机端生成参数使用底部 Drawer，替代可能越过屏幕边界的按钮锚定弹层。底栏显示“生成参数”，选项自动换行，主要操作区域至少 44px；支持滚动、安全区域、明暗主题、减少动画以及关闭后恢复入口焦点。参数仍通过现有配置写入，桌面沿用原弹层，局部重绘面板继续复用原参数组件。

验证：renderer TypeScript、样式、UI 与模块分层检查通过；22 项画布、局部重绘及 RunningHub 相关测试通过；Vite 生产编译通过。真实组件浏览器测试覆盖 375×667、430×932、844×390、1440×900 的明暗主题、参数选择、关闭重开、跨断点切换及焦点恢复，并覆盖减少动画模式。

生产地址：`https://shotloom.0xfiang.com`。容器 `shotloom-app-1` 健康，镜像 `shotloom:mobile-params-ecd8cd5`。候选和公网各 19 项资源、哈希、健康及匿名权限检查通过；另从本机重复验证公网资源。脱敏结果保存在发布 worktree 的 `output/mobile-params-public-{smoke,assets}.json`。

发布与回滚材料：`/opt/shotloom-releases/mobile-params-20261121-ecd8cd5/`，包含旧镜像 ID、旧 Compose 覆盖配置、旧静态资源及候选/公网验收结果。当前 Compose 使用其中的 `compose.production.yaml`。回滚时恢复 `static.before.tar.gz` 和 `release.before`，以 `compose.before.yaml` 为覆盖配置，仅重建 Shotloom 的 `app` 服务。

本次没有数据库迁移，没有重发安装包；未进行真实手机触控及系统键盘验收，也未为此次 UI 改动发起付费模型调用。
