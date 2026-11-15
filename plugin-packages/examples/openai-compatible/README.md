# OpenAI Compatible Protocol

A declarative example of a Shotloom protocol plugin. Replace the npm package name with your own scope before publishing.

这是 Shotloom 声明式协议插件示例。发布前请将 npm 包名替换为自己的名称。

## Connection / 连接

| Field / 字段 | Type / 类型 | Description / 说明 |
| --- | --- | --- |
| baseUrl | URL | Your service's API root / 服务的 API 根地址 |
| apiKey | secret | Configure in a provider connection / 在厂商连接中配置 |

This plugin declares its operation endpoints, authentication and parameters in `manifest.json`. The details page displays those live contracts below this README.

插件在 `manifest.json` 中声明接口、鉴权和参数。详情页会在这份说明下展示实际契约。
