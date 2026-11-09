import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// All traffic is mocked. Exporting helpers on the data: copy does not alter production files.
const source = await fs.readFile(new URL('../workbuddy.growth.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source +
  '\nexport const __growthTest = { readAuth, capture, transport, endpoint };').toString('base64'));
const { readAuth, capture, transport } = mod.__growthTest;
const main = mod.default;
const ORIGIN = 'https://www.workbuddy.cn';
const P = {
  tasks: '/v2/activity/growth/tasks', subscribe: '/v2/activity/growth/subscribe-task/status',
  profile: '/v2/activity/growth/profile', accept: '/activity/growth/tasks/accept',
  agreement: '/activity/growth/buddy/agreement', buddy: '/activity/growth/buddy/info', buddies: '/activity/growth/buddy/list',
  travel: '/activity/growth/buddy/travel/status', config: '/activity/growth/buddy/travel/config',
  depart: '/activity/growth/buddy/travel/depart', travelClaim: '/activity/growth/buddy/travel/claim',
  streak: '/activity/growth/streak', summary: '/activity/growth/redeem/summary', redeem: '/activity/growth/redeem',
};
const COOKIE = 'growth_session=fixture-cookie-secret';
const BEARER = 'fixture-growth-mini-secret';
const XSRF = 'fixture-xsrf-secret';
const ENTERPRISE = 'fixture-enterprise';
const LEGACY = 'fixture-plugin-secret';
const KEY = 'fixture.growth.session';
const baseEnv = { WORKBUDDY_GROWTH_COOKIE: COOKIE };
const auth = { cookie: COOKIE, platform: 'web', xsrf: XSRF, enterprise: ENTERPRISE };
const load = (store, key) => JSON.parse(store.get(key) || 'null');
const response = (data, code = 0) => ({ status: 200, body: { code, data } });
const request = (url = ORIGIN + P.tasks, headers = {}, method = 'GET') => ({
  url, method, headers: new Headers(headers), body: 'original-request-body',
});
function snapshot(req) {
  return { url: req.url, method: req.method, headers: [...req.headers], body: req.body };
}
async function withLogs(fn, logs) {
  const old = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(old)) console[k] = (...args) => logs.push(args.map(String).join(' '));
  try { return await fn(); } finally { Object.assign(console, old); }
}
function fixture(options = {}) {
  const store = options.store || new Map(), calls = [], messages = [], logs = [], writes = [], mismatches = [];
  const queue = options.queue && [...options.queue];
  const ctx = {
    env: options.env || {}, request: options.request,
    storage: {
      getJSON(key) {
        if (options.failReads) throw new Error('fixture corrupt storage');
        return load(store, key);
      },
      setJSON(key, value) {
        if (options.failWrites) throw new Error('fixture storage full');
        writes.push({ key, value: structuredClone(value) });
        store.set(key, JSON.stringify(value));
      },
      delete: key => store.delete(key),
    },
    notify(value) { messages.push(value); if (options.failNotify) throw new Error('fixture notify failure'); },
    http: {},
  };
  for (const method of ['get', 'post']) ctx.http[method] = async (url, config) => {
    const path = new URL(url).pathname;
    const call = { method, url, path, ...config };
    calls.push(call);
    let next;
    if (queue) {
      next = queue.shift();
      if (next && (next.path !== path || (next.method && next.method !== method))) {
        mismatches.push(`Expected ${next.method || '*'} ${next.path}, got ${method} ${path}`);
      }
    } else next = options.routes?.[method + ' ' + path];
    if (typeof next === 'function') {
      try { next = await next(call, ctx); }
      catch (error) {
        if (error?.code === 'ERR_ASSERTION') mismatches.push('Fixture assertion: ' + error.message);
        throw error;
      }
    }
    if (!next) {
      mismatches.push('Unexpected request: ' + method + ' ' + path);
      throw new Error('fixture unexpected HTTP');
    }
    if (next.throws) throw new Error(next.message || 'fixture timeout');
    return { status: next.status, json: async () => {
      if (next.badJSON) throw new Error('fixture non-JSON ' + COOKIE);
      return structuredClone(next.body);
    } };
  };
  const f = { ctx, store, calls, messages, logs, writes,
    check() {
      assert.deepEqual(mismatches, [], 'HTTP requests match fixtures');
      if (queue) assert.equal(queue.length, 0, 'All expected requests consumed');
    },
    async run() {
      assert.equal(typeof main, 'function', 'Growth main entry must be implemented');
      const result = await withLogs(() => main(ctx), logs);
      f.check(); return result;
    },
  };
  return f;
}
function noSecrets(f, extra = []) {
  const output = JSON.stringify([f.messages, f.logs]);
  for (const secret of [COOKIE, BEARER, XSRF, LEGACY, ...extra]) {
    assert.ok(!output.includes(secret), 'Notifications/logs must not reveal credentials');
  }
}
const posts = f => f.calls.filter(c => c.method === 'post');

test('unit: Cookie and miniprogram Bearer are exclusive', () => {
  assert.throws(() => readAuth({ ...baseEnv, WORKBUDDY_GROWTH_BEARER: BEARER }, {}), /只能配置一种/);
  const c = readAuth(baseEnv, {});
  assert.equal(c.cookie, COOKIE); assert.equal(c.access, ''); assert.equal(c.platform, 'web');
  const b = readAuth({ WORKBUDDY_GROWTH_BEARER: 'Bearer ' + BEARER }, {});
  assert.equal(b.access, BEARER); assert.equal(b.cookie, ''); assert.equal(b.platform, 'miniprogram');
});

test('unit: plugin credentials never become growth credentials', () => {
  const empty = {};
  assert.equal(readAuth({ WORKBUDDY_ACCESS_TOKEN: LEGACY, WORKBUDDY_REFRESH_TOKEN: LEGACY,
    WORKBUDDY_TOKEN: LEGACY, WORKBUDDY_ENTERPRISE_ID: ENTERPRISE }, empty), empty);
});

