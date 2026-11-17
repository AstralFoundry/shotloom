# Shotloom 原生移动端预览

这是 React Native + Expo SDK 57 的第一阶段客户端。使用原生 Stack 导航、项目库、技能管理、账号与额度页、设置页、反馈／举报表单、个人记录、回复详情和站内通知；画布、导演台和剪辑工作区通过 WebView 继续使用云端应用。

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

原生业务数据仍由服务端持久化，React 状态只保存页面投影和未提交输入。列表使用 FlatList 和服务端分页；已访问的标签保留页面和输入状态；用户数据使用当前登录会话内的 60 秒内存缓存，并合并同时读取。过期后返回页面会更新，手动下拉刷新和恢复前台会强制更新，原生写入及画布成功写入会清理缓存；退出登录清空缓存。鉴权检查不使用页面缓存。

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


## 对齐移动网页版的预览（2026-11-16）

0.9.3 / versionCode 4 的项目库、“我的”、反馈表单使用原生组件；颜色、图标路径、页面层级与移动网页版对齐。反馈入口在“我的”，通知入口与个人记录保留。模型与额度请求失败时展示错误和未知值，不伪造余额。

画布继续加载对应工程的现有网页，链接带 `route=creation`；去除重复原生标题栏，保留系统安全区域。技能、复杂设置和充值沿用网页，普通原生页面不导入 renderer 的 DOM 与领域存储。

构建 43864377209 的签名 release APK 支持覆盖现有同签名 Preview。TypeScript、5 项原生边界/会话测试与 Android/iOS Hermes bundle 检查通过；模拟器中的原生项目库、账号、横屏、举报提交、记录、详情和通知已验证。画布的最终模拟器结果与下载链接见 `docs/features/feedback-notifications-native-mobile.md`。真实第三方 OAuth、付费生成、复杂画布节点和真机触控性能仍需验收。

画布模拟器运行 `43870287115` 通过加载、缩放、拖动和返回验证。当前 APK：`https://shotloom.0xfiang.com/downloads/Shotloom-Preview-20261116-web-ui.apk`；完整证据包：`https://shotloom.0xfiang.com/downloads/Shotloom-Acceptance-20261116-web-ui.zip`。网页补丁 `20261116-canvas-no-float` 另行去除了右下角空白通知悬浮按钮，重新进入画布生效，无需重装 APK。


## 0.9.4：技能原生化与画布保留

技能页使用原生列表与编辑器，支持搜索、新建、修改、启停、Agent 分配、JSON 文件导入及系统分享导出。沿用用户侧 `/catalog/skills` 接口；系统技能不进入自定义列表，同名 ID 和陈旧编辑会被拒绝。保存前合并最新目录并保留无关元数据；接口尚未提供数据库 CAS，不声称目录写入完全原子。

“我的”页分别提供通知和反馈／举报入口。反馈页只保留提交和我的记录；通知页独立。记录使用卡片、状态标签和详情入口，仅超过一页时显示翻页操作。

当前工程的画布 WebView 在 Home 内保留挂载：切换原生标签或返回项目库后再打开同一工程，继续使用同一文档与视口。首次打开、切换其他工程、进程重启或手动重试仍需要初始化。设置和充值继续沿用网页；项目库的导入、管理菜单及新建画布入口进入网页项目管理。项目列表、搜索、排序、文件夹浏览与新建文件夹是原生界面。画布、节点编辑、Agent 对话、导演台和剪辑功能仍由现有网页承载。登录授权和隐藏的会话桥接也继续使用 WebView。

回归测试直接挂载真实 App 树，验证同一工程往返只创建一次 WebView；其他测试覆盖技能导入、元数据保留、冲突识别和接口允许列表。最终签名包、模拟器结果和下载链接见功能文档的 0.9.4 验收记录。


## 0.9.5：通知样式与后台会话重连

后台会话页加载不再清空已登录状态，新请求等待受限桥接恢复；已中断的写入不会自动重放。网络失败显示可重试提示，明确登录失效或账号变化才展开登录页，网页登录层也同步这些结果。

通知改为消息卡片、未读标识、轻量已读操作和独立空态，只在需要时显示全部已读与分页。Android 0.9.5 / versionCode 6 可覆盖安装同签名 Preview。签名构建 `43919611564`、固定构建来源的模拟器验收 `43928376077` 通过，临时会话已撤销。验收截图与安装包按源提交和 SHA-256 校验一致。

APK：`https://shotloom.0xfiang.com/downloads/Shotloom-Preview-20261117-native-095.apk`；验收 ZIP：`https://shotloom.0xfiang.com/downloads/Shotloom-Acceptance-20261117-native-095.zip`。完整范围和验证限制见功能文档 0.9.5 记录。


## 0.9.6（2026-11-17）

设置页使用原生语言选择、Agent 权限与行为开关、默认模型选择、可用模型列表和原生诊断文件分享。移动设置接口仅暴露允许的偏好字段，单项更新不会整份替换账号设置。项目默认模型和画布快捷键仍由画布内的工程设置管理。

内嵌画布使用 `native=embedded` 的布局模式，由原生容器管理安全区和底部导航，网页不再预留隐藏顶栏。首次打开以原生等待提示覆盖鉴权和工作区准备过程，收到实际页面就绪才展示；失败和登录失效仍显示真实恢复页面。同一画布在标签切换时保留 WebView。首次启动、切换工程、进程重启仍需要加载。
