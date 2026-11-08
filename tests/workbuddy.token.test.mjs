import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const load = async file => {
  const source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
};
const capture = await load('../workbuddy.token.js');
const checkin = await load('../workbuddy.js');
const PREFIX = 'workbuddy.egern.v1.default';
const KEY = PREFIX + '.session';
const STATUS = PREFIX + '.status';
const A = 'fixture-capture-access-1';
const R = 'fixture-capture-refresh-1';
const A2 = 'fixture-capture-access-2';
const R2 = 'fixture-capture-refresh-2';
const API = '/v2/billing/meter/get-user-resource';
const TOKEN = '/v2/plugin/auth/token';
const REFRESH = TOKEN + '/refresh';
const read = (map, key = KEY) => JSON.parse(map.get(key) || 'null');
function fixture(options = {}) {
  const store = options.store || new Map();
  if (options.old) store.set(KEY, JSON.stringify(options.old));
  const messages = [], logs = [];
  const ctx = {
    env: options.env || {},
    request: options.manual ? undefined : {
      method: options.method || 'POST',
      url: options.url || 'https://www.codebuddy.cn' + (options.path || API),
      headers: new Headers(options.headers || {}),
    },
    response: options.raw == null ? undefined : { status: options.status || 200, text: async () => options.raw },
    storage: {
      getJSON: key => read(store, key),
      setJSON: (key, data) => {
        if (options.failWrite) throw new Error('storage fixture ' + A);
        store.set(key, JSON.stringify(data));
      },
      delete: key => store.delete(key),
    },
    notify: message => messages.push(message),
    http: { post: () => { throw new Error('capture must not send HTTP'); } },
  };
  return { store, messages, logs, ctx, async run() {
    const print = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try { return await capture(ctx); } finally { console.log = print; }
  } };
}

test('request collection covers account API beyond old checkin-only rules', async () => {
  const f = fixture({ headers: { authorization: 'Bearer ' + A, 'x-refresh-token': R, 'x-user-id': 'u1', 'x-tenant-id': 'e1', 'x-domain': 'cn' } });
  assert.equal(await f.run(), undefined);
  assert.equal(read(f.store).accessToken, A);
  assert.equal(read(f.store).refreshToken, R);
  assert.equal(read(f.store).enterpriseId, 'e1');
  assert.equal(read(f.store).uid, 'u1');
  assert.equal(f.ctx.request.headers.get('Authorization'), 'Bearer ' + A);
});

test('unchanged credentials do not write again or notify again', async () => {
  const f = fixture({ headers: { Authorization: 'Bearer ' + A } });
  await f.run();
  const original = f.store.get(KEY);
  await f.run(); assert.equal(f.store.get(KEY), original);
  assert.equal(f.messages.length, 1);
});

test('cookie-only request does not masquerade as a token', async () => {
  const f = fixture({ headers: { Cookie: 'session=fixture-private-cookie' } });
  await f.run(); assert.equal(read(f.store), null);
  assert.equal(f.messages.length, 0);
  assert.match(f.logs[0], /未携带 Bearer/);
  assert.ok(!JSON.stringify(f.logs).includes('fixture-private-cookie'));
});

test('OPTIONS and Basic auth are ignored', async () => {
  const f = fixture({ method: 'OPTIONS', headers: { Authorization: 'Bearer ' + A } });
  await f.run(); assert.equal(read(f.store), null);
  const g = fixture({ headers: { Authorization: 'Basic fixture' } });
  await g.run(); assert.equal(read(g.store), null);
});

for (const url of ['https://www.codebuddy.cn.evil.example/v2/test', 'https://other.example/v2/test', 'https://www.codebuddy.cn/home']) {
  test('ignores out-of-scope URL ' + url, async () => {
    const f = fixture({ url, headers: { Authorization: 'Bearer ' + A } });
    await f.run(); assert.equal(read(f.store), null);
  });
}

test('login response without Bearer accepts code 200 and preserves exact response', async () => {
  const raw = ' {"code":200,"data":{"accessToken":"' + A + '","refreshToken":"' + R + '","domain":"cn"}}\n';
  const f = fixture({ path: TOKEN + '?state=fixture', method: 'GET', raw });
  assert.deepEqual(await f.run(), { body: raw });
  assert.equal(read(f.store).accessToken, A);
  assert.equal(read(f.store).refreshToken, R);
  assert.equal(read(f.store).captureSource, 'token-response');
});

test('new login response clears old identity and old refresh when response omits it', async () => {
  const f = fixture({ old: { accessToken: A, refreshToken: R, uid: 'old', enterpriseId: 'e', inputTag: 'old-import-mark' }, path: TOKEN, raw: JSON.stringify({ code: 0, data: { access_token: A2 } }) });
  await f.run(); assert.equal(read(f.store).accessToken, A2);
  assert.equal(read(f.store).refreshToken, undefined);
  assert.equal(read(f.store).uid, undefined);
  assert.equal(read(f.store).inputTag, 'old-import-mark');
});

test('linked refresh response rotates both tokens but retains identity', async () => {
  const raw = JSON.stringify({ code: 0, data: { accessToken: A2, refreshToken: R2 } });
  const f = fixture({ old: { accessToken: A, refreshToken: R, uid: 'same', domain: 'cn' }, path: REFRESH, headers: { Authorization: 'Bearer ' + A, 'X-Refresh-Token': R }, raw });
  assert.deepEqual(await f.run(), { body: raw });
  assert.equal(read(f.store).accessToken, A2);
  assert.equal(read(f.store).refreshToken, R2);
  assert.equal(read(f.store).uid, 'same');
  assert.equal(read(f.store).domain, 'cn');
});

