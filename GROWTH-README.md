# 成长计划扩展 · v1.1.0（实验性）

新增 `workbuddy.growth.js`，用于真实达标后的任务领奖、Buddy 旅行及活跃档位兑换。**不代做对话、不伪造进度、不邀请小号、不自动同意活动条款，也不调用抽奖、盲盒或补登接口。**

本扩展基于 2026-11-09 官网公开前端的静态协议和离线模拟测试，**尚未用真实账号或真实 Egern 网络栈验证**。内部接口不是官方开放 API 承诺；实际资格、规则及到账以账号页面为准。安装后默认 `preview`，不要跳过首次核验。

## 安装：二选一，不要重复调度

### 已经安装原签到模块

保留原签到模块，额外添加这个**只含成长功能**的模块：

```text
https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.growth.module.yaml
```

### 新安装，或想合并为一个模块

添加增强组合模块，并停用原完整签到模块、独立成长模块和其他重复采集/调度条目：

```text
https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.plus.module.yaml
```

组合版保留原签到脚本、原凭据采集与每天 09:05 签到；成长任务独立运行。旧 `workbuddy.module.yaml` 和 `workbuddy.token.module.yaml` 没有改动，不会给旧用户静默开启新操作。

## 首次运行

1. 在 Egern 中添加模块并启用 MITM；证书须由你安装并信任。成长模块只增加 `www.workbuddy.cn`，组合版另外保留原来的 `www.codebuddy.cn`，不覆盖现有证书。
2. 将成长 Cookie/Bearer Env 留空，在同一手机登录并打开 [WorkBuddy 成长计划](https://www.workbuddy.cn/profile/growth-center)，让相关 HTTPS 请求实际通过 Egern。先自行阅读活动规则、完成同意及新手 Buddy 流程；脚本不会替你勾选同意或领取 `first_buddy`。
3. 收到“成长计划登录态已单独保存”后，保持 `WORKBUDDY_GROWTH_MODE=preview`，手动运行一次“WorkBuddy 成长计划”。检查账号、可执行任务及日志。preview 不提交 POST，也不调用带进度刷新作用的公众号校验 GET。
4. 确认预览、登录态及资格正确后，将模式改为 `run`。可先只开一个功能试运行，并到官网核对任务状态/奖励记录，再开启其他功能。改为 `off` 可同时停用成长调度逻辑和成长凭据采集，不影响原签到。
5. 成长 cron 默认 `17 8-23 * * *`：设备本地时间 08:17–23:17，每小时检查一次，不会阻塞等待旅行数小时。定时是否执行取决于 Egern 服务和 iOS 状态，以实际运行记录为准。

若已持有 Buddy 但脚本提示未同意活动规则，请回官网确认，**不要通过修改响应或本地状态绕过检查**。

## 两套登录态必须分开

| 功能 | 请求站点 | 凭据及存储 |
|---|---|---|
| 原每日签到 | `www.codebuddy.cn` | 原 plugin Bearer/refresh；`workbuddy.egern.v1.<槽位>.*` |
| 新成长计划 | `www.workbuddy.cn` | 网页 Cookie/对应 XSRF，或实际成长小程序 Bearer；`workbuddy.growth.v1.<槽位>.*` |

- 不会把签到的 token/refresh 发往成长站点，也不声称两者可以互换。网页认证与原签到续期链不同；成长遇到 401/403 会停止后续功能，请重新打开官网登录采集。本版不实现网页会话自动续期。
- 请求采集仅处理官方成长路径，保存原 Cookie、存在时的 `X-XSRF-TOKEN`、平台及企业头，不读请求体，不修改/拦截原请求，不扫描浏览器其他站点。
- 主动请求固定 HTTPS 官方源，禁止跟随重定向，不自动附带 Egern Cookie jar；只发送该槽位明确保存的凭据。未配置 XSRF 头而 Cookie 含唯一 `XSRF-TOKEN` 时，按官网 Axios 规则解码生成对应头。
- 默认网页登录。小程序模式仅接受原成长请求实际使用的 Bearer，且**不自动旅行**，因为当前官网小程序未展示旅行入口。
- 保存到 Egern `ctx.storage`，不额外宣称加密或跨设备同步。日志/通知不输出 Cookie、Bearer、XSRF 或服务端原始错误文本。
- 没有采集通知通常是请求未经过 Egern、MITM 未解密或页面未发起成长接口。不要因此把原签到 Bearer 粘到成长配置中。

## Env

| 名称 | 默认 / 用途 |
|---|---|
| `WORKBUDDY_ACCOUNT_KEY` | `default`；换账号使用新槽位，避免混淆待确认记录 |
| `WORKBUDDY_GROWTH_MODE` | `preview` / `run` / `off`；首次默认 preview |
| `WORKBUDDY_GROWTH_COOKIE` | 留空自动采集；手填时仅使用自己的完整成长站点 Cookie |
| `WORKBUDDY_GROWTH_BEARER` | 留空；只有实际成长小程序令牌才适用，和 Cookie 二选一 |
| `WORKBUDDY_GROWTH_XSRF_TOKEN` | 留空自动采集/按 Cookie 派生；手填按原请求对应值 |
| `WORKBUDDY_GROWTH_ENTERPRISE_ID` | 留空；仅按实际成长请求填写，不继承原签到企业字段 |
| `WORKBUDDY_GROWTH_TASKS` | `true`，领取已完成普通任务 |
| `WORKBUDDY_GROWTH_TRAVEL` | `true`，旅行领奖及派出 |
| `WORKBUDDY_GROWTH_REDEEM` | `true`，已达标活跃档位兑换 |
| `WORKBUDDY_GROWTH_ACCEPT_CODES` | 空：不自动接取。可显式填最多 8 个服务端任务 code，英文逗号分隔；不会替你完成任务 |
| `WORKBUDDY_GROWTH_TRAVEL_LOCATION` | 空：用服务端配置第一个有效地点；手填必须匹配配置，原样保留 ID 类型 |
| `WORKBUDDY_GROWTH_MAX_WRITES` | `6`，每次最多提交 1–8 个 POST；其余留待下次 |
| `WORKBUDDY_GROWTH_NOTIFY_IDLE` | `false`，没有操作通常不通知；预览、失败、已复核操作仍通知 |

使用自动采集时清空两个成长凭据 Env。手工 Env 变更才重新导入；同一 Env 不会每次覆盖后来采集的新会话。凭据不得提交到 GitHub，也不要发到 issue 或公开日志。

## 操作条件与防重复

- **任务**：只认服务端 `accept_status=completed` 且 `has_reward` 未明确否定；锁定/未知状态不领取。保留官网 nullish 默认值，不用 progress 数字或展示日期推算达标。`first_buddy` 不参与普通领奖；无 Buddy 时仅保留官网允许显示的 `RichMeow_Chat`。显式接取仅针对服务端列出的 `not_accepted` 普通任务，排除 `auto`/`beginner`。
- **旅行**：服务端 `arrived` 才领取，不能把本地倒计时归零当成已返回。`idle` 且 `daily_limit_reached` **明确为 false**、已有 Buddy 且配置有地点才派出。领奖后重新查询状态再考虑派出；未知状态/缺批次标识时不写。
- **活跃兑换**：仅处理服务端明确标记 `available` 的 `7d/14d/28d`，不由连续天数猜测资格。采用动态档位配置；补登卡容量不明或本次会溢出就跳过，留给你在官网决定。逐档兑换后更新状态及容量。本版不会自动消耗补登卡，也不会静默放弃溢出的卡。
- **提交确认**：每次 POST 前持久化操作记录，随后重新读取官方状态。网络结果不明也仅查询一次，不盲重发。报告“已由服务端复核”指任务/旅行/兑换状态已确认，不是对积分到账金额的估算；本版不把任务列表的 `reward_credit` 或预计每日积分当实得展示。
- **幂等记录**：同一月档位/同一旅行批次不会因跨日换 token 再提交；未确认记录保留，不自动删除。若提示“已有提交记录”，先到官网核验。确认未执行但需手动重试时，优先在官网操作；不要为了强行重试随意删记录或换槽位。
- **上限**：单次 HTTP 超时 8 秒，最多 24 次请求，网络预算约 140 秒，模块 timeout 180 秒。未发送就触发预算停止的动作不会被误记成已提交。
- **并发**：使用租约及写前回读锁，仍不是跨进程原子事务锁。一个槽位只保留一个成长 schedule；不要多端并发运行相同账号。

`.session` 保存凭据；`.state` 保存无凭据的操作记录；`.report` 保存运行摘要；`.lock` 是短期运行租约。不要公开导出 `.session`。静态字段不匹配时停止对应操作，不能为了跑通把未知状态默认当可领。

## 协议来源与限制

使用的是官网内部接口，不是面向第三方的稳定开放 API。官网更新、活动下线、资格变化或风控都可能使其失效。遵守官方活动规则，不用此脚本虚增任务进度、刷量或多账号套利。

本版读取官网 `https://www.workbuddy.cn` 同源 `/v2/activity/growth/*` 与 `/activity/growth/*`；只提交 task accept/claim、travel depart/claim、redeem。业务包按 `body.data` 解包；`code` 缺失/0/200 是本实现的兼容策略，**不声称官网已验证 code=200**。不能仅凭 HTTP 成功、错误文案或 POST 返回空对象就认为领奖成功。

2026-11-09 静态核验主要参考：

- [官网请求实例与认证](https://assets.workbuddy.cn/web/usercenter/48f9403c1a9ebc6953ab715492f668a89e9d53e3/assets/config-BPHleWcY.js)
- [成长接口定义](https://assets.workbuddy.cn/web/usercenter/48f9403c1a9ebc6953ab715492f668a89e9d53e3/assets/growthSpace-CbMAHegV.js)
- [任务状态及兑换逻辑](https://assets.workbuddy.cn/web/usercenter/48f9403c1a9ebc6953ab715492f668a89e9d53e3/assets/growthSpace-D8_euJ0h.js)
- [成长页面、旅行及活动规则](https://assets.workbuddy.cn/web/usercenter/48f9403c1a9ebc6953ab715492f668a89e9d53e3/assets/GrowthCenterPage-NguKBgk2.js)
- [Egern 原生 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)

测试方法与真实验证边界见 [VALIDATION.md](VALIDATION.md)。
