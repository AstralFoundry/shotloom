# Shotloom StarRouter 插件

独立安装的 StarRouter 厂商插件，提供 19 个文本、图片、视频、音频模型，以及 `comfly/1849` 视频超分工具。普通生成与画布工具共用一个连接和 API Key。本插件不随 Shotloom 默认发行。

## 安装

本地 `.shotloom-plugin` 包可在「插件中心 → 安装插件 → 文件或 URL」中选择安装，不需要 npm 账号。

以下 npm 安装方式在包发布后可用。在 Shotloom「插件中心 → 安装插件 → npm 包」中输入：

```text
@shotloom/shotloom-plugin-starrouter
```

安装包含可执行 runtime，检查插件信息后确认信任并安装。在插件设置中填写 StarRouter API Key 和接口地址（默认 `https://starrouter.io/v1`）。模型在生成节点中选择；选中视频节点后，可从画布工具条或右键菜单使用视频超分。

需要 Shotloom `>=0.9.2, <1.0.0`。超分代码由桌面宿主运行，浏览器预览不支持执行该工具。视频输入最大 100 MiB，生成结果保存为新的关联视频节点，原视频保留。

请求协议由本插件自带，无需另装协议。包内不包含 API Key，凭据由 Shotloom 的用户设置保存。

## 本地校验与打包

在 Shotloom 仓库根目录运行：

```sh
npm run plugin -- validate plugin-packages/vendor.starrouter
npm run plugin -- pack plugin-packages/vendor.starrouter /tmp/starrouter.shotloom-plugin
```

## 发布 npm

需要具有 `@shotloom` scope 发布权限的 npm 账号。在本目录运行：

```sh
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org/
```

发布新版本时，同时更新 `package.json` 和 `manifest.json` 的版本。打包白名单仅包含 manifest、README 和 runtime。

## 图标

包内 `icon.png` 随插件分发。manifest 的 `icon` 和 npm 元数据的 `shotloomIcon` 都指向这张图片；应用无需预先内置品牌图标。
