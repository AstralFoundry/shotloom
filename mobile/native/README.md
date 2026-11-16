# Shotloom 原生移动端预览

这是 React Native + Expo SDK 57 的第一阶段客户端。使用原生 Stack 导航、工程列表、反馈／举报表单、个人记录、回复详情和站内通知；画布、导演台和剪辑工作区通过 WebView 继续使用云端应用。

预览包名为 `com.shotloom.app.preview`，不会覆盖现有 Tauri 移动包。现有正式发布流水线继续构建 Tauri；原生 CI 检查 TypeScript、协议行为以及 Android/iOS Hermes bundle。切换正式包需先完成真机验收与签名配置。

## 运行

在仓库根目录执行：

```powershell
npm ci --prefix mobile/native
$env:EXPO_PUBLIC_CLOUD_URL = 'https://shotloom.0xfiang.com'
npm --prefix mobile/native run android
```

`EXPO_PUBLIC_CLOUD_URL` 必须是完整 HTTPS origin，不能包含路径。开发构建也允许 HTTP；真机访问开发服务时使用设备可访问的局域网地址。iOS 构建在安装 Xcode 的 macOS 上运行 `npm --prefix mobile/native run ios`。首次生成原生工程后，日常调试可执行 `npm --prefix mobile/native start`。

使用前先部署带 `/native` 会话页面及反馈／通知接口的前端、服务端，并应用支持反馈／通知的数据库迁移。仅安装客户端不会自动部署这些服务。

## 会话与边界

登录在同一云端 origin 的 WebView 内完成，持久 HttpOnly 会话 Cookie 由 WebView 管理。隐藏的会话页面仅代理明确允许的用户侧接口，原生界面通过请求 ID 接收结果；不会把服务端密钥或 OAuth token 交给客户端。

原生端只接受来自配置 origin 的 `/native` 页面消息。管理接口、模型调用和任意外部 URL 均不在桥接允许列表中。切换账号会被拒绝，需先明确退出；登录过期时覆盖登录页，保留已挂载页面与表单输入。同一提交重试复用请求 ID。

原生业务数据仍由服务端持久化，React 状态只保存页面投影和未提交输入。列表使用 FlatList 和服务端分页；页面重新获得焦点或应用恢复前台时刷新。

支持 `shotloom-preview://notifications` 与 `shotloom-preview://feedback/<记录 UUID>` 链接。读取对应记录仍需登录并通过服务端所有权校验。

## 验证

```powershell
npm --prefix mobile/native run typecheck
npm --prefix mobile/native test
npm --prefix mobile/native run bundle:check
```

协议测试覆盖请求允许列表、响应关联、错误传播和断线清理；服务端测试使用 PGlite 的真实 Postgres 引擎验证反馈、后台回复、站内通知、权限隔离与事务回滚。Hermes bundle 成功不能替代原生编译或真机验收。

发布前须在 Android/iOS 真机验证登录与会话恢复、账号切换、退出、通知链接、返回手势、键盘安全区域、前后台切换、弱网重试，以及工程在 WebView 中的保存与恢复。当前环境未进行真机验收，也未测得启动、滚动和内存性能基线。

依赖审计为 0 漏洞。Expo fingerprint 工具链的 minimatch 已通过定向 override 固定到修复版本 11.0.1，SDK 版本保持兼容。

## Android 验收包（2026-11-16）

已部署配套数据库、API 和 `/native` 页面。独立 release APK 使用项目 Android 证书签名，支持 Android 7.0 及以上的 arm64-v8a / x86_64；运行不依赖 Metro。下载地址：`https://shotloom.0xfiang.com/downloads/Shotloom-Preview-20261116.apk`。

`Native Android preview` 工作流生成并校验签名 APK；`Native Android acceptance smoke` 下载同一分支最新成功产物，在 Android API 35 模拟器中安装并启动到登录入口。2026-11-16 两项均通过；尚未验证真机 OAuth 登录和触控性能。iOS 尚无可安装签名包，缺少 Apple 签名和分发凭据。
