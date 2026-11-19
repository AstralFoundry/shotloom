# Web 首页与下载页（2026-11-19）

## 页面与入口

- `/`：公开首页，使用品牌标识和真实的画布、生成节点、三维导演台与剪辑界面截图。
- `/download`：公开下载页，按平台展示版本、体积、发布日期、安装说明与 SHA-256 校验文件。
- `/app`：原有工作台；PWA 的启动地址同步改为 `/app`。
- 根路径带 `native`、`project`、`route`、`folder`、`panel` 或 `auth` 参数时继续打开原工作台，保留安卓预热、内嵌画布、旧项目链接与登录恢复。
- `/native`、`/admin` 与原 API 保持现有处理流程。

公开页面使用独立 HTML 与样式，不加载 JavaScript、React、登录检查或画布模块；截图转换为 WebP。现有工作台入口仍为 `main-DMzNxfHh.js`。Vite 构建同时包含三个 HTML 入口，桌面本地 `index.html` 不受首页路由影响。

## 发布包

下载链接直接指向 Supabase Storage 的独立 `shotloom-releases` 桶，使用包含平台与版本的固定对象路径，无需登录；网页不关联 GitHub 下载。

| 平台 | 版本 | 文件 | 字节数 |
| --- | --- | --- | ---: |
| macOS Apple Silicon | 0.9.2 正式版 | Shotloom-0.9.2-mac-arm64.dmg | 275842271 |
| Windows x64 | 0.9.2 正式版 | Shotloom-0.9.2-win-x64.exe | 243115903 |
| Android arm64 / x86_64 | 0.9.11 预览版 | Shotloom-0.9.11.apk | 52097380 |

iOS 没有可分发安装包，页面明确显示尚未发布并提供网页版入口。Linux 与其他架构也提供网页版替代入口。

SHA-256 记录在 `renderer/public/site/SHA256SUMS`。桌面包已拉取至服务器私有暂存目录，Android APK 与已验收的 0.9.11 使用同一文件，哈希已核对。

新版本发布时，同步更新下载 HTML 的版本、大小、日期、对象路径与校验文件；公开版本对象不覆盖写入。仅发布凭据能够写入，业务素材桶的访问权限不变。

## 验证

- 服务端 34 项测试：30 项通过、4 项外部集成测试跳过。
- 新增真实临时静态目录的路由测试，覆盖公开页面、旧根路径参数、工作台、管理页、原生桥、静态文件、API 404 与尾斜线重定向。
- 主工程与服务端 TypeScript、模块分层、样式、标准 UI 控件、测试架构和 diff whitespace 检查通过。
- Vite 发布构建通过；两张公开页面没有脚本标签。
- 浏览器分别检查 320 / 375 / 768 / 1440 像素宽度，共 8 个页面状态：无横向溢出、无失败图片、链接触控尺寸至少 44 像素、无 API 请求。
- 桌面与移动截图在根工作区 `output/web-*.png`，浏览器检查记录在 `output/site-browser-qa.log`。

## 当前部署状态

正式站已部署 `20261119-web-home-download-001`：首页为 `https://shotloom.0xfiang.com/`，下载页为 `https://shotloom.0xfiang.com/download`。保留上一版本镜像与配置备份用于回滚。

用户升级 Supabase 后，实测全局单文件上限为 524,288,000 字节。已创建公开读取的独立发布桶 `shotloom-releases`，三个安装包全部上传，逐个匿名完整下载并核对字节数与 SHA-256；均与上表及校验文件一致。现有业务素材桶权限未修改。

额外验证：公开校验文件内容正确；未提供凭据和提供公开客户端凭据的上传请求均被拒绝；三个包的匿名 HEAD 返回正确体积，Range GET 返回 206、正确文件名和指定字节数。候选环境及正式域名的首页、下载页、5 个静态资源和 7 个旧工作台路径均通过 HTTP 验收，匿名登录状态接口仍返回 401。公开页面没有登录、画布或 API 加载。

正式服务容器健康状态为 healthy；公网浏览器再次检查 375 / 1440 像素宽度的两个页面，无横向溢出、失败图片、过小链接、脚本和 API 请求。记录保存于 `output/site-public-browser-qa.log`、`output/site-public-http-qa.json`、`output/release-storage-publication.log`；公网截图为 `output/web-download-public.png`。

未进行 Windows / macOS 新一轮安装运行测试；本次不重打 Android 包，也未生成 iOS 包。