for (const name of ['COOKIE', 'BEARER', 'XSRF_TOKEN', 'ENTERPRISE_ID']) {
  for (const injected of ['safe\r\nX-Injected: bad', 'safe\u0000bad']) {
    test(`unit: rejects ${name} header injection ${JSON.stringify(injected)}`, () => {
      assert.throws(() => readAuth({ ['WORKBUDDY_GROWTH_' + name]: injected }, {}));
    });
  }
}

test('unit: oversized Cookie and whitespace Bearer are rejected', () => {
  assert.throws(() => readAuth({ WORKBUDDY_GROWTH_COOKIE: 'a'.repeat(16385) }, {}));
  assert.throws(() => readAuth({ WORKBUDDY_GROWTH_BEARER: 'token second-token' }, {}));
});

test('unit: unchanged environment preserves newer captured login state', () => {
  const configured = readAuth(baseEnv, {});
  const newer = { ...configured, cookie: 'growth_session=newer-fixture-cookie' };
  assert.equal(readAuth(baseEnv, newer), newer);
  assert.equal(readAuth({ WORKBUDDY_GROWTH_COOKIE: 'growth_session=changed-env' }, newer).cookie,
    'growth_session=changed-env');
});

test('unit: captures isolated website Cookie with CSRF, without rewriting request', () => {
  const req = request(ORIGIN + P.tasks + '?locale=zh-CN', {
    Cookie: COOKIE, 'X-XSRF-TOKEN': XSRF, 'X-Enterprise-Id': ENTERPRISE, 'User-Agent': 'fixture-UA',
  });
  const before = snapshot(req), f = fixture({ request: req });
  assert.equal(capture(f.ctx, KEY), undefined);
  assert.deepEqual(snapshot(req), before);
  assert.equal(load(f.store, KEY).cookie, COOKIE);
  assert.equal(load(f.store, KEY).xsrf, XSRF);
  assert.equal(load(f.store, KEY).enterprise, ENTERPRISE);
  assert.equal(load(f.store, KEY).userAgent, 'fixture-UA');
  assert.equal(f.calls.length, 0); noSecrets(f);
  const writes = f.writes.length; capture(f.ctx, KEY);
  assert.equal(f.writes.length, writes, 'Same login state is not repeatedly saved');
});

test('unit: miniprogram capture chooses Bearer without retaining Cookie', () => {
  const f = fixture({ request: request(ORIGIN + P.tasks, {
    Cookie: COOKIE, Authorization: 'Bearer ' + BEARER, 'X-Client-Platform': 'miniprogram',
  }) });
  capture(f.ctx, KEY);
  assert.equal(load(f.store, KEY).access, BEARER);
  assert.equal(load(f.store, KEY).cookie, ''); noSecrets(f);
});

for (const platform of ['web', 'workbuddy', 'untrusted']) {
  test('unit: does not capture a plugin-like Bearer for platform ' + platform, () => {
    const f = fixture({ request: request(ORIGIN + P.tasks, {
      Authorization: 'Bearer ' + LEGACY, 'X-Client-Platform': platform,
    }) });
    capture(f.ctx, KEY); assert.equal(f.store.size, 0); noSecrets(f);
  });
}

for (const url of [
  'http://www.workbuddy.cn' + P.tasks,
  'https://www.workbuddy.cn.evil.example' + P.tasks,
  'https://www.workbuddy.cn@evil.example' + P.tasks,
  'https://workbuddy.cn' + P.tasks,
  'https://www.codebuddy.cn' + P.tasks,
  ORIGIN + '/v2/plugin/auth/token/refresh',
  ORIGIN + '/profile/growth-center',
  ORIGIN + '/activity/growth-other/tasks',
  ORIGIN + '/activity/growth/../../v2/plugin/auth/token/refresh',
  ORIGIN + '/activity/growth/%2e%2e/%2e%2e/v2/plugin/auth/token/refresh',
]) {
  test('unit: rejects capture outside normalized official growth origin/path ' + url, () => {
    const req = request(url, { Cookie: COOKIE }), before = snapshot(req), f = fixture({ request: req });
    capture(f.ctx, KEY); assert.equal(f.store.size, 0); assert.deepEqual(snapshot(req), before);
  });
}

test('unit: OPTIONS and unauthenticated requests pass through without saving', () => {
  for (const req of [request(ORIGIN + P.tasks, { Cookie: COOKIE }, 'OPTIONS'), request()]) {
    const before = snapshot(req), f = fixture({ request: req });
    assert.equal(capture(f.ctx, KEY), undefined); assert.equal(f.store.size, 0);
    assert.deepEqual(snapshot(req), before);
  }
});

for (const session of [auth, { access: BEARER, platform: 'miniprogram' }]) {
  test('unit: transport uses exact official origin and one authentication scheme: ' + session.platform, async () => {
    const f = fixture({ queue: [{ path: P.tasks, method: 'get', ...response({ tasks: [] }) }] });
    assert.deepEqual(await transport(f.ctx, session)('get', P.tasks), { tasks: [] });
    f.check(); const c = f.calls[0];
    assert.equal(c.url, ORIGIN + P.tasks); assert.equal(c.timeout, 8000);
    assert.equal(c.redirect, 'error'); assert.equal(c.credentials, 'omit');
    assert.equal(c.body, undefined); assert.equal(c.headers['X-Client-Platform'], session.platform);
    assert.equal(c.headers.Origin, ORIGIN); assert.equal(c.headers.Referer, ORIGIN + '/profile/growth-center');
    assert.equal(c.headers.Cookie, session.cookie);
    assert.equal(c.headers.Authorization, session.access ? 'Bearer ' + session.access : undefined);
    assert.equal(c.headers['X-Refresh-Token'], undefined);
    assert.equal(c.headers['X-XSRF-TOKEN'], session.xsrf);
    assert.equal(c.headers['X-Enterprise-Id'], session.enterprise);
  });
}

