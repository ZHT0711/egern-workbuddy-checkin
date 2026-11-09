import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Dependency-free static contract checks, not a replacement for an Egern YAML schema validator.
const yaml = await fs.readFile(new URL('../workbuddy.growth.module.yaml', import.meta.url), 'utf8');
const block = (key, input = yaml) => {
  const match = input.match(new RegExp('^  ' + key + ':\\n([\\s\\S]*?)(?=^  [A-Z][A-Z_]*:|^scriptings:)', 'm'));
  assert.ok(match, 'Missing env schema: ' + key); return match[1];
};

test('growth module: all independent authentication inputs are declared', () => {
  for (const key of ['WORKBUDDY_ACCOUNT_KEY', 'WORKBUDDY_GROWTH_MODE', 'WORKBUDDY_GROWTH_COOKIE',
    'WORKBUDDY_GROWTH_BEARER', 'WORKBUDDY_GROWTH_XSRF_TOKEN', 'WORKBUDDY_GROWTH_ENTERPRISE_ID']) block(key);
  assert.doesNotMatch(yaml, /^  WORKBUDDY_(?:ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|UID|ENTERPRISE_ID):/m);
});

test('growth module: preview is the default with explicit preview/run/off choices', () => {
  const mode = block('WORKBUDDY_GROWTH_MODE');
  assert.match(mode, /^    default_value: ["']?preview["']?$/m);
  for (const value of ['preview', 'run', 'off']) assert.match(mode, new RegExp('^      - ["\']?' + value + '["\']?$', 'm'));
});

test('growth module: credential inputs contain no shipped default secrets', () => {
  for (const key of ['COOKIE', 'BEARER', 'XSRF_TOKEN', 'ENTERPRISE_ID']) {
    assert.doesNotMatch(block('WORKBUDDY_GROWTH_' + key), /^    default_value:\s*\S+/m);
  }
});

test('growth module: native scripts use only the isolated growth entry', () => {
  const urls = [...yaml.matchAll(/^      script_url: (.+)$/gm)].map(m => m[1]);
  assert.equal(urls.length, 2);
  for (const url of urls) assert.equal(url,
    'https://raw.githubusercontent.com/ZHT0711/egern-workbuddy-checkin/main/workbuddy.growth.js');
  assert.match(yaml, /^  - schedule:$/m); assert.match(yaml, /^  - http_request:$/m);
  assert.doesNotMatch(yaml, /^  - http_response:$/m);
  assert.match(yaml, /^      body_required: false$/m);
});

test('growth module: capture matcher is anchored to official growth origin/path', () => {
  const raw = yaml.match(/^      match: (.+)$/m)?.[1]; assert.ok(raw);
  const re = new RegExp(raw);
  for (const path of ['/v2/activity/growth/tasks', '/activity/growth/buddy/travel/status']) {
    assert.equal(re.test('https://www.workbuddy.cn' + path), true);
    for (const origin of ['http://www.workbuddy.cn', 'https://www.codebuddy.cn',
      'https://www.workbuddy.cn.evil.example', 'https://www.workbuddy.cn@evil.example']) {
      assert.equal(re.test(origin + path), false);
    }
  }
  for (const path of ['/profile/growth-center', '/v2/plugin/auth/token/refresh', '/activity/growth-other/tasks']) {
    assert.equal(re.test('https://www.workbuddy.cn' + path), false);
  }
});

test('growth module: MITM scope is the website alone without wildcard or plugin domain', () => {
  const mitm = yaml.match(/^mitm:\n([\s\S]*?)(?=^[a-z_]+:|$(?![\s\S]))/m)?.[1]; assert.ok(mitm);
  assert.deepEqual([...mitm.matchAll(/^      - (.+)$/gm)].map(m => m[1]), ['www.workbuddy.cn']);
  assert.doesNotMatch(mitm, /\*|codebuddy/);
});

test('growth module: bounded schedules and write-limit default remain explicit', () => {
  assert.match(yaml, /^      timeout: 180$/m);
  assert.match(yaml, /^      timeout: 10$/m);
  assert.match(block('WORKBUDDY_GROWTH_MAX_WRITES'), /^    default_value: ["']?[1-8]["']?$/m);
  assert.match(yaml, /^manual: https:\/\/github\.com\/ZHT0711\/egern-workbuddy-checkin\/blob\/main\/GROWTH-README\.md$/m);
});

const plus = await fs.readFile(new URL('../workbuddy.plus.module.yaml', import.meta.url), 'utf8');

test('plus module: keeps legacy scripts and adds separate growth schedule/capture', () => {
  const files = [...plus.matchAll(/^\s+script_url: https:\/\/raw\.githubusercontent\.com\/ZHT0711\/egern-workbuddy-checkin\/main\/(.+)$/gm)].map(m => m[1]);
  assert.deepEqual(files, ['workbuddy.js', 'workbuddy.token.js', 'workbuddy.token.js', 'workbuddy.growth.js', 'workbuddy.growth.js']);
  assert.equal([...plus.matchAll(/^\s*- schedule:$/gm)].length, 2);
  assert.equal([...plus.matchAll(/^\s*- http_request:$/gm)].length, 2);
  assert.equal([...plus.matchAll(/^\s*- http_response:$/gm)].length, 1);
  for (const key of ['WORKBUDDY_ACCESS_TOKEN', 'WORKBUDDY_REFRESH_TOKEN', 'WORKBUDDY_GROWTH_COOKIE',
    'WORKBUDDY_GROWTH_BEARER']) block(key, plus);
});

test('plus module: growth remains preview by default and off is not transformed into false', () => {
  const mode = block('WORKBUDDY_GROWTH_MODE', plus);
  assert.match(mode, /^\s+default_value: ["']?preview["']?$/m);
  for (const value of ['preview', 'run', 'off']) assert.match(mode, new RegExp('^\\s+- ["\']?' + value + '["\']?$', 'm'));
  assert.doesNotMatch(mode, /^\s+- ["']?false["']?$/m, 'YAML 1.1 must not coerce the off option to a boolean');
});

test('modules: off enum is quoted to remain a string in YAML 1.1 and YAML 1.2', () => {
  for (const content of [yaml, plus]) assert.match(block('WORKBUDDY_GROWTH_MODE', content), /^\s+- (?:"off"|'off')$/m);
});

test('plus module: MITM covers only the two isolated official sites', () => {
  const mitm = plus.match(/^mitm:\n([\s\S]*?)(?=^[a-z_]+:|$(?![\s\S]))/m)?.[1]; assert.ok(mitm);
  assert.deepEqual([...mitm.matchAll(/^\s+- (.+)$/gm)].map(m => m[1]).sort(), ['www.codebuddy.cn', 'www.workbuddy.cn']);
  assert.doesNotMatch(mitm, /\*/);
  assert.equal([...plus.matchAll(/^  WORKBUDDY_ACCOUNT_KEY:$/gm)].length, 1);
});
