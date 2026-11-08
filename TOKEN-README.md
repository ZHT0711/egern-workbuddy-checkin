# 在 iPhone 的 Egern 内抓 WorkBuddy Token

这是你说的 WPS 示例式用法：**手机上的请求经过 Egern → 自动采集并保存在 Egern → 签到脚本直接读取**。采集脚本为 `workbuddy.token.js`，不需要 Windows 提取工具。

## 安装和使用

1. 在 Egern「工具 → 模块 → +」添加采集专用模块地址：

   https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.token.module.yaml

2. 开启模块。所有 JS 都从本仓库远程加载，不需要创建本地文件。如果尚未安装签到，直接使用完整模块 `https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.module.yaml`，不要同时启用两个模块。
3. 开启 Egern 的 MITM，安装并在 iOS 中完全信任它的 CA 证书。采集域名仅为 **`www.codebuddy.cn`**；无需扩大为所有网站。已有证书继续使用。
4. 开启 Egern 服务后，在 **同一台 iPhone** 上访问 [WorkBuddy / CodeBuddy 官网](https://www.codebuddy.cn/)，登录自己的账号，并访问账号、用量或签到相关页面，使相关接口请求经过 Egern。
5. 收到「访问令牌已保存」或「访问令牌和刷新令牌已保存」后，手动运行此前的 **WorkBuddy 每日签到**。它们共用存储，**无需复制 Token**。这条采集通知不等于账号有效；以签到结果为准。

如果原来的 `workbuddy.module.yaml` 中已经启用了「WorkBuddy 凭据采集」及「WorkBuddy 刷新令牌采集」，先关闭这两个旧采集条目，再使用本模块。也可以直接使用完整新版包里的 `workbuddy.module.yaml`，它已经引用新采集脚本；两种模块二选一。

**切换到自动采集时，清空签到脚本/模块 Env 中曾手填的 `WORKBUDDY_ACCESS_TOKEN` 和 `WORKBUDDY_REFRESH_TOKEN`。** 采集数据直接保存在同槽位 session 中。账号槽位保持与签到脚本一致，默认都是 `default`。不会自动删除你其他槽位的数据。

## 不使用模块时的配置片段

在已有 `scriptings` 列表追加下面两个条目，将域名追加到已有 `mitm.hostnames.includes`，不要覆盖原代理配置、证书及其他规则。JS 地址为本仓库远程 Raw URL。

```yaml
scriptings:
  - http_request:
      name: WorkBuddy Token 请求采集
      match: '^https://www\.codebuddy\.cn/v2/'
      script_url: https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.token.js
      body_required: false
      timeout: 10
  - http_response:
      name: WorkBuddy Token 响应采集
      match: '^https://www\.codebuddy\.cn/v2/plugin/auth/token(?:/refresh)?(?:\?|$)'
      script_url: https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.token.js
      body_required: true
      max_size: 131072
      timeout: 10

mitm:
  hostnames:
    includes:
      - www.codebuddy.cn
```

自定义槽位时，在两个采集条目下都增加 `env: { WORKBUDDY_ACCOUNT_KEY: 'main' }`，同时给签到条目配置相同的槽位。

## 具体采集什么

| 位置 | 字段 |
| --- | --- |
| `www.codebuddy.cn/v2/` 请求头 | `Authorization: Bearer ...`、可见的 `X-Refresh-Token`、`X-User-Id`、企业/租户 ID、`X-Domain` |
| `/v2/plugin/auth/token` 登录响应 | `data.accessToken` / `access_token`、`refreshToken` / `refresh_token`、`domain` |
| `/v2/plugin/auth/token/refresh` 刷新响应 | 同上，支持轮换后的令牌 |

响应要求 HTTP 为 2xx，业务 `code` 为数字 `0` 或 `200`，且包含有效访问令牌。字段未变化时不重复保存或弹通知；无法确认同一账号时不沿用旧账号的刷新令牌。刷新请求/响应可通过旧访问令牌或旧刷新令牌关联，避免正常轮换时丢失同账号信息。

访问令牌存入 `workbuddy.egern.v1.<槽位>.session` 的 `accessToken`，刷新令牌存入同一对象的 `refreshToken`。与此前签到脚本的键名和字段完全一致。脚本不会主动发网络请求，不读取 Safari 数据库，不上传令牌，不把完整令牌写进日志或通知，不改动请求；被读取的响应体会原样返回。

## 没抓到时看这里

- **日志提示没有 Bearer：** 当前请求只有 Cookie 或其他登录态。WPS 示例抓的是 `wps_sid`，它不能直接套成 WorkBuddy 的访问令牌。访问网站、完成网页登录不保证一定会经过发放客户端令牌的接口；这个脚本只能保存实际经过手机、可解密流量中的令牌。
- **日志完全不触发：** 查看请求是否经过 Egern、域名是否为 `www.codebuddy.cn`、MITM 是否解密成功。其他设备上的桌面客户端流量不会自动出现在本手机中。
- **只获得 access_token：** 可以先验证签到，但不会凭空生成 refresh_token。只有真正经过的登录/刷新响应或相应请求头携带它时才会保存。
- **通知已保存但签到失败：** 凭据可能已失效或不是签到接口接受的登录态；采集成功仅代表保存成功。

目前完成的是本地模拟验证，包括采集后签到读取、响应透传和故障处理；**尚未在真实 iPhone / Egern 中抓取或使用真实账号验证**。若实际网页始终只有 Cookie，请保留 Egern 请求路径与字段名称等脱敏信息继续排查，避免发送完整 Token。

参考：[WPS Cookie 采集结构](https://github.com/MaYIHEI/paperclip/blob/main/app/wps/wps.cookie.js)、[原 WorkBuddy 接口](https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/blob/main/script/workbuddy/api.py)、[CodeBuddy 登录令牌接口](https://github.com/jlcodes99/cockpit-tools/blob/main/src-tauri/src/modules/codebuddy_cn_oauth.rs)、[Egern API](https://egernapp.com/zh-CN/docs/javascript-api/)。
