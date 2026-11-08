/**
 * WorkBuddy / CodeBuddy CN 每日签到 · Egern 原生 ctx API
 * 2026-11-08 · v1.0.0
 * API 流程移植自 Cat-zaizai/ZaiZaiCat-Checkin/script/workbuddy (MIT).
 * 采集 + 定时任务结构参考 MaYIHEI/paperclip/app/wps (MIT).
 * 许可证与来源见 THIRD-PARTY-NOTICES.txt；配置方法见 README.md。
 * 同一文件用于 http_request、令牌刷新 http_response 和 schedule。
 */

const VERSION = "1.0.0";
const BASE = "https://www.codebuddy.cn";
const STATUS_PATHS = [
  "/v2/billing/meter/checkin-activity-status",
  "/v2/billing/meter/checkin-status",
];
const CHECKIN_PATH = "/v2/billing/meter/daily-checkin";
const REFRESH_PATH = "/v2/plugin/auth/token/refresh";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CAPTURE = /^https:\/\/www\.codebuddy\.cn\/(?:v2\/billing\/meter\/(?:checkin-activity-status|checkin-status|daily-checkin)|v2\/plugin\/auth\/token\/refresh)(?:\?|$)/;

export default async function (ctx) {
  const env = ctx.env || {};
  let session = {};
  let statusKey;
  try {
    const slot = clean(env.WORKBUDDY_ACCOUNT_KEY) || "default";
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(slot)) {
      throw new Error("账号槽位仅支持 1–48 位字母、数字、下划线和短横线");
    }
    const sessionKey = `workbuddy.egern.v1.${slot}.session`;
    statusKey = `workbuddy.egern.v1.${slot}.status`;
    const save = () => ctx.storage.setJSON(sessionKey, session);
    session = ctx.storage.getJSON(sessionKey) || {};
    if (!isObject(session)) throw new Error("保存的账号格式异常，请换一个账号槽位重新导入");

    // env 作为导入入口；仅输入令牌变化时导入，避免旧 env 覆盖续期后的令牌。
    const access = token(env.WORKBUDDY_ACCESS_TOKEN);
    const refresh = clean(env.WORKBUDDY_REFRESH_TOKEN);
    const inputTag = fingerprint(JSON.stringify([access, refresh]));
    if (access && session.inputTag !== inputTag) {
      session = {
        accessToken: access, refreshToken: refresh,
        uid: clean(env.WORKBUDDY_UID),
        enterpriseId: clean(env.WORKBUDDY_ENTERPRISE_ID),
        domain: clean(env.WORKBUDDY_DOMAIN),
        inputTag,
      };
      save();
      ctx.storage.delete(statusKey);
    }
    session.accountName = clean(env.WORKBUDDY_ACCOUNT_NAME) || "WorkBuddy";

    if (ctx.request) {
      return await capture(ctx, session, save, statusKey);
    }

    if (!session.accessToken) {
      throw new Error("未配置 access_token：请在模块 Env 填写 WORKBUDDY_ACCESS_TOKEN，或先采集带 Bearer 的请求");
    }
    const api = createAPI(ctx, session, save);
    const before = await api.status();
    let result;
    if (!bool(pick(before, "active", "Active"), true)) {
      result = { state: "inactive", message: "签到活动未开启或当前账号不适用" };
    } else if (checked(before)) {
      result = statusResult(before);
    } else {
      try {
        const data = await api.post(CHECKIN_PATH);
        if (!bool(data.success, true)) {
          throw new APIError("business", clean(data.message) || "签到接口返回 success=false");
        }
        result = {
          state: "ok", message: "签到成功",
          credit: integer(pick(data, "credit", "today_credit", "todayCredit")),
          streakDays: integer(pick(data, "streak_days", "streakDays")),
          streakBonus: bool(pick(data, "is_streak_day", "isStreakDay"), false),
        };
      } catch (error) {
        // 签到写请求不盲目重发；超时或并发已签时，用只读状态确认结果。
        if (error.type === "auth") throw error;
        let after;
        try { after = await api.status(); } catch (_) { /* 保留首次签到错误 */ }
        if (after && checked(after)) result = statusResult(after);
        else throw error;
      }
    }
    const old = ctx.storage.getJSON(statusKey);
    if (result.state === "already" && old && old.state === "ok" &&
        chinaDay(old.updatedAt) === chinaDay(Date.now()) && old.credit != null) {
      result.credit = old.credit;
    }
    const report = { ...result, updatedAt: Date.now(), version: VERSION };
    ctx.storage.setJSON(statusKey, report);
    const details = [result.message];
    if (result.credit != null) details.push(`今日积分：${result.credit}`);
    if (result.streakDays != null) details.push(`连续签到：${result.streakDays} 天`);
    if (result.streakBonus) details.push("本次触发连签奖励");
    console.log(`[WorkBuddy ${VERSION}] ${details.join("；")}`);
    if (bool(env.WORKBUDDY_NOTIFY_SUCCESS, true)) {
      notify(ctx, session.accountName, details.join("\n"));
    }
  } catch (error) {
    const message = redact(error.message || "脚本运行失败", [
      session.accessToken, session.refreshToken,
      clean(env.WORKBUDDY_ACCESS_TOKEN), clean(env.WORKBUDDY_REFRESH_TOKEN),
    ]);
    // 捕获脚本错误不影响原请求；主任务才写入失败结果。
    if (!ctx.request && statusKey) {
      try {
        ctx.storage.setJSON(statusKey, { state: "fail", message, updatedAt: Date.now(), version: VERSION });
      } catch (_) { /* 存储故障仍然通知 */ }
    }
    console.log(`[WorkBuddy ${VERSION}] ${message}`);
    notify(ctx, session.accountName || "WorkBuddy", message);
  }
}

