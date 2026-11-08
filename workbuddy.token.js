/**
 * WorkBuddy / CodeBuddy CN · iPhone Egern 本地 Token 采集
 * v1.0.0 · 2026-11-08
 * 结构参考 MaYIHEI/paperclip/app/wps/wps.cookie.js (MIT).
 * 使用 Egern 原生 ctx API；与同包 workbuddy.js 共用账号存储。
 * 用于 http_request / http_response，不会主动发请求或登录。
 */

const API_URL = /^https:\/\/www\.codebuddy\.cn\/v2\//;
const TOKEN_URL = /^https:\/\/www\.codebuddy\.cn\/v2\/plugin\/auth\/token(\/refresh)?(?:\?|$)/;
const FIELDS = ["accessToken", "refreshToken", "uid", "enterpriseId", "domain", "userAgent", "accountName"];

export default async function (ctx) {
  let originalBody;
  let consumed = false;
  try {
    const env = ctx.env || {};
    const slot = text(env.WORKBUDDY_ACCOUNT_KEY) || "default";
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(slot)) throw new Error("invalid slot");
    const key = `workbuddy.egern.v1.${slot}.session`;
    const statusKey = `workbuddy.egern.v1.${slot}.status`;
    const req = ctx.request;
    if (!req) {
      notify(ctx, "请将本脚本设为请求/响应采集脚本，开启模块后访问 WorkBuddy；无需单独点击运行。");
      return;
    }
    if (req.method === "OPTIONS" || !API_URL.test(req.url)) return;
    if (ctx.response && !TOKEN_URL.test(req.url)) return;

    // 先保留响应体；即使配置或存储故障，消费过的原始内容也会透传。
    if (ctx.response) {
      originalBody = await ctx.response.text();
      consumed = true;
    }
    const old = ctx.storage.getJSON(key) || {};
    if (!object(old)) throw new Error("invalid saved session");
    const header = (name) => text(req.headers.get(name));
    const match = header("Authorization").match(/^Bearer\s+(\S+)$/i);
    const requestAccess = match ? match[1] : "";
    const requestRefresh = header("X-Refresh-Token");
    const incoming = {
      accessToken: requestAccess,
      refreshToken: requestRefresh,
      uid: header("X-User-Id"),
      enterpriseId: header("X-Enterprise-Id") || header("X-Tenant-Id"),
      domain: header("X-Domain"),
    };
    const ua = header("User-Agent");
    if (/Mozilla\//i.test(ua)) incoming.userAgent = ua;
    let linkedRefresh = false;
    let source = "request";

    if (ctx.response) {
      if (ctx.response.status < 200 || ctx.response.status >= 300) return;
      let body;
      try { body = JSON.parse(originalBody); } catch (_) { return; }
      // 已核实的 auth/token 和 auth/token/refresh 响应接受 code=0 或 200。
      if (!object(body) || ![0, 200].includes(body.code) || !object(body.data)) return;
      const data = body.data;
      const access = token(data.accessToken) || token(data.access_token);
      if (!access) return;
      const isRefresh = Boolean(req.url.match(TOKEN_URL)[1]);
      linkedRefresh = isRefresh && Boolean(
        (requestAccess && requestAccess === old.accessToken) ||
        (requestRefresh && requestRefresh === old.refreshToken)
      );
      incoming.accessToken = access;
      incoming.refreshToken = text(data.refreshToken) || text(data.refresh_token) || requestRefresh;
      incoming.domain = text(data.domain) || incoming.domain;
      source = isRefresh ? "refresh-response" : "token-response";
    }

    if (!incoming.accessToken) {
      console.log("[WorkBuddy Token] 当前请求未携带 Bearer，未保存令牌；Cookie 不能直接当作 access_token。");
      return;
    }
    const identityChanged = Boolean(
      (incoming.uid && old.uid && incoming.uid !== old.uid) ||
      (incoming.enterpriseId && old.enterpriseId && incoming.enterpriseId !== old.enterpriseId)
    );
    const sameIdentity = Boolean(incoming.uid && old.uid && incoming.uid === old.uid &&
      incoming.enterpriseId === (old.enterpriseId || ""));
    const sameAccess = incoming.accessToken === old.accessToken;
    const sameRefresh = Boolean(incoming.refreshToken && incoming.refreshToken === old.refreshToken);
    const keep = !identityChanged && (sameAccess || sameIdentity || sameRefresh || linkedRefresh);
    // 不能确认同一账号时，只保留配置导入标记，不混用旧账号令牌和账号头。
    const session = keep ? { ...old } : { inputTag: old.inputTag };
    for (const field of FIELDS) {
      if (incoming[field]) session[field] = incoming[field];
    }
    session.accountName = text(env.WORKBUDDY_ACCOUNT_NAME) || (keep && old.accountName) || "WorkBuddy";
    if (FIELDS.every(field => (session[field] || "") === (old[field] || ""))) {
      console.log("[WorkBuddy Token] 凭据未变化，跳过保存和通知。");
      return;
    }
    session.capturedAt = Date.now();
    session.captureSource = source;
    ctx.storage.setJSON(key, session);
    // 只有认证内容变化才清除旧的签到记录，避免请求头变化抹掉当天奖励。
    if (!sameAccess || session.refreshToken !== old.refreshToken || identityChanged) {
      ctx.storage.delete(statusKey);
    }
    console.log(`[WorkBuddy Token] 已在本机保存，槽位=${slot}，刷新令牌=${session.refreshToken ? "有" : "无"}。`);
    notify(ctx, session.refreshToken
      ? "访问令牌和刷新令牌已保存。请手动运行 WorkBuddy 每日签到验证。"
      : "访问令牌已保存，尚未抓到 refresh_token。可先手动签到验证，过期后需重新采集。");
  } catch (_) {
    // 不输出异常对象、请求头或原始响应，避免令牌进入日志。
    console.log("[WorkBuddy Token] 采集未完成，请检查账号槽位设置和脚本存储。");
    notify(ctx, "令牌保存失败，请检查账号槽位和脚本存储；原请求/响应继续透传。");
  } finally {
    if (consumed) return { body: originalBody };
  }
}

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function token(value) {
  const result = text(value).replace(/^Bearer\s+/i, "").trim();
  return result && !/\s/.test(result) ? result : "";
}
function object(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function notify(ctx, body) {
  try { ctx.notify({ title: "WorkBuddy · Token 采集", body, sound: false }); }
  catch (_) { console.log("[WorkBuddy Token] 无法发送通知，请检查通知权限。"); }
}