test('linked refresh response without new refresh preserves old refresh', async () => {
  const f = fixture({ old: { accessToken: A, refreshToken: R, uid: 'same' }, path: REFRESH, headers: { Authorization: 'Bearer ' + A }, raw: JSON.stringify({ code: 0, data: { accessToken: A2 } }) });
  await f.run(); assert.equal(read(f.store).refreshToken, R);
  assert.equal(read(f.store).uid, 'same');
});

test('refresh can be linked using only request refresh-token header', async () => {
  const f = fixture({ old: { accessToken: A, refreshToken: R, uid: 'same' }, path: REFRESH, headers: { 'X-Refresh-Token': R }, raw: JSON.stringify({ code: 0, data: { accessToken: A2, refreshToken: R2 } }) });
  await f.run(); assert.equal(read(f.store).uid, 'same');
  assert.equal(read(f.store).refreshToken, R2);
});

for (const raw of ['<html>not json</html>', '{"code":401,"data":{"accessToken":"fixture-invalid"}}', '{"code":0,"data":{"refreshToken":"fixture-only-refresh"}}']) {
  test('invalid token response passes through: ' + raw.slice(0, 35), async () => {
    const f = fixture({ path: TOKEN, raw });
    assert.deepEqual(await f.run(), { body: raw });
    assert.equal(read(f.store), null);
  });
}

test('HTTP error is not a successful token even when JSON says code 0', async () => {
  const f = fixture({ path: TOKEN, status: 401, raw: JSON.stringify({ code: 0, data: { accessToken: A } }) });
  await f.run(); assert.equal(read(f.store), null);
});

test('non-token response is never read', async () => {
  const f = fixture();
  f.ctx.response = { status: 200, text: async () => { throw new Error('must not read'); } };
  assert.equal(await f.run(), undefined); assert.equal(f.messages.length, 0);
});

test('write failure still passes response through and does not log tokens', async () => {
  const raw = JSON.stringify({ code: 0, data: { accessToken: A } });
  const f = fixture({ path: TOKEN, raw, failWrite: true });
  assert.deepEqual(await f.run(), { body: raw });
  assert.match(f.messages[0].body, /保存失败/);
  assert.ok(!JSON.stringify([f.messages, f.logs]).includes(A));
});

test('corrupt saved state still passes original response through', async () => {
  const f = fixture({ path: TOKEN, raw: JSON.stringify({ code: 0, data: { accessToken: A } }) });
  f.store.set(KEY, 'not json');
  assert.deepEqual(await f.run(), { body: f.ctx.response ? JSON.stringify({ code: 0, data: { accessToken: A } }) : '' });
  assert.match(f.messages[0].body, /保存失败/);
});

test('new user cannot inherit old refresh token', async () => {
  const f = fixture({ old: { accessToken: A, refreshToken: R, uid: 'old' }, headers: { Authorization: 'Bearer ' + A2, 'X-User-Id': 'new' } });
  await f.run(); assert.equal(read(f.store).uid, 'new');
  assert.equal(read(f.store).refreshToken, undefined);
});

test('unknown user with changed access also clears old refresh', async () => {
  const f = fixture({ old: { accessToken: A, refreshToken: R }, headers: { Authorization: 'Bearer ' + A2 } });
  await f.run(); assert.equal(read(f.store).refreshToken, undefined);
});

test('metadata-only updates do not erase previously recorded checkin reward', async () => {
  const f = fixture({ old: { accessToken: A }, headers: { Authorization: 'Bearer ' + A, 'User-Agent': 'Mozilla/5.0 fixture' } });
  f.store.set(STATUS, JSON.stringify({ state: 'ok', credit: 10 }));
  await f.run(); assert.equal(read(f.store, STATUS).credit, 10);
});

test('custom slot is isolated from default', async () => {
  const f = fixture({ old: { accessToken: A }, env: { WORKBUDDY_ACCOUNT_KEY: 'main' }, headers: { Authorization: 'Bearer ' + A2 } });
  await f.run(); assert.equal(read(f.store).accessToken, A);
  assert.equal(read(f.store, 'workbuddy.egern.v1.main.session').accessToken, A2);
});

test('capture feeds old schedule without Env token or manual copying', async () => {
  const f = fixture({ headers: { Authorization: 'Bearer ' + A, 'X-Refresh-Token': R, 'X-User-Id': 'user1' } });
  await f.run();
  const calls = [];
  const ctx = {
    env: {}, storage: f.ctx.storage, notify: m => f.messages.push(m),
    http: { post: async (url, config) => {
      calls.push({ url, config });
      assert.equal(config.headers.Authorization, 'Bearer ' + A);
      assert.equal(config.headers['X-User-Id'], 'user1');
      return { status: 200, json: async () => ({ code: 0, data: url.endsWith('/daily-checkin') ? { credit: 9 } : { today_checked_in: false } }) };
    } },
  };
  const log = console.log; console.log = () => {};
  try { await checkin(ctx); } finally { console.log = log; }
  assert.equal(calls.length, 2);
  assert.equal(read(f.store, STATUS).state, 'ok');
  assert.equal(read(f.store, STATUS).credit, 9);
});

test('manual run explains hook usage and performs no capture', async () => {
  const f = fixture({ manual: true }); await f.run();
  assert.match(f.messages[0].body, /无需单独点击运行/);
  assert.equal(read(f.store), null);
});