for (const [label, r] of [
  ['HTTP 401', { status: 401, body: { code: 0, data: {} } }],
  ['HTTP 403', { status: 403, body: { code: 0, data: {} } }],
  ['HTTP 500', { status: 500, body: { code: 0, data: {} } }],
  ['business failure', { status: 200, body: { code: 91, message: COOKIE, data: {} } }],
  ['business 401', { status: 200, body: { code: 401, message: BEARER, data: {} } }],
  ['non-JSON', { status: 200, badJSON: true }],
  ['null response', { status: 200, body: null }],
  ['array response', { status: 200, body: [] }],
  ['string response', { status: 200, body: 'signed in ' + COOKIE }],
  ['timeout', { throws: true, message: COOKIE + ' ' + XSRF }],
]) {
  test('unit: transport rejects ' + label + ' without leaking credentials or retrying', async () => {
    const f = fixture({ queue: [{ path: P.tasks, ...r }] });
    await assert.rejects(transport(f.ctx, auth)('get', P.tasks), err => {
      for (const secret of [COOKIE, BEARER, XSRF]) assert.ok(!err.message.includes(secret));
      return true;
    });
    f.check(); assert.equal(f.calls.length, 1); noSecrets(f);
  });
}

test('unit: official data envelope does not require an unverified code field', async () => {
  // protocol.md §3.1: static source reads response.data.data and does not establish code === 0.
  const f = fixture({ queue: [{ path: P.tasks, status: 200, body: { data: { tasks: [] } } }] });
  assert.deepEqual(await transport(f.ctx, auth)('get', P.tasks), { tasks: [] }); f.check();
});

test('unit: whitelist blocks unknown, external, traversal and malformed task endpoints before HTTP', async () => {
  const f = fixture(), send = transport(f.ctx, auth);
  for (const path of ['/v2/plugin/auth/token/refresh', 'https://evil.example/collect',
    '/activity/growth/tasks/../claim', '/activity/growth/tasks/a%2Fb/claim',
    '/activity/growth/tasks/' + 'a'.repeat(129) + '/claim']) {
    await assert.rejects(send('post', path));
  }
  await assert.rejects(send('delete', P.tasks)); assert.equal(f.calls.length, 0);
});

test('unit: malformed stored auth headers cannot reach HTTP', async () => {
  for (const field of ['cookie', 'access', 'xsrf', 'enterprise', 'userAgent']) {
    const f = fixture();
    await assert.rejects(transport(f.ctx, { ...auth, [field]: 'fixture\r\nInjected: secret' })('get', P.tasks));
    assert.equal(f.calls.length, 0);
  }
});

test('unit: transport enforces the 24-request ceiling', async () => {
  const f = fixture({ routes: { ['get ' + P.tasks]: response({ tasks: [] }) } });
  const send = transport(f.ctx, auth);
  for (let i = 0; i < 24; i++) await send('get', P.tasks);
  await assert.rejects(send('get', P.tasks), /预算/);
  assert.equal(f.calls.length, 24); f.check();
});

test('unit: transport deadline prevents starting a request beyond time budget', async () => {
  const f = fixture(), now = Date.now;
  let clock = now(); Date.now = () => clock;
  try {
    const send = transport(f.ctx, auth); clock += 140000;
    await assert.rejects(send('get', P.tasks), /预算/); assert.equal(f.calls.length, 0);
  } finally { Date.now = now; }
});

const ROOT = 'workbuddy.growth.v1.default';
const report = f => load(f.store, ROOT + '.report');
const journal = f => load(f.store, ROOT + '.state');
function only(feature, extra = {}) {
  return { ...baseEnv, WORKBUDDY_GROWTH_MODE: 'run', WORKBUDDY_GROWTH_TASKS: 'false',
    WORKBUDDY_GROWTH_TRAVEL: 'false', WORKBUDDY_GROWTH_REDEEM: 'false',
    ['WORKBUDDY_GROWTH_' + feature]: 'true', ...extra };
}
const task = (task_code, accept_status = 'completed', extra = {}) => ({
  task_code, accept_status, title: 'Fixture task', task_type: 'advanced', has_reward: true,
  locked: false, progress: { current: 5, target: 5 }, reward_credit: 987654321, ...extra,
});
function eligibleRoutes() {
  return {
    ['get ' + P.agreement]: response({ agreed: true, dismissed_scenes: {} }),
    ['get ' + P.buddy]: response({ buddy: { instance_id: 123, name: 'Fixture Buddy' } }),
    ['get ' + P.buddies]: response({ buddies: [{ instance_id: 123, current_buddy: true }] }),
  };
}
function taskRoutes(tasks, extra = {}) {
  return {
    ...eligibleRoutes(),
    ['get ' + P.subscribe]: response({}),
    ['get ' + P.tasks]: () => response({ tasks }),
    ['get ' + P.profile]: response({ level: 1, level_name: 'Fixture', completed: 1, total: 6, max_level: false }),
    ...extra,
  };
}
const claimPath = code => '/activity/growth/tasks/' + code + '/claim';

test('main: exported native ctx entry is present', () => assert.equal(typeof main, 'function'));

test('main: off performs no HTTP, storage writes, or notifications, even with bad credentials', async () => {
  const f = fixture({ env: { WORKBUDDY_GROWTH_MODE: 'off', WORKBUDDY_GROWTH_COOKIE: 'bad\r\nHeader: value' } });
  assert.equal(await f.run(), undefined);
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.messages.length, 0);
});

