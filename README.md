# WorkBuddy 每日签到 · iOS Egern

签到对象是 **WorkBuddy / 腾讯 CodeBuddy 中国区**。你给的 WPS Loon 脚本仅用于参考“凭据采集 → 本地保存 → 定时任务 → 通知”的结构。

使用 Egern 当前官方文档的原生 `export default async function(ctx)` API，无第三方运行库。主签到脚本是 `workbuddy.js`；新增的独立采集脚本为 `workbuddy.token.js`，手机本地抓取方法见 `TOKEN-README.md`。需要使用支持该原生 API 的 Egern；不适用于只提供 `$httpClient` / `$persistentStore` 的旧运行方式。

## 推荐安装：Egern 远程模块

在 Egern 的「工具 → 模块 → +」中粘贴以下地址：

```text
https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.module.yaml
```

这个完整模块包含每天 09:05 的签到任务、请求令牌采集及登录/刷新响应采集。脚本使用仓库内的远程 Raw URL，无需创建本地 JS 文件。模块内脚本默认每 24 小时检查一次更新。

1. 添加并开启上面的完整模块；停用之前安装的同类签到/采集条目，避免重复调度。完整模块和下方采集专用模块二选一。
2. 使用自动采集时，让访问令牌和刷新令牌 Env 留空。开启 MITM 并安装、信任证书，在同一手机登录并访问 WorkBuddy，相关请求实际经过 Egern 且携带令牌时会自动保存。详见 [手机采集说明](TOKEN-README.md)。
3. 收到保存通知后，手动运行「WorkBuddy 每日签到」验证，之后按设备定时任务执行。
4. 如果网页只有 Cookie，无法得到签到所需的 Bearer，则可以在模块 Env 手动填写自己的令牌。不要把账号令牌提交到仓库。

已经装好签到、只想增加采集时使用这个模块：

```text
https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.token.module.yaml
```

两种远程模块都只声明 `www.codebuddy.cn` 的 MITM 主机名，不覆盖已有证书。

## 可选：本地定时脚本 + 手动导入令牌

1. 在 Egern 的「工具 → 脚本」创建脚本，名称填 **WorkBuddy 每日签到**，类型选 **schedule / 定时**，文件位置选「本地」，文件名填写 **`workbuddy.js`**。将同名文件的完整内容粘贴到「编辑文件」中保存。
2. 定时表达式填写 **`5 9 * * *`**，执行超时设为 **180 秒**。在这个脚本的 Env / 环境变量中，按下表填入自己的令牌及可选账号字段。也可通过后面的最小配置设置这些字段。
3. 在脚本列表手动运行 **WorkBuddy 每日签到**，确认通知中出现「签到成功」或「今日已签到」。运行成功后，定时任务按设备本地时间每天 **09:05** 执行。确保 Egern 服务在运行，并以手机实际执行记录为准。
4. 这一路径只需要 JS，不需要安装 MITM 证书。仓库中的 YAML 模块已经使用远程脚本地址，也可以直接按前面的远程模块方法安装。

后续若改用模块，模块添加后只保留一个定时条目，避免同一文件被重复调度；保存的本地 JS 文件继续供模块引用。

| Env 名称 | 原仓库配置字段 | 要求 |
| --- | --- | --- |
| `WORKBUDDY_ACCESS_TOKEN` | `access_token` | 必填；可带 `Bearer ` 前缀 |
| `WORKBUDDY_REFRESH_TOKEN` | `refresh_token` | 建议填写，否则过期后需要重新导入 |
| `WORKBUDDY_UID` | `uid` | 有则填写 |
| `WORKBUDDY_ENTERPRISE_ID` | `enterprise_id` | 有则填写，个人账号通常为空 |
| `WORKBUDDY_DOMAIN` | `domain` | 有则填写 |
| `WORKBUDDY_ACCOUNT_NAME` | `account_name` | 可选，通知备注 |
| `WORKBUDDY_ACCOUNT_KEY` | 无 | 可选，默认 `default`，本地存储槽位 |
| `WORKBUDDY_NOTIFY_SUCCESS` | 无 | 可选，填 `false` 关闭正常结果通知 |

令牌从哪里来：如果已有第一个仓库生成的 `config/token.json`，取 `workbuddy.accounts` 中自己账号的对应字段即可。没有时，可以在你自己的电脑上按原仓库的 `import_accounts.py` 说明导出已登录账号。新版桌面客户端的登录文件可能保存密文，不要把 `$wbEncrypted` 等加密内容当作令牌。**此交付包不会读取本机 WorkBuddy 数据，也未内置任何账号。**

## 不使用模块的最小主配置

先按上面的第 1 步保存本地 `workbuddy.js`，再把以下内容合并到你现有的 Egern 配置中。这是配置片段，直接替换整个主配置会丢失原有代理等设置。

```yaml
scriptings:
  - schedule:
      name: WorkBuddy 每日签到
      cron: '5 9 * * *'
      script_url: workbuddy.js
      timeout: 180
      env:
        WORKBUDDY_ACCESS_TOKEN: '在此填入自己的 access_token'
        WORKBUDDY_REFRESH_TOKEN: '在此填入自己的 refresh_token'
        WORKBUDDY_UID: ''
        WORKBUDDY_ENTERPRISE_ID: ''
        WORKBUDDY_DOMAIN: ''
```

如果不填 `refresh_token`，删除对应行或留空，不要保留示例提示文字。

## 可选：像 Loon 示例一样采集凭据