async function capture(ctx, session, save, statusKey) {
  const req = ctx.request;
  if (req.method === "OPTIONS" || !CAPTURE.test(req.url)) return;
  const get = (name) => clean(req.headers.get(name));
  const incoming = {
    accessToken: /^Bearer\s+\S+/i.test(get("Authorization")) ? token(get("Authorization")) : "",
    refreshToken: get("X-Refresh-Token"),
    uid: get("X-User-Id"),
    enterpriseId: get("X-Enterprise-Id") || get("X-Tenant-Id"),
    domain: get("X-Domain"),
  };
  let originalBody;
  if (ctx.response) {
    if (!/^https:\/\/www\.codebuddy\.cn\/v2\/plugin\/auth\/token\/refresh(?:\?|$)/.test(req.url)) return;
    // 消费过的流必须还给 Egern，所有解析/存储异常也要透传。
    originalBody = await ctx.response.text();
  }
  try {
    if (ctx.response) {
      if (ctx.response.status < 200 || ctx.response.status >= 300) return;
      let body;
      try { body = JSON.parse(originalBody); } catch (_) { return; }
      if (!isObject(body) || body.code !== 0 || !isObject(body.data)) return;
      const data = body.data;
      const newAccess = token(data.accessToken) || token(data.access_token);
      if (!newAccess) return;
      // 对比的是刷新前请求，响应内的 accessToken 已经轮换。
      incoming.sameSession = incoming.accessToken === session.accessToken ||
        Boolean(incoming.refreshToken && incoming.refreshToken === session.refreshToken);
      incoming.accessToken = newAccess;
      incoming.refreshToken = clean(data.refreshToken) || clean(data.refresh_token) || incoming.refreshToken;
      incoming.domain = clean(data.domain) || incoming.domain;
    }
    if (!incoming.accessToken) return;
    const hadAccess = Boolean(session.accessToken);
    const previousAccess = session.accessToken;
    const previousRefresh = session.refreshToken;
    const sameIdentity = incoming.uid && session.uid && incoming.uid === session.uid &&
      incoming.enterpriseId === (session.enterpriseId || "");
    const otherIdentity = (incoming.uid && session.uid && incoming.uid !== session.uid) ||
      (incoming.enterpriseId && session.enterpriseId && incoming.enterpriseId !== session.enterpriseId);
    if (otherIdentity || (incoming.accessToken !== session.accessToken &&
        !sameIdentity && !incoming.sameSession &&
        !(incoming.refreshToken && incoming.refreshToken === session.refreshToken))) {
      // 无法确认同一账号时不把旧账号的 refresh_token 混给新账号。
      for (const field of ["accessToken", "refreshToken", "uid", "enterpriseId", "domain", "userAgent"]) delete session[field];
    }
    for (const field of ["accessToken", "refreshToken", "uid", "enterpriseId", "domain"]) {
      if (incoming[field]) session[field] = incoming[field];
    }
    const ua = get("User-Agent");
    if (/Mozilla\//i.test(ua)) session.userAgent = ua;
    save();
    if (!hadAccess || previousAccess !== session.accessToken || previousRefresh !== session.refreshToken || otherIdentity) {
      ctx.storage.delete(statusKey);
      notify(ctx, session.accountName || "WorkBuddy", session.refreshToken
        ? "访问令牌和刷新令牌已保存，待签到验证。"
        : "访问令牌已保存，待签到验证。尚未获得 refresh_token，过期后需重新采集或手动填写。");
    }
  } catch (error) {
    if (!ctx.response) throw error;
    notify(ctx, session.accountName || "WorkBuddy", "刷新响应已透传，但本地保存失败，请重新导入令牌。");
  } finally {
    // finally 的返回确保响应被消费后，即使存储出错也仍透传原始内容。
    if (ctx.response) return { body: originalBody };
  }
}

function createAPI(ctx, session, save) {
  let refreshed = false;
  async function request(path, extra = {}) {
    const headers = {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: "application/json", "Content-Type": "application/json",
      "User-Agent": session.userAgent || UA,
      ...extra,
    };
    if (session.uid) headers["X-User-Id"] = session.uid;
    if (session.enterpriseId) {
      headers["X-Enterprise-Id"] = session.enterpriseId;
      headers["X-Tenant-Id"] = session.enterpriseId;
    }
    if (session.domain) headers["X-Domain"] = session.domain;
    let response;
    try {
      response = await ctx.http.post(BASE + path, {
        headers, body: "{}", timeout: 12000,
        redirect: "error", credentials: "omit",
      });
    } catch (_) {
      throw new APIError("network", `${path} 网络异常或超时，结果未确认`);
    }
    if (response.status === 401) throw new APIError("auth", "令牌已失效（HTTP 401）");
    let body;
    try { body = await response.json(); }
    catch (_) { throw new APIError("parse", `${path} 返回非 JSON（HTTP ${response.status}）`); }
    if (!isObject(body)) throw new APIError("parse", `${path} 返回格式异常`);
    const message = clean(body.message) || clean(body.msg) || "接口未提供错误说明";
    if (response.status < 200 || response.status >= 300) {
      throw new APIError("http", `HTTP ${response.status}：${message}`);
    }
    if (body.code !== 0) {
      const expired = body.code === 401 || /未登录|请.*登录|登录.*(?:过期|失效)|(?:token|令牌).*(?:expired|invalid|过期|失效|无效)/i.test(message);
      throw new APIError(expired ? "auth" : "business", `${message}（code=${String(body.code)}）`);
    }
    if (!isObject(body.data)) throw new APIError("parse", `${path} 缺少有效 data 对象`);
    return body.data;
  }
  async function post(path) {
    try { return await request(path); }
    catch (error) {
      if (error.type !== "auth") throw error;
      if (!session.refreshToken) throw new APIError("auth", "访问令牌已过期，未配置 refresh_token，请重新导入账号");
      if (refreshed) throw new APIError("auth", "刷新后令牌仍被拒绝，请重新导入账号");
      refreshed = true; // 一次运行最多续期一次。
      let data;
      try { data = await request(REFRESH_PATH, { "X-Refresh-Token": session.refreshToken }); }
      catch (_) { throw new APIError("auth", "令牌过期且自动续期失败，请重新导入账号"); }
      const newAccess = token(data.accessToken) || token(data.access_token);
      if (!newAccess) throw new APIError("auth", "续期响应缺少 accessToken，请重新导入账号");
      session.accessToken = newAccess;
      session.refreshToken = clean(data.refreshToken) || clean(data.refresh_token) || session.refreshToken;
      session.domain = clean(data.domain) || session.domain;
      save(); // 在重试/查询/提前返回之前落盘，保留轮换后的 refresh_token。
      return await request(path);
    }
  }
  async function status() {
    const errors = [];
    for (const path of STATUS_PATHS) {
      try { return await post(path); }
      catch (error) {
        if (error.type === "auth") throw error;
        errors.push(error.message);
      }
    }
    throw new APIError("status", `无法确认签到状态：${errors.join("；")}`);
  }
  return { post, status };
}

class APIError extends Error {
  constructor(type, message) { super(message); this.type = type; }
}
function clean(value) { return typeof value === "string" ? value.trim() : ""; }
function token(value) { return clean(value).replace(/^Bearer\s+/i, "").trim(); }
function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function pick(object, ...keys) {
  for (const key of keys) if (object[key] != null) return object[key];
  return undefined;
}
function bool(value, fallback) {
  if (value === true || value === 1 || /^(true|1)$/i.test(clean(value))) return true;
  if (value === false || value === 0 || /^(false|0)$/i.test(clean(value))) return false;
  return fallback;
}
function integer(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (/^-?\d+$/.test(clean(value))) return Number(value);
  return null;
}
function checked(data) { return bool(pick(data, "today_checked_in", "todayCheckedIn"), false); }
function statusResult(data) {
  return {
    state: "already", message: "今日已签到",
    credit: integer(pick(data, "today_credit", "todayCredit")),
    streakDays: integer(pick(data, "streak_days", "streakDays")),
  };
}
function chinaDay(value) {
  const date = new Date(Number(value) + 8 * 3600 * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}
function fingerprint(value) {
  // 仅用来识别 Env 是否变更，不作加密用途，也不保存旧的输入令牌副本。
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `${value.length}:${a >>> 0}:${b >>> 0}`;
}
function redact(value, secrets) {
  let text = String(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join("[已隐藏]");
  return text.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [已隐藏]").slice(0, 600);
}
function notify(ctx, title, body) {
  try { ctx.notify({ title, body, sound: false }); }
  catch (_) { console.log("[WorkBuddy] 通知发送失败，请检查通知权限"); }
}