for (const env of [{}, { WORKBUDDY_ACCESS_TOKEN: LEGACY, WORKBUDDY_REFRESH_TOKEN: LEGACY },
  { ...baseEnv, WORKBUDDY_GROWTH_BEARER: BEARER },
  { ...baseEnv, WORKBUDDY_GROWTH_MODE: 'unexpected' },
  { ...baseEnv, WORKBUDDY_GROWTH_COOKIE: 'cookie\r\nInjected: ' + COOKIE },
]) {
  test('main: missing, legacy, conflicting or invalid authentication never submits: ' + Object.keys(env).join(','), async () => {
    const store = new Map([['workbuddy.egern.v1.default.session', JSON.stringify({ accessToken: LEGACY })]]);
    const before = store.get('workbuddy.egern.v1.default.session');
    const f = fixture({ env, store }); await f.run();
    assert.equal(f.calls.length, 0); assert.equal(report(f).confirmed, 0);
    assert.equal(report(f).failed, true);
    assert.equal(store.get('workbuddy.egern.v1.default.session'), before); noSecrets(f);
  });
}

for (const slot of ['../default', 'default.session', 'a'.repeat(49), 'fixture\nother']) {
  test('main: invalid account slot rejected before storage or HTTP: ' + JSON.stringify(slot), async () => {
    const f = fixture({ env: { ...baseEnv, WORKBUDDY_ACCOUNT_KEY: slot } });
    await f.run(); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); noSecrets(f);
  });
}

test('main: capture namespaces two growth accounts without touching the legacy session', async () => {
  const store = new Map([['workbuddy.egern.v1.default.session', JSON.stringify({ accessToken: LEGACY })]]);
  for (const slot of ['one', 'two']) {
    const req = request(ORIGIN + P.tasks, { Cookie: COOKIE + slot }), before = snapshot(req);
    const f = fixture({ env: { WORKBUDDY_ACCOUNT_KEY: slot }, request: req, store });
    assert.equal(await f.run(), undefined); assert.deepEqual(snapshot(req), before);
    assert.equal(load(store, 'workbuddy.growth.v1.' + slot + '.session').cookie, COOKIE + slot);
    assert.equal(f.calls.length, 0); noSecrets(f, [COOKIE + slot]);
  }
  assert.equal(load(store, 'workbuddy.egern.v1.default.session').accessToken, LEGACY);
});

test('main: capture failure never rewrites or blocks the original request', async () => {
  const req = request(ORIGIN + P.tasks, { Cookie: COOKIE }), before = snapshot(req);
  const f = fixture({ request: req, failWrites: true });
  assert.equal(await f.run(), undefined); assert.deepEqual(snapshot(req), before);
  assert.equal(f.calls.length, 0); noSecrets(f);
});

test('main: off also disables credential capture', async () => {
  const f = fixture({ env: { WORKBUDDY_GROWTH_MODE: 'off' }, request: request(ORIGIN + P.tasks, { Cookie: COOKIE }) });
  await f.run(); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
});

for (const [suffix, raw] of [
  ['session', '{broken'], ['session', '[]'], ['session', '"text"'],
  ['lock', '{broken'], ['lock', '{"until":"tomorrow"}'], ['lock', '[]'],
  ['state', '{broken'], ['state', '[]'], ['state', '{}'],
  ['state', '{"attempts":[]}'], ['state', '{"attempts":{"claim:x":null}}'],
  ['state', '{"attempts":{"claim:x":{"at":"invalid"}}}'],
]) {
  test('main: corrupt ' + suffix + ' fails closed: ' + raw, async () => {
    const f = fixture({ env: only('TASKS'), store: new Map([[ROOT + '.' + suffix, raw]]) });
    await f.run(); assert.equal(f.calls.length, 0); assert.equal(report(f).confirmed, 0); noSecrets(f);
  });
}

test('main: storage read/write failures cannot start business HTTP', async () => {
  for (const option of ['failReads', 'failWrites']) {
    const f = fixture({ env: only('TASKS'), [option]: true });
    await f.run(); assert.equal(f.calls.length, 0); noSecrets(f);
  }
});

test('tasks: default preview lists actionable rewards without any business POST', async () => {
  const tasks = [task('preview_done'), task('preview_accept', 'not_accepted')];
  const env = only('TASKS', { WORKBUDDY_GROWTH_ACCEPT_CODES: 'preview_accept' });
  delete env.WORKBUDDY_GROWTH_MODE;
  const f = fixture({ env, routes: taskRoutes(tasks) }); await f.run();
  assert.equal(report(f).mode, 'preview'); assert.ok(report(f).planned >= 1);
  assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
});

test('tasks: only explicit completed rewards claim; progress, unknown states and special Buddy task cannot', async () => {
  const tasks = [task('eligible'), task('accepted', 'accepted'), task('progress', 'in_progress'),
    task('claimed', 'claimed'), task('unknown', 'unknown'), task('missing', undefined),
    task('not_accepted', 'not_accepted'), task('locked', 'completed', { locked: true }),
    task('no_reward', 'completed', { has_reward: false }), task('first_buddy'),
    task('../unsafe'), task('bad%2Fcode')];
  delete tasks[5].accept_status;
  const f = fixture({ env: only('TASKS'), routes: taskRoutes(tasks, {
    ['post ' + claimPath('eligible')]: () => { tasks[0].accept_status = 'claimed'; return response({ energy: 5 }); },
  }) });
  await f.run(); assert.deepEqual(posts(f).map(c => c.path), [claimPath('eligible')]);
  assert.equal(posts(f)[0].body, undefined, 'Official task claim has no request body');
  assert.equal(report(f).confirmed, 1);
  assert.ok(f.calls.filter(c => c.path === P.tasks).length >= 2, 'Claim is server-rechecked');
  assert.doesNotMatch(JSON.stringify([f.messages, f.logs]), /987654321/, 'Estimated task rewards are not claimed as actual income');
});