`workbuddy.module.yaml` 包含一个定时任务、两个采集任务和 Env 设置表单，已使用本仓库的远程脚本地址。直接添加前面的 Raw 模块 URL 即可。若合并到已有主配置，已有同名顶层键时追加其内容，避免覆盖原配置。

新增的 `workbuddy.token.js` 采集以下流量，独立安装方法见 `TOKEN-README.md`：

- `https://www.codebuddy.cn/v2/` 请求头中的 Bearer 和可见的刷新令牌。
- `/v2/plugin/auth/token` 登录发令牌响应。
- `/v2/plugin/auth/token/refresh` 刷新响应。

模块已配置两个采集脚本和这个单独域名的 MITM。采集需要 Egern 已安装并信任 MITM 证书，且携带账号令牌的请求确实经过该 Egern 实例并被成功解密。可以访问签到入口触发请求；**普通 Safari 网页登录可能只有 Cookie，不能保证能取得桌面客户端使用的 Bearer 令牌。**

请求采集保存 `Authorization: Bearer ...`、可见的 `X-Refresh-Token` 及账号相关头。登录/刷新响应采集仅在 HTTP 成功、业务 `code` 为数字 `0` 或 `200` 且返回访问令牌时保存 `accessToken` / `refreshToken`，并透传原始响应体。没有取得刷新令牌时会明确通知。改用自动采集时清空原先手填的两个令牌 Env；采集与签到槽位需相同。桌面端请求未经过手机、证书固定或接口未携带 Bearer 时，请使用手动导入方式。

「凭据已保存，待签到验证」只表示已经存储，随后需手动运行签到脚本验证。更换账号时会尽量清除无法确认归属的旧刷新令牌，避免与新账号混用。

## 令牌保存与重新导入

- 账号令牌写入 `ctx.storage`，键为 `workbuddy.egern.v1.<槽位>.session`；签到结果写入同前缀的 `.status`，结果中不含令牌。只使用文档提供的持久化接口，不额外声称其加密或同步特性。
- `Env` 是导入入口。输入令牌未变时优先使用已经续期的本地令牌，避免每日用旧 Env 覆盖新令牌。两个输入令牌任一变化时重新导入。变更 UID / 企业 ID / domain 时，换一个账号槽位后运行即可重新建档。
- 需要彻底重新导入同一组输入时，将 `WORKBUDDY_ACCOUNT_KEY` 改成新值，例如 `main2`。旧槽位保留，便于恢复；如需清理，可通过 Egern 的脚本存储管理能力删除对应的 `.session`、`.status` 键。
- 当前每个任务处理一个账号。需要多个账号时可建立多个 schedule 条目，设置不同 Env 和槽位，并错开时间。凭据采集默认只写 `default` 槽位；多账号建议用手动导入，避免同一请求匹配多个采集任务。
- 不要将填有真实令牌的配置上传到公开仓库。可公开的交付文件均不含令牌；脚本请求目标固定为 `www.codebuddy.cn`，不向第三方转发账号数据。

## 执行逻辑与结果

先查询 `checkin-activity-status`，失败时回退 `checkin-status`；今日已签到或活动未开放就跳过提交。未签到时提交 `daily-checkin`。HTTP 401 或明确的登录/令牌失效业务错误触发一次刷新；新令牌会在重试前保存。HTTP 403 不直接当作令牌过期。签到请求超时或业务失败时会复查状态，只有接口确认已签才报告「今日已签到」，不会根据错误文案直接报成功。

积分只展示接口返回的实际 `credit` / `today_credit` / `todayCredit`，不把预计 `daily_credit` 当成实得；接口未给出就不显示。当天重复运行时保留此前已获积分记录。接口 JSON 缺失、非 JSON、缺少有效 `data` 等情况显示失败通知。

单次 HTTP 超时为 12 秒；schedule 总超时为 180 秒。日志和通知不打印整段请求头、原始响应或令牌。凭据采集不会改写请求，刷新响应会返回原始响应体。若多个任务并发运行同一槽位，脚本存储没有跨进程事务锁；请只保留一个同槽位调度。

## 验证范围

已经使用 Node.js 的模拟 Egern `ctx` 进行本地回归，结果见 `VALIDATION.md`。验证覆盖接口顺序、续期落盘、再次运行保留新令牌、重复签到、失败复查、采集与响应透传等。测试文件保存在 `tests/`；在本目录可用 `node --test tests/workbuddy.test.mjs tests/workbuddy.token.test.mjs` 复现，不需要第三方依赖。

**未在真实 iPhone / Egern 上导入运行，未使用真实账号调用签到服务，也未验证 iOS 后台定时触发。** 初次安装请手动运行一次，以手机日志和账号实际签到记录确认。

## 来源

- API 逻辑：[Cat-zaizai/ZaiZaiCat-Checkin · WorkBuddy](https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/tree/main/script/workbuddy)
- 脚本结构参考：[MaYIHEI/paperclip · WPS](https://github.com/MaYIHEI/paperclip/tree/main/app/wps)
- [Egern 原生 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)
- [Egern 脚本配置](https://egernapp.com/zh-CN/docs/configuration/scriptings/)
- [Egern 模块及 Env](https://egernapp.com/zh-CN/docs/configuration/modules/)
- [Egern 本地脚本编辑示例](https://egernapp.com/zh-CN/docs/configuration/widgets/)

按 2026-11-08 可见的仓库文件与官方文档制作。原脚本作者及 MIT 许可证见 `THIRD-PARTY-NOTICES.txt`。
