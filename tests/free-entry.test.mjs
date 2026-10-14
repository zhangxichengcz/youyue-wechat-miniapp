import test from 'node:test';
import assert from 'node:assert/strict';
import entry from '../free-entry/public/_worker.js';

test('备用入口可在绑定前独立检测手机连接', async () => {
  const r = await entry.fetch(new Request('https://entry.example/reachability'), {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), { ok: true, service: 'youyue-free-entry', reachable: true });
});

test('备用入口原样传递身份和正文，保留后台鉴权结果', async () => {
  const input = new Request('https://entry.example/api', {
    method: 'POST', headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get', payload: { id: 'booking-test' } })
  });
  const expected = new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN' }), { status: 403 });
  const actual = await entry.fetch(input, { BACKEND: { fetch: async request => {
    assert.equal(request.headers.get('Authorization'), 'Bearer test-session');
    assert.deepEqual(await request.json(), { action: 'get', payload: { id: 'booking-test' } });
    return expected;
  } } });
  assert.equal(actual, expected);
  assert.equal(actual.status, 403);
});

test('健康检查来自原后台，未绑定时明确失败', async () => {
  const unbound = await entry.fetch(new Request('https://entry.example/health'), {});
  assert.equal(unbound.status, 503);
  assert.equal((await unbound.json()).code, 'CONFIG');
  const expected = { ok: true, service: 'youyue-free-backend', configured: true, remindersConfigured: true };
  const bound = await entry.fetch(new Request('https://entry.example/health'), {
    BACKEND: { fetch: async () => new Response(JSON.stringify(expected)) }
  });
  assert.deepEqual(await bound.json(), expected);
});

test('备用入口不开放额外路由或按用户地址转发请求', async () => {
  let calls = 0;
  const env = { BACKEND: { fetch: async () => { calls++; return new Response('unexpected'); } } };
  for (const [path, method] of [['/admin', 'GET'], ['/api', 'GET'], ['/health', 'POST'], ['/proxy?url=https://other.example', 'GET']]) {
    assert.equal((await entry.fetch(new Request('https://entry.example' + path, { method }), env)).status, 404);
  }
  assert.equal(calls, 0);
});

test('内部连接失败不会暴露请求令牌或后台错误详情', async () => {
  const r = await entry.fetch(new Request('https://entry.example/login', { method: 'POST' }), {
    BACKEND: { fetch: async () => { throw new Error('private-test-detail'); } }
  });
  assert.equal(r.status, 503);
  const body = await r.text();
  assert.equal(JSON.parse(body).code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(body.includes('private-test-detail'), false);
});
