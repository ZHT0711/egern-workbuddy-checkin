import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../workbuddy.js', import.meta.url), 'utf8');
const { default: main } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const SESSION = 'workbuddy.egern.v1.default.session';
const STATUS = 'workbuddy.egern.v1.default.status';
const S1 = '/v2/billing/meter/checkin-activity-status';
const S2 = '/v2/billing/meter/checkin-status';
const SIGN = '/v2/billing/meter/daily-checkin';
const REFRESH = '/v2/plugin/auth/token/refresh';
const A = 'fixture-access-v1-only';
const R = 'fixture-refresh-v1-only';
const A2 = 'fixture-access-v2-only';
const R2 = 'fixture-refresh-v2-only';
const env = { WORKBUDDY_ACCESS_TOKEN: A, WORKBUDDY_REFRESH_TOKEN: R };
const ok = (path, data) => ({ path, status: 200, body: { code: 0, data } });
const error = (path, status, message, code = 99) => ({ path, status, body: { code, message } });
const req = (path = S1, headers = {}, method = 'POST') => ({
  url: 'https://www.codebuddy.cn' + path, method, headers: new Headers(headers),
});
const saved = (map, key = SESSION) => JSON.parse(map.get(key) || 'null');
function fixture(options = {}) {
  const store = options.store || new Map();
  if (options.session) store.set(SESSION, JSON.stringify(options.session));
  const queue = [...(options.queue || [])], calls = [], messages = [], logs = [], mismatches = [];
  const ctx = {
    env: options.env || {}, request: options.request, response: options.response,
    storage: {
      getJSON: key => saved(store, key),
      setJSON: (key, value) => {
        if (options.failWrites) throw new Error('fixture storage failure');
        store.set(key, JSON.stringify(value));
      },
      delete: key => store.delete(key),
    },
    notify: message => messages.push(message),
    http: { post: async (url, config) => {
      const path = new URL(url).pathname;
      calls.push({ url, path, ...config });
      const next = queue.shift();
      if (!next) { mismatches.push('Unexpected request: ' + path); throw new Error('Unexpected HTTP'); }
      if (next.path !== path) mismatches.push(`Expected ${next.path}, got ${path}`);
      if (next.throws) throw new Error('fixture timeout');
      return {
        status: next.status,
        json: async () => {
          if (next.badJSON) throw new Error('fixture invalid JSON');
          return next.body;
        },
      };
    } },
  };
  return { store, calls, messages, logs, ctx, async run() {
    const log = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let result;
    try { result = await main(ctx); } finally { console.log = log; }
    assert.deepEqual(mismatches, []);
    assert.equal(queue.length, 0, 'All expected requests consumed');
    return result;
  } };
}

test('first checkin: exact API order, headers, credit and streak', async () => {
  const f = fixture({ env: { ...env, WORKBUDDY_UID: 'user1', WORKBUDDY_ENTERPRISE_ID: 'ent1', WORKBUDDY_DOMAIN: 'cn' }, queue: [
    ok(S1, { active: true, today_checked_in: false }), ok(SIGN, { success: true, credit: '10', streak_days: 3, is_streak_day: 1 }),
  ] });
  await f.run();
  assert.equal(saved(f.store, STATUS).credit, 10);
  assert.equal(saved(f.store, STATUS).streakDays, 3);
  assert.equal(saved(f.store, STATUS).streakBonus, true);
  for (const call of f.calls) {
    assert.equal(call.url, 'https://www.codebuddy.cn' + call.path);
    assert.equal(call.headers.Authorization, 'Bearer ' + A);
    assert.equal(call.headers['X-User-Id'], 'user1');
    assert.equal(call.headers['X-Enterprise-Id'], 'ent1');
    assert.equal(call.headers['X-Tenant-Id'], 'ent1');
    assert.equal(call.headers['X-Domain'], 'cn');
    assert.match(call.headers['User-Agent'], /Mozilla/);
    assert.equal(call.body, '{}');
    assert.equal(call.timeout, 12000);
    assert.equal(call.redirect, 'error');
    assert.equal(call.credentials, 'omit');
  }
});