test('tasks: malformed list is not interpreted as successful completion', async () => {
  for (const value of [null, [], 'invalid', {}, { tasks: null }, { tasks: {} }]) {
    const f = fixture({ env: only('TASKS'), routes: taskRoutes([], { ['get ' + P.tasks]: response(value) }) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
  }
});

test('tasks: explicit opt-in accepts only safe ordinary not_accepted codes', async () => {
  const tasks = [task('ordinary', 'not_accepted'), task('automatic', 'not_accepted', { task_type: 'auto' }),
    task('beginner', 'not_accepted', { task_type: 'beginner' }), task('already_accepted', 'accepted'),
    task('locked', 'not_accepted', { locked: true }), task('unknown', 'unknown'),
    task('first_buddy', 'not_accepted', { task_type: 'beginner' })];
  const selected = tasks.map(t => t.task_code).join(',') + ',not_in_server_list';
  const f = fixture({ env: only('TASKS', { WORKBUDDY_GROWTH_ACCEPT_CODES: selected }), routes: taskRoutes(tasks, {
    ['post ' + P.accept]: call => {
      const body = JSON.parse(call.body); assert.deepEqual(body, { task_codes: ['ordinary'] });
      tasks[0].accept_status = 'accepted'; return response({});
    },
  }) });
  await f.run(); assert.deepEqual(posts(f).map(c => c.path), [P.accept]);
  assert.equal(report(f).confirmed, 1);
});

test('tasks: successful HTTP claim still requires server claimed status', async () => {
  const f = fixture({ env: only('TASKS'), routes: taskRoutes([task('unconfirmed')], {
    ['post ' + claimPath('unconfirmed')]: response({ energy: 5 }),
  }) });
  await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 0);
  assert.ok(f.calls.filter(c => c.path === P.tasks).length >= 2);
});

test('tasks: timeout is rechecked against server without blindly resending the claim', async () => {
  const tasks = [task('timeout_claim')];
  const f = fixture({ env: only('TASKS'), routes: taskRoutes(tasks, {
    ['post ' + claimPath('timeout_claim')]: () => {
      tasks[0].accept_status = 'claimed'; return { throws: true, message: COOKIE };
    },
  }) });
  await f.run(); assert.equal(posts(f).length, 1);
  const i = f.calls.findIndex(c => c.method === 'post');
  assert.ok(f.calls.slice(i + 1).some(c => c.method === 'get' && c.path === P.tasks),
    'Ambiguous timeout must trigger read-only server verification');
  noSecrets(f);
});

test('tasks: persistent journal precedes POST and suppresses duplicate claims after a new run', async () => {
  const tasks = [task('journal_claim')];
  const routes = taskRoutes(tasks, {
    ['post ' + claimPath('journal_claim')]: (_call, ctx) => {
      const state = ctx.storage.getJSON(ROOT + '.state');
      assert.ok(Object.values(state.attempts).some(r => r.status === 'pending'));
      assert.ok(!JSON.stringify(state).includes(COOKIE)); return { throws: true };
    },
  });
  const first = fixture({ env: only('TASKS'), routes }); await first.run();
  assert.equal(posts(first).length, 1); assert.ok(journal(first));
  const second = fixture({ env: only('TASKS'), routes: taskRoutes(tasks), store: first.store });
  await second.run(); assert.equal(posts(second).length, 0);
  assert.ok(second.calls.some(c => c.path === P.tasks), 'Journal does not replace fresh server reads');
  assert.equal(report(second).confirmed, 0);
});

test('tasks: failing the pre-submit journal write prevents the POST', async () => {
  const f = fixture({ env: only('TASKS'), routes: taskRoutes([task('no_journal')]) });
  const set = f.ctx.storage.setJSON;
  f.ctx.storage.setJSON = (key, value) => {
    if (key === ROOT + '.state') throw new Error('fixture journal write failed');
    return set(key, value);
  };
  await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
});

test('tasks: configurable write limit caps many eligible tasks and total HTTP budget', async () => {
  const tasks = Array.from({ length: 40 }, (_, i) => task('many_' + i));
  const routes = taskRoutes(tasks);
  for (const t of tasks) routes['post ' + claimPath(t.task_code)] = () => {
    t.accept_status = 'claimed'; return response({ energy: 1 });
  };
  const f = fixture({ env: only('TASKS', { WORKBUDDY_GROWTH_MAX_WRITES: '2' }), routes });
  await f.run(); assert.equal(posts(f).length, 2); assert.ok(f.calls.length <= 24);
});

for (const limit of ['0', '9', '-1', '1.5', 'Infinity', '2e1']) {
  test('tasks: invalid write budget fails closed: ' + limit, async () => {
    const f = fixture({ env: only('TASKS', { WORKBUDDY_GROWTH_MAX_WRITES: limit }), routes: eligibleRoutes() });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
    assert.equal(report(f).failed, true);
  });
}

function travelRoutes(state, extra = {}) {
  return { ...eligibleRoutes(), ['get ' + P.travel]: () => response(state),
    ['get ' + P.config]: response({ locations: [{ id: 'official-place', name: 'Fixture place' }] }), ...extra };
}

test('travel: unknown, traveling, reached-limit and unclear-limit states never write', async () => {
  for (const state of [null, {}, { state: 'unknown' }, { state: 'traveling', arrive_at: 1, server_now: 9999999999 },
    { state: 'idle', daily_limit_reached: true }, { state: 'idle' }, { state: 'idle', daily_limit_reached: 'false' },
    { state: 'arrived' }]) {
    const f = fixture({ env: only('TRAVEL'), routes: travelRoutes(state) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
  }
});

test('travel: arrived gift remains claimable despite daily limit; claim body and verification are exact', async () => {
  const state = { state: 'arrived', depart_at: 1794190000, daily_limit_reached: true };
  const f = fixture({ env: only('TRAVEL'), routes: travelRoutes(state, {
    ['post ' + P.travelClaim]: () => { state.state = 'idle'; return response({ reward_credit: 7, letter: null, use_deeplink: '' }); },
  }) });
  await f.run(); assert.deepEqual(posts(f).map(c => c.path), [P.travelClaim]);
  assert.equal(posts(f)[0].body, '{}'); assert.equal(report(f).confirmed, 1);
  assert.ok(f.calls.filter(c => c.path === P.travel).length >= 2);
});

for (const id of ['official-place', 17]) {
  test('travel: departure uses original server location ID type: ' + typeof id, async () => {
    const state = { state: 'idle', daily_limit_reached: false };
    const f = fixture({ env: only('TRAVEL'), routes: travelRoutes(state, {
      ['get ' + P.config]: response({ locations: [{ id, name: 'Fixture' }] }),
      ['post ' + P.depart]: call => {
        assert.deepEqual(JSON.parse(call.body), { location_id: id });
        Object.assign(state, { state: 'traveling', location: { id } }); return response({});
      },
    }) });
    await f.run(); assert.deepEqual(posts(f).map(c => c.path), [P.depart]); assert.equal(report(f).confirmed, 1);
  });
}

test('travel: absent, malformed or nonmatching locations cannot be fabricated', async () => {
  for (const locations of [[], null, {}, [{ id: null }], [{ id: 'other-place' }]]) {
    const f = fixture({ env: only('TRAVEL', { WORKBUDDY_GROWTH_TRAVEL_LOCATION: 'official-place' }),
      routes: travelRoutes({ state: 'idle', daily_limit_reached: false }, {
        ['get ' + P.config]: response({ locations }),
      }) });
    await f.run(); assert.equal(posts(f).length, 0);
  }
});

test('travel: returned departure status alone cannot override a contradictory server recheck', async () => {
  const f = fixture({ env: only('TRAVEL'), routes: travelRoutes({ state: 'idle', daily_limit_reached: false }, {
    ['post ' + P.depart]: response({ state: 'traveling', location: { id: 'official-place' } }),
  }) });
  await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 0);
});

test('travel: timed-out claim is read-only rechecked, not resent or followed by blind departure', async () => {
  const f = fixture({ env: only('TRAVEL'), routes: travelRoutes({ state: 'arrived', depart_at: 1794190000 }, {
    ['post ' + P.travelClaim]: { throws: true },
  }) });
  await f.run(); assert.deepEqual(posts(f).map(c => c.path), [P.travelClaim]);
  assert.ok(f.calls.filter(c => c.path === P.travel).length >= 2); assert.equal(report(f).confirmed, 0);
});

test('travel: miniprogram Bearer does not invoke unsupported travel APIs', async () => {
  const env = only('TRAVEL', { WORKBUDDY_GROWTH_COOKIE: '', WORKBUDDY_GROWTH_BEARER: BEARER });
  const f = fixture({ env, routes: eligibleRoutes() }); await f.run();
  assert.ok(f.calls.every(c => !c.path.includes('/travel/'))); assert.equal(posts(f).length, 0);
});

function streak(status = {}) {
  return { streak: { days: 999, next_tier: '' }, redemption_status: {
    tier_7d_status: 'locked', tier_14d_status: 'locked', tier_28d_status: 'locked',
    tiers: ['7d', '14d', '28d'].map(tier => ({ tier, credit: 100, energy: 1, cards: 1, chances: 1 })), ...status,
  }, makeup_cards: { balance: 0, max: 4 } };
}
function redeemRoutes(data, extra = {}) {
  return { ...eligibleRoutes(), ['get ' + P.streak]: () => response(data),
    ['get ' + P.summary]: response({ starter_count: 0, advanced_count: 0, legendary_count: 0 }), ...extra };
}

test('redeem: only explicitly available unclaimed server tiers redeem, never days or summary counts', async () => {
  const data = streak({ tier_7d_status: 'claimed', tier_14d_status: 'available', tier_28d_status: 'locked' });
  const f = fixture({ env: only('REDEEM'), routes: redeemRoutes(data, {
    ['post ' + P.redeem]: (call, ctx) => {
      const body = JSON.parse(call.body); assert.equal(body.tier, '14d');
      assert.deepEqual(Object.keys(body).sort(), ['client_token', 'tier']);
      assert.match(body.client_token, /^redeem-14d-.+/); assert.ok(!body.client_token.includes(BEARER));
      assert.ok(Object.values(ctx.storage.getJSON(ROOT + '.state').attempts).some(r => r.clientToken === body.client_token));
      data.redemption_status.tier_14d_status = 'claimed';
      return response({ cards_granted: 1, cards_overflow: 0, credit_granted: 50, energy_granted: 3, chances_granted: 1 });
    },
  }) });
  await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 1);
  assert.ok(f.calls.filter(c => c.path === P.streak).length >= 2);
});

test('redeem: unknown, missing, malformed, claimed, or locked eligibility cannot be inferred from many days', async () => {
  for (const data of [null, {}, { streak: { days: 999 } }, { redemption_status: [] },
    streak(), streak({ tier_7d_status: 'claimed' }), streak({ tier_14d_status: 'unknown' }),
    streak({ tier_28d_status: true })]) {
    const f = fixture({ env: only('REDEEM'), routes: redeemRoutes(data) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
  }
});

test('redeem: preview shows eligible tier without generating mutation or journal', async () => {
  const f = fixture({ env: only('REDEEM', { WORKBUDDY_GROWTH_MODE: 'preview' }),
    routes: redeemRoutes(streak({ tier_7d_status: 'available' })) });
  await f.run(); assert.equal(posts(f).length, 0); assert.ok(report(f).planned >= 1);
  assert.ok(!journal(f) || Object.keys(journal(f).attempts).length === 0);
});

test('redeem: timeout keeps the persisted client_token and suppresses repeated redemption', async () => {
  const data = streak({ tier_7d_status: 'available' });
  const first = fixture({ env: only('REDEEM'), routes: redeemRoutes(data, { ['post ' + P.redeem]: { throws: true } }) });
  await first.run(); assert.equal(posts(first).length, 1);
  const token = JSON.parse(posts(first)[0].body).client_token;
  const second = fixture({ env: only('REDEEM'), routes: redeemRoutes(data), store: first.store });
  await second.run(); assert.equal(posts(second).length, 0);
  assert.ok(Object.values(journal(second).attempts).some(r => r.clientToken === token));
});

for (const [label, bad] of [
  ['HTTP401', { status: 401, body: { data: {} } }],
  ['HTTP403', { status: 403, body: { data: {} } }],
  ['business failure', { status: 200, body: { code: 93, message: COOKIE, data: {} } }],
  ['non-JSON', { status: 200, badJSON: true }],
  ['wrong structure', { status: 200, body: [] }],
]) {
  test('mutations: ' + label + ' cannot become success without a confirming server state', async () => {
    const f = fixture({ env: only('TASKS'), routes: taskRoutes([task('error_claim')], {
      ['post ' + claimPath('error_claim')]: bad,
    }) });
    await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 0);
    assert.equal(report(f).failed, true); noSecrets(f);
    assert.ok(f.calls.every(c => !c.path.includes('/plugin/')));
  });
}

test('tasks: oversized/duplicate/object-invalid lists fail closed rather than partially claiming', async () => {
  for (const tasks of [[task('duplicate'), task('duplicate')], [null], [true],
    Array.from({ length: 201 }, (_, i) => task('oversized_' + i))]) {
    const f = fixture({ env: only('TASKS'), routes: taskRoutes(tasks) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
  }
});

test('tasks: default has_reward is accepted, but ambiguous reward flags and explicit locks are not', async () => {
  const eligible = task('default_reward'); delete eligible.has_reward;
  const tasks = [eligible, task('string_reward', 'completed', { has_reward: 'true' }),
    task('string_lock', 'completed', { locked: 'false' }),
    task('future', 'completed', { locked: true, unlock_at: '2999-01-01T00:00:00Z' }),
    task('unknown_time', 'completed', { locked: true, unlock_at: 'not-a-date' })];
  const f = fixture({ env: only('TASKS'), routes: taskRoutes(tasks, {
    ['post ' + claimPath('default_reward')]: () => { eligible.accept_status = 'claimed'; return response({}); },
  }) });
  await f.run(); assert.deepEqual(posts(f).map(c => c.path), [claimPath('default_reward')]);
});

test('tasks: preview never calls subscription refresh GET with state-refresh side effects', async () => {
  const f = fixture({ env: only('TASKS', { WORKBUDDY_GROWTH_MODE: 'preview' }), routes: taskRoutes([]) });
  await f.run(); assert.equal(f.calls.some(c => c.path === P.subscribe), false);
});

test('concurrency: two overlapping runs in one slot perform at most one claim', { timeout: 5000 }, async () => {
  const store = new Map(), tasks = [task('concurrent')];
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const first = fixture({ env: only('TASKS'), store, routes: taskRoutes(tasks, {
    ['get ' + P.tasks]: async () => { enter(); await blocked; return response({ tasks }); },
    ['post ' + claimPath('concurrent')]: () => { tasks[0].accept_status = 'claimed'; return response({}); },
  }) });
  const second = fixture({ env: only('TASKS'), store });
  await withLogs(async () => {
    const running = main(first.ctx); await entered;
    try { await main(second.ctx); } finally { release(); }
    await running;
  }, first.logs);
  first.check(); second.check();
  assert.equal(posts(first).length + posts(second).length, 1);
  assert.equal(second.calls.length, 0); assert.equal(load(store, ROOT + '.lock'), null);
});

test('concurrency: pre-existing active lease is respected and never deleted by a skipped run', async () => {
  const lock = { id: 'other-fixture-run', until: Date.now() + 60000 };
  const f = fixture({ env: only('TASKS'), store: new Map([[ROOT + '.lock', JSON.stringify(lock)]]) });
  await f.run(); assert.equal(f.calls.length, 0); assert.deepEqual(load(f.store, ROOT + '.lock'), lock);
});

test('concurrency: a lost lease must block business writes and preserve the new owner lock', async () => {
  const replacement = { id: 'replacement-owner', until: Date.now() + 60000 };
  const f = fixture({ env: only('TASKS'), routes: taskRoutes([task('lost_lease')], {
    ['get ' + P.tasks]: (_call, ctx) => {
      ctx.storage.setJSON(ROOT + '.lock', replacement); return response({ tasks: [task('lost_lease')] });
    },
    ['post ' + claimPath('lost_lease')]: response({}),
  }) });
  await f.run(); assert.equal(posts(f).length, 0, 'Lease ownership must be rechecked before POST');
  assert.deepEqual(load(f.store, ROOT + '.lock'), replacement);
});

test('main: notify failure cannot turn a verified reward into a duplicate business request', async () => {
  const tasks = [task('notify_failure')];
  const f = fixture({ env: only('TASKS'), failNotify: true, routes: taskRoutes(tasks, {
    ['post ' + claimPath('notify_failure')]: () => { tasks[0].accept_status = 'claimed'; return response({}); },
  }) });
  await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 1);
});

test('eligibility: absent/false/string agreement never triggers automation or accepts rules for user', async () => {
  for (const data of [{}, { agreed: false }, { agreed: 'true' }, null, []]) {
    const f = fixture({ env: only('TASKS'), routes: taskRoutes([task('not_agreed')], {
      ['get ' + P.agreement]: response(data),
    }) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
    assert.ok(f.calls.every(c => c.path === P.agreement));
  }
});

test('eligibility: no Buddy skips travel and ordinary rewards but allows confirmed RichMeow_Chat', async () => {
  const tasks = [task('ordinary_no_buddy'), task('first_buddy'), task('RichMeow_Chat')];
  const f = fixture({ env: only('TASKS', { WORKBUDDY_GROWTH_TRAVEL: 'true' }), routes: taskRoutes(tasks, {
    ['get ' + P.buddy]: response({ buddy: null }), ['get ' + P.buddies]: response({ buddies: [] }),
    ['post ' + claimPath('RichMeow_Chat')]: () => { tasks[2].accept_status = 'claimed'; return response({}); },
  }) });
  await f.run(); assert.deepEqual(posts(f).map(c => c.path), [claimPath('RichMeow_Chat')]);
  assert.equal(f.calls.some(c => c.path.includes('/travel/')), false);
});

test('eligibility: noncurrent Buddy in official list is enough when current info is null', async () => {
  const tasks = [task('list_buddy')];
  const f = fixture({ env: only('TASKS'), routes: taskRoutes(tasks, {
    ['get ' + P.buddy]: response({ buddy: null }),
    ['get ' + P.buddies]: response({ buddies: [{ instance_id: 123, current_buddy: false }] }),
    ['post ' + claimPath('list_buddy')]: () => { tasks[0].accept_status = 'claimed'; return response({}); },
  }) });
  await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 1);
});

test('eligibility: malformed Buddy information cannot enable writes', async () => {
  for (const buddy of ['present', [], {}, { instance_id: null }]) {
    const f = fixture({ env: only('TASKS'), routes: taskRoutes([task('invalid_buddy')], {
      ['get ' + P.buddy]: response({ buddy }),
    }) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
  }
});

test('redeem: unknown card rewards, unclear capacity and overflow are skipped without forfeiting cards', async () => {
  const variants = [
    data => { delete data.redemption_status.tiers; },
    data => { data.redemption_status.tiers[0].cards = '1'; },
    data => { data.redemption_status.tiers[0].cards = -1; },
    data => { delete data.makeup_cards; },
    data => { data.makeup_cards.balance = '0'; },
    data => { data.makeup_cards.balance = 4; },
  ];
  for (const change of variants) {
    const data = streak({ tier_7d_status: 'available' }); change(data);
    const f = fixture({ env: only('REDEEM'), routes: redeemRoutes(data) });
    await f.run(); assert.equal(posts(f).length, 0); assert.equal(report(f).confirmed, 0);
  }
});

test('redeem: next available tier uses refreshed card balance rather than a stale pre-redemption snapshot', async () => {
  const data = streak({ tier_7d_status: 'available', tier_14d_status: 'available' });
  data.makeup_cards.balance = 3;
  const f = fixture({ env: only('REDEEM'), routes: redeemRoutes(data, {
    ['post ' + P.redeem]: call => {
      assert.equal(JSON.parse(call.body).tier, '7d');
      data.redemption_status.tier_7d_status = 'claimed'; data.makeup_cards.balance = 4;
      return response({ cards_granted: 1, cards_overflow: 0 });
    },
  }) });
  await f.run(); assert.equal(posts(f).length, 1); assert.equal(report(f).confirmed, 1);
});

// Final hardening regressions from independent review. No live service access.
test('hardening: derives decoded same-origin XSRF header from Cookie', async () => {
  const f=fixture({routes:{['get '+P.tasks]:response({tasks:[]})}});
  await transport(f.ctx,{cookie:COOKIE+'; XSRF-TOKEN=fixture%2Fencoded%3D',platform:'web'})('get',P.tasks);
  f.check(); assert.equal(f.calls[0].headers['X-XSRF-TOKEN'],'fixture/encoded=');
});
test('hardening: unresolved monthly redemption survives midnight without replacing client_token', async () => {
  const now=Date.now; let clock=Date.parse('2026-11-09T23:59:59+08:00'); Date.now=()=>clock;
  try {
    const data={redemption_status:{tier_7d_status:'available',tiers:[{tier:'7d',cards:0}]}};
    const routes={...eligibleRoutes(),['get '+P.streak]:response(data),['post '+P.redeem]:{throws:true}};
    const f=fixture({env:only('REDEEM'),routes}); await f.run();
    assert.equal(posts(f).length,1); const before=structuredClone(journal(f));
    clock+=2000;
    const g=fixture({env:only('REDEEM'),store:f.store,routes}); await g.run();
    assert.equal(posts(g).length,0); assert.deepEqual(journal(g),before);
  } finally { Date.now=now; }
});
test('hardening: function-level read failure notifies even with idle notifications disabled', async () => {
  const f=fixture({env:only('REDEEM'),routes:{...eligibleRoutes(),['get '+P.streak]:{status:500,body:{}}}});
  await f.run(); assert.equal(report(f).failed,true); assert.equal(f.messages.length,1); noSecrets(f);
});
test('hardening: null locked and has_reward follow official nullish defaults', async () => {
  const t=task('null_defaults','completed',{locked:null,has_reward:null});
  const f=fixture({env:only('TASKS'),routes:taskRoutes([t],{['post /activity/growth/tasks/null_defaults/claim']:()=>{t.accept_status='claimed';return response({});}})});
  await f.run(); assert.equal(posts(f).length,1); assert.equal(report(f).confirmed,1);
});
test('hardening: explicit write 401 does not permanently block retry after reauthentication', async () => {
  const t=task('auth_recovery');
  const route='post /activity/growth/tasks/auth_recovery/claim';
  const f=fixture({env:only('TASKS'),routes:taskRoutes([t],{[route]:{status:401,body:{code:401}}})});
  await f.run(); assert.equal(posts(f).length,1); assert.equal(Object.keys(journal(f).attempts).length,0);
  const g=fixture({env:only('TASKS'),store:f.store,routes:taskRoutes([t],{[route]:()=>{t.accept_status='claimed';return response({});}})});
  await g.run(); assert.equal(posts(g).length,1); assert.equal(report(g).confirmed,1);
});
test('hardening: arbitrary storage exceptions cannot echo credential values', async () => {
  const f=fixture({env:only('TASKS')});
  f.ctx.storage.getJSON=()=>{throw new Error('保存的登录态 '+COOKIE);};
  await f.run(); assert.equal(f.calls.length,0); noSecrets(f);
});
