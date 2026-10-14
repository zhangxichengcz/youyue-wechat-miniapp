'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const time = require('../miniprogram/utils/time');
function isolatedFreeApi(wx) {
  const logs = [], module = { exports: {} };
  const source = require('node:fs').readFileSync(require.resolve('../miniprogram/utils/free-api'), 'utf8');
  require('node:vm').runInNewContext(source, {
    module, wx, require: () => ({ apiBase: 'https://entry.example' }),
    console: { warn: (...items) => logs.push(items) }, Date, Promise, Error
  });
  return { api: module.exports, logs };
}
function isolatedDiagnostics(wx) {
  let definition;
  const source = require('node:fs').readFileSync(require.resolve('../miniprogram/pages/diagnostics/index'), 'utf8');
  require('node:vm').runInNewContext(source, {
    Page: value => { definition = value; }, wx, Promise: undefined,
    getApp: () => ({ globalData: { config: { apiBase: 'https://entry.example' } } })
  });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData: patch => Object.assign(page.data, patch) });
  page.onLoad(); return page;
}
test('手机检测页独立验证微信内的GET与POST，结果不显示登录令牌', () => {
  const requests = [];
  const page = isolatedDiagnostics({
    getAccountInfoSync: () => ({ miniProgram: { version: '1.0.3', envVersion: 'trial' } }),
    login: options => options.success({ code: 'private-login-fixture' }),
    request: options => {
      requests.push(options);
      options.success({ statusCode: 200, data: options.method === 'GET'
        ? { ok: true, configured: true, remindersConfigured: true }
        : { ok: true, data: { token: 'private-token-fixture' } } });
    }
  });
  page.checkHealth(); page.checkLogin();
  assert.equal(page.data.actualVersion, '1.0.3');
  assert.match(page.data.health, /后台连接正常/);
  assert.match(page.data.login, /微信登录正常/);
  assert.equal(requests[0].url, 'https://entry.example/health');
  assert.equal(requests[1].url, 'https://entry.example/login');
  assert.equal(requests[1].data.code, 'private-login-fixture');
  assert.equal(JSON.stringify(page.data).includes('private-'), false);
  assert.equal(page.data.busy, false);
});
test('微信请求失败时检测页保留具体连接错误并允许重试', () => {
  let success = false;
  const page = isolatedDiagnostics({
    getAccountInfoSync: () => ({ miniProgram: { version: '1.0.3' } }),
    request: options => success
      ? options.success({ statusCode: 200, data: { ok: true, configured: true, remindersConfigured: true } })
      : options.fail({ errMsg: 'request:fail url not in domain list' })
  });
  page.checkHealth();
  assert.match(page.data.health, /url not in domain list/);
  assert.equal(page.data.busy, false);
  success = true; page.checkHealth();
  assert.match(page.data.health, /后台连接正常/);
});
test('微信登录失败后可再次尝试，不依赖Promise.finally', async () => {
  let failing = true, logins = 0;
  const { api } = isolatedFreeApi({
    login: options => { logins++; options.success({ code: 'private-login-fixture' }); },
    request: options => {
      if (failing) { options.fail({ errMsg: 'request:fail timeout' }); return; }
      options.success({ data: { ok: true, data: options.url.endsWith('/login')
        ? { token: 'private-token-fixture', expiresAt: Date.now() + 3600000 }
        : { booking: null } } });
    }
  });
  await assert.rejects(api.call('upcoming', {}));
  failing = false;
  assert.deepEqual(await api.call('upcoming', {}), { booking: null });
  assert.equal(logins, 2);
});
test('微信域名校验失败与普通连接失败分开显示，诊断不泄露凭证', async () => {
  let requests = 0;
  const { api, logs } = isolatedFreeApi({
    login: options => options.success({ code: 'private-login-fixture' }),
    request: options => {
      requests++;
      options.fail({ errMsg: 'request:fail url not in domain list private-error-fixture' });
    }
  });
  await assert.rejects(api.call('upcoming', {}), error => error.code === 'NETWORK_DOMAIN' && /微信/.test(error.message));
  assert.equal(requests, 1);
  assert.equal(logs[0][1].path, '/login');
  assert.equal(logs[0][1].reason, 'NETWORK_DOMAIN');
  assert.equal(JSON.stringify(logs).includes('private-'), false);
});
test('创建请求超时不自动重复提交或重新登录', async () => {
  let logins = 0, creations = 0;
  const { api, logs } = isolatedFreeApi({
    login: options => { logins++; options.success({ code: 'private-login-fixture' }); },
    request: options => {
      if (options.url.endsWith('/login')) {
        options.success({ data: { ok: true, data: { token: 'private-token-fixture', expiresAt: Date.now() + 3600000 } } });
      } else {
        creations++;
        assert.equal(options.header.Authorization, 'Bearer private-token-fixture');
        assert.equal(options.data.action, 'create');
        options.fail({ errMsg: 'request:fail timeout private-error-fixture' });
      }
    }
  });
  await assert.rejects(api.call('create', { note: 'private-note-fixture' }), error => error.code === 'NETWORK_TIMEOUT');
  assert.equal(logins, 1); assert.equal(creations, 1);
  assert.equal(logs[0][1].path, '/api');
  assert.equal(JSON.stringify(logs).includes('private-'), false);
});
test('客户端统一显示北京时间，待确认邀请开始时显示过期', () => {
  const ms=Date.parse('2026-10-14T23:30:00Z');
  assert.equal(time.format(ms),'2026-10-15 07:30');
  assert.equal(time.parse('2026-10-15','07:30'),ms);
  const b=time.decorate({status:'pending',startAt:Date.now()-1000,endAt:Date.now()+3600000});
  assert.equal(b.status,'expired');assert.equal(b.canAct,false);
});
test('预约详情加载预约与个人配置后可显示页面，失败时提供可重试提示', async () => {
  let definition;
  const booking = { id: 'detail-test', role: 'sender', status: 'pending', title: '私人会面', startAt: Date.now() + 2 * 86400000, endAt: Date.now() + 2 * 86400000 + 3600000 };
  let failure = false;
  const api = { demoMode: false, call: async action => {
    if (failure) throw new Error('连接测试错误');
    return action === 'get' ? booking : { name: '小林', templateId: 'template-test', supportsReschedule: true };
  } };
  const source = require('node:fs').readFileSync(require.resolve('../miniprogram/pages/detail/index'), 'utf8');
  require('node:vm').runInNewContext(source, {
    Page: page => { definition = page; },
    require: name => name.endsWith('/api') ? api : time,
    Promise, clearTimeout, setTimeout
  });
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data),
    setData: patch => Object.assign(page.data, patch)
  });
  page.onLoad({ id: 'detail-test', token: 'invite-test' });
  await page.load();
  assert.equal(page.data.b.id, 'detail-test');
  assert.equal(page.data.b.statusText, '待对方确认');
  assert.equal(page.data.name, '小林');
  assert.equal(page.data.templateId, 'template-test');
  assert.equal(page.data.loading, false);
  failure = true;
  await page.load();
  assert.equal(page.data.b, null);
  assert.equal(page.data.error, '连接测试错误');
  assert.equal(page.data.loading, false);
  failure = false;
  await page.load();
  assert.equal(page.data.b.id, 'detail-test');
  assert.equal(page.data.error, '');
});
test('原生小程序演示支持双方确认、各自提醒和取消', async () => {
  const storage=new Map();global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value))};
  const demo=require('../miniprogram/utils/demo');
  const b=await demo.call('create',{title:'私人会面',name:'小林',location:'咖啡馆',note:'',startAt:Date.now()+2*86400000,endAt:Date.now()+2*86400000+3600000});
  await demo.call('enableReminder',{id:b.id});await demo.call('switchRole',{});
  assert.equal((await demo.call('get',{id:b.id})).role,'visitor');
  const confirmed=await demo.call('accept',{id:b.id,name:'小陈'});assert.equal(confirmed.status,'confirmed');
  await demo.call('enableReminder',{id:b.id});assert.equal((await demo.call('upcoming',{})).booking.id,b.id);
  const r=await demo.call('get',{id:b.id});assert.equal(r.otherReminderEnabled,true);
  await demo.call('cancel',{id:b.id});assert.equal((await demo.call('upcoming',{})).booking,null);
  delete global.wx;
});
test('原生演示改期需对方确认，并更新双方记录', async () => {
  const storage=new Map();global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value))};
  const demo=require('../miniprogram/utils/demo');
  const startAt=Date.now()+2*86400000,b=await demo.call('create',{title:'咨询交流',name:'小林',location:'线上',note:'',startAt,endAt:startAt+3600000});
  await demo.call('switchRole',{});await demo.call('accept',{id:b.id,name:'小陈'});await demo.call('switchRole',{});
  await demo.call('reschedule',{id:b.id,startAt:startAt+86400000,endAt:startAt+86400000+3600000});
  assert.equal((await demo.call('get',{id:b.id})).startAt,startAt);
  await demo.call('switchRole',{});const guest=await demo.call('get',{id:b.id});assert.equal(guest.canConfirmReschedule,true);
  await demo.call('acceptReschedule',{id:b.id});assert.equal((await demo.call('get',{id:b.id})).startAt,startAt+86400000);
  delete global.wx;
});