test('camelCase and string true skip an already checked-in account', async () => {
  const f = fixture({ env, queue: [ok(S1, { todayCheckedIn: 'true', todayCredit: 0, streakDays: '5' })] });
  await f.run();
  assert.equal(saved(f.store, STATUS).state, 'already');
  assert.equal(saved(f.store, STATUS).credit, 0);
  assert.equal(saved(f.store, STATUS).streakDays, 5);
});

test('explicit inactive string false does not submit', async () => {
  const f = fixture({ env, queue: [ok(S1, { active: 'false' })] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'inactive');
});

test('status endpoint falls back to checkin-status', async () => {
  const f = fixture({ env, queue: [error(S1, 404, 'unavailable'), ok(S2, {}), ok(SIGN, { credit: 2 })] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'ok');
});

test('401 rotates both tokens and persists before next run with unchanged Env', async () => {
  const f = fixture({ env, queue: [error(S1, 401, ''), ok(REFRESH, { accessToken: A2, refreshToken: R2, domain: 'rotated' }), ok(S1, { today_checked_in: true })] });
  await f.run();
  assert.equal(f.calls[1].headers['X-Refresh-Token'], R);
  assert.equal(f.calls[2].headers.Authorization, 'Bearer ' + A2);
  assert.equal(f.calls[2].headers['X-Domain'], 'rotated');
  assert.equal(saved(f.store).refreshToken, R2);
  const next = fixture({ env, store: f.store, queue: [ok(S1, { today_checked_in: true })] });
  await next.run(); assert.equal(next.calls[0].headers.Authorization, 'Bearer ' + A2);
});

test('daily-checkin authentication error refreshes then retries exactly once', async () => {
  const f = fixture({ env, queue: [ok(S1, {}), error(SIGN, 200, 'token expired', 401), ok(REFRESH, { access_token: A2, refresh_token: R2 }), ok(SIGN, { todayCredit: 12 })] });
  await f.run();
  assert.equal(saved(f.store, STATUS).state, 'ok');
  assert.equal(f.calls[3].headers.Authorization, 'Bearer ' + A2);
});

test('failed refresh stops without fallback or repeated refresh', async () => {
  const f = fixture({ env, queue: [error(S1, 401, ''), error(REFRESH, 401, '')] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'fail');
  assert.match(f.messages[0].body, /续期失败/);
});

test('missing refresh token reports re-import after 401', async () => {
  const f = fixture({ env: { WORKBUDDY_ACCESS_TOKEN: A }, queue: [error(S1, 401, '')] });
  await f.run(); assert.match(f.messages[0].body, /未配置 refresh_token/);
});

test('403 gateway rejection does not refresh or submit checkin', async () => {
  const f = fixture({ env, queue: [error(S1, 403, 'gateway', 10085), error(S2, 403, 'gateway', 10085)] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'fail');
});

test('business already-signed message requires confirming status', async () => {
  const f = fixture({ env, queue: [ok(S1, {}), error(SIGN, 200, '今日已签到'), ok(S1, { today_checked_in: true })] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'already');
});

test('already-signed text alone is not enough for success', async () => {
  const f = fixture({ env, queue: [ok(S1, {}), error(SIGN, 200, '今日已签到'), ok(S1, { today_checked_in: false })] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'fail');
});

test('ambiguous sign timeout is checked by status, without resending mutation', async () => {
  const f = fixture({ env, queue: [ok(S1, {}), { path: SIGN, throws: true }, ok(S1, { todayCheckedIn: true })] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'already');
});

test('non-JSON status fails safely without submitting', async () => {
  const f = fixture({ env, queue: [{ path: S1, status: 200, badJSON: true }, { path: S2, status: 200, badJSON: true }] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'fail');
});

for (const data of [null, [], 'invalid']) {
  test('invalid data is rejected: ' + JSON.stringify(data), async () => {
    const f = fixture({ env, queue: [ok(S1, data), ok(S2, data)] });
    await f.run(); assert.equal(saved(f.store, STATUS).state, 'fail');
  });
}

test('success string false is not truthy success', async () => {
  const f = fixture({ env, queue: [ok(S1, {}), ok(SIGN, { success: 'false' }), ok(S1, {})] });
  await f.run(); assert.equal(saved(f.store, STATUS).state, 'fail');
});

test('success notifications can be disabled, failures still notify', async () => {
  const e = { ...env, WORKBUDDY_NOTIFY_SUCCESS: 'false' };
  const f = fixture({ env: e, queue: [ok(S1, { todayCheckedIn: true })] });
  await f.run(); assert.equal(f.messages.length, 0);
  const g = fixture({ env: e, queue: [error(S1, 401, ''), error(REFRESH, 401, '')] });
  await g.run(); assert.equal(g.messages.length, 1);
});

test('estimated daily_credit is never presented as actual earned credit', async () => {
  const f = fixture({ env, queue: [ok(S1, { daily_credit: 100 }), ok(SIGN, {})] });
  await f.run(); assert.equal(saved(f.store, STATUS).credit, null);
  assert.doesNotMatch(f.messages[0].body, /积分/);
});

test('capture saves Bearer, identity headers and refresh token without modifying request', async () => {
  const request = req(S1, { authorization: 'Bearer ' + A, 'x-refresh-token': R, 'x-user-id': 'u1', 'x-tenant-id': 'e1' });
  const f = fixture({ request });
  assert.equal(await f.run(), undefined);
  assert.equal(saved(f.store).accessToken, A);
  assert.equal(saved(f.store).refreshToken, R);
  assert.equal(saved(f.store).enterpriseId, 'e1');
  assert.equal(request.headers.get('authorization'), 'Bearer ' + A);
  assert.match(f.messages[0].body, /待签到验证/);
});

test('refresh response rotates tokens and returns exact original body', async () => {
  const raw = ' {"code":0,"data":{"accessToken":"' + A2 + '","refreshToken":"' + R2 + '"}}\n';
  const f = fixture({ session: { accessToken: A, refreshToken: R, uid: 'u1' }, request: req(REFRESH, { Authorization: 'Bearer ' + A, 'X-Refresh-Token': R }), response: { status: 200, text: async () => raw } });
  assert.deepEqual(await f.run(), { body: raw });
  assert.equal(saved(f.store).accessToken, A2);
  assert.equal(saved(f.store).refreshToken, R2);
  assert.equal(saved(f.store).uid, 'u1');
});

test('malformed refresh response is passed through without saving credentials', async () => {
  const f = fixture({ request: req(REFRESH), response: { status: 200, text: async () => '<html>bad</html>' } });
  assert.deepEqual(await f.run(), { body: '<html>bad</html>' });
  assert.equal(saved(f.store), null);
});

test('refresh business failure is passed through unchanged', async () => {
  const raw = '{"code":401,"data":{"accessToken":"bad"}}';
  const f = fixture({ request: req(REFRESH), response: { status: 200, text: async () => raw } });
  assert.deepEqual(await f.run(), { body: raw }); assert.equal(saved(f.store), null);
});

test('refresh response storage failure still returns original body', async () => {
  const raw = JSON.stringify({ code: 0, data: { accessToken: A2 } });
  const f = fixture({ failWrites: true, request: req(REFRESH), response: { status: 200, text: async () => raw } });
  assert.deepEqual(await f.run(), { body: raw });
  assert.match(f.messages[0].body, /保存失败/);
});

test('OPTIONS request does not capture', async () => {
  const f = fixture({ request: req(S1, { Authorization: 'Bearer ' + A }, 'OPTIONS') });
  await f.run(); assert.equal(saved(f.store), null);
});

test('non-Bearer authentication does not capture', async () => {
  const f = fixture({ request: req(S1, { Authorization: 'Basic fixture' }) });
  await f.run(); assert.equal(saved(f.store), null);
});

for (const url of ['https://www.codebuddy.cn.evil.example' + S1, 'https://www.codebuddy.cn' + S1 + '-evil', 'https://other.example' + S1]) {
  test('capture rejects unrelated URL ' + url, async () => {
    const request = req(S1, { Authorization: 'Bearer ' + A }); request.url = url;
    const f = fixture({ request }); await f.run(); assert.equal(saved(f.store), null);
  });
}

test('new identity clears refresh token of previous account', async () => {
  const f = fixture({ session: { accessToken: A, refreshToken: R, uid: 'old', enterpriseId: 'old-ent', domain: 'old-domain' }, request: req(S1, { Authorization: 'Bearer ' + A2, 'X-User-Id': 'new' }) });
  await f.run();
  assert.equal(saved(f.store).uid, 'new');
  assert.equal(saved(f.store).refreshToken, undefined);
  assert.equal(saved(f.store).enterpriseId, undefined);
  assert.equal(saved(f.store).domain, undefined);
});

test('unknown identity with changed access token clears old refresh conservatively', async () => {
  const f = fixture({ session: { accessToken: A, refreshToken: R }, request: req(S1, { Authorization: 'Bearer ' + A2 }) });
  await f.run(); assert.equal(saved(f.store).refreshToken, undefined);
});

test('confirmed same user preserves refresh across captured access rotation', async () => {
  const f = fixture({ session: { accessToken: A, refreshToken: R, uid: 'same' }, request: req(S1, { Authorization: 'Bearer ' + A2, 'X-User-Id': 'same' }) });
  await f.run(); assert.equal(saved(f.store).refreshToken, R);
});

test('manually changed Env imports new account without old refresh or identity', async () => {
  const f = fixture({ env, queue: [ok(S1, { todayCheckedIn: true })] }); await f.run();
  const next = fixture({ env: { WORKBUDDY_ACCESS_TOKEN: A2 }, store: f.store, queue: [ok(S1, { todayCheckedIn: true })] }); await next.run();
  assert.equal(saved(f.store).accessToken, A2);
  assert.equal(saved(f.store).refreshToken, '');
});

test('same-day rerun preserves actual reward from successful checkin', async () => {
  const f = fixture({ env, queue: [ok(S1, {}), ok(SIGN, { credit: 8 })] }); await f.run();
  const next = fixture({ env, store: f.store, queue: [ok(S1, { todayCheckedIn: true })] }); await next.run();
  assert.equal(saved(f.store, STATUS).credit, 8);
});

test('rotated tokens remain saved when retried status also fails', async () => {
  const f = fixture({ env, queue: [error(S1, 401, ''), ok(REFRESH, { accessToken: A2, refreshToken: R2 }), error(S1, 401, '')] });
  await f.run(); assert.equal(saved(f.store).refreshToken, R2);
  assert.equal(saved(f.store, STATUS).state, 'fail');
});

test('no credentials does not send any HTTP request', async () => {
  const f = fixture(); await f.run(); assert.match(f.messages[0].body, /未配置 access_token/);
});

test('echoed credentials in server error are removed from logs and notices', async () => {
  const f = fixture({ env, queue: [error(S1, 500, A + ' ' + R), error(S2, 500, 'Bearer foreign-fixture-secret')] });
  await f.run();
  const text = JSON.stringify([f.messages, f.logs, saved(f.store, STATUS)]);
  for (const secret of [A, R, 'foreign-fixture-secret']) assert.ok(!text.includes(secret));
});

test('different storage slots keep accounts separate', async () => {
  const store = new Map();
  const f = fixture({ env, store, queue: [ok(S1, { todayCheckedIn: true })] }); await f.run();
  const g = fixture({ env: { WORKBUDDY_ACCESS_TOKEN: A2, WORKBUDDY_ACCOUNT_KEY: 'second' }, store, queue: [ok(S1, { todayCheckedIn: true })] }); await g.run();
  assert.equal(saved(store).accessToken, A);
  assert.equal(saved(store, 'workbuddy.egern.v1.second.session').accessToken, A2);
});
