'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService, DAY } = require('../backend/domain');
const { makeWorker, makeMessage, formatTime } = require('../backend/reminders');
const { memoryRepository } = require('./memory-repo');
const config = { templateId: 'template', fields: { title:'thing1', time:'time2', location:'thing3' }, state:'trial' };
async function setup() {
  const repo = memoryRepository(), time = { value: Date.parse('2026-10-14T10:00:00+08:00') }, sent = [];
  const api = makeService({ repo, now: () => time.value, templateId: 'template', token: () => 'a'.repeat(48) });
  const b = await api('create', { requestId:'request_unique_0001', title:'咖啡小聚', name:'小林', location:'公园咖啡馆', startAt: time.value + 2 * DAY, endAt: time.value + 2 * DAY + 3600000 }, 'alice');
  await api('accept', { id:b.id, token:b.token, name:'小陈' },'bob');
  for (const uid of ['alice','bob']) await api('enableReminder', { id:b.id, accepted:true },uid);
  const worker = send => makeWorker({ repo, config, now: () => time.value, send: send || (async m => { sent.push(m); return {errCode:0}; }) });
  return { repo, api, b, time, sent, worker };
}
test('提前一天发送给双方，每个参与人只发送一次', async () => {
  const s = await setup(); await s.worker()(); assert.equal(s.sent.length,0);
  s.time.value += DAY;
  await s.worker()(); await s.worker()();
  assert.deepEqual(s.sent.map(m => m.touser).sort(),['alice','bob']);
  assert.equal(s.sent[0].data.time2.value,'2026-10-16 10:00');
  assert.equal(s.sent[0].miniprogramState,'trial');
});
test('定时器重叠执行不会重复领取相同消息', async () => {
  const s = await setup(); s.time.value += DAY;
  await Promise.all([s.worker()(),s.worker()()]); assert.equal(s.sent.length,2);
});
test('取消后不发送提醒', async () => {
  const s = await setup(); await s.api('cancel',{id:s.b.id},'alice'); s.time.value += DAY;
  await s.worker()(); assert.equal(s.sent.length,0);
});
test('开始时间已过，不补发过期提醒', async () => {
  const s = await setup(); s.time.value += 2 * DAY;
  await s.worker()(); assert.equal(s.sent.length,0);
  assert.equal((await s.repo.get('reminder_jobs',`${s.b.id}_sender`)).status,'expired');
});
test('一方拒收失败不会阻止另一方正常发送', async () => {
  const s = await setup(); s.time.value += DAY;
  const calls = [];
  await s.worker(async m => { calls.push(m.touser); return {errCode:m.touser === 'alice' ? 43101 : 0}; })();
  assert.equal(calls.length,2); assert.equal((await s.repo.get('bookings',s.b.id)).reminders.sender.status,'failed');
  assert.equal((await s.repo.get('bookings',s.b.id)).reminders.recipient.status,'sent');
});
test('微信明确限流失败可重试，成功的另一方不会重发', async () => {
  const s = await setup(); s.time.value += DAY; let attempts = 0;
  const run = s.worker(async m => { if(m.touser === 'alice' && attempts++ === 0) return {errCode:45009}; s.sent.push(m); return {errCode:0}; });
  await run(); s.time.value += 61000; await run();
  assert.equal(s.sent.length,2); assert.equal(attempts,2);
});
test('网络超时结果不明时禁止自动重复发送', async () => {
  const s = await setup(); s.time.value += DAY; let attempts = 0;
  const run = s.worker(async () => { attempts++; throw new Error('timeout'); });
  await run(); s.time.value += 3600000; await run(); assert.equal(attempts,2);
  assert.equal((await s.repo.get('bookings',s.b.id)).reminders.sender.status,'uncertain');
});
test('崩溃遗留的发送锁转为待核实，不盲目重发', async () => {
  const s = await setup(); s.time.value += DAY;
  const job = await s.repo.get('reminder_jobs',`${s.b.id}_sender`);
  Object.assign(job,{status:'dispatching',claim:'crashed',claimedAt:s.time.value-360000});
  await s.repo.set('reminder_jobs',job._id,job); await s.worker()();
  assert.equal(s.sent.length,1); assert.equal((await s.repo.get('reminder_jobs',job._id)).status,'uncertain');
});
test('失败后重新授权会恢复队列，已发送方状态不受影响', async () => {
  const s = await setup(); s.time.value += DAY;
  await s.worker(async m => ({errCode:m.touser === 'alice' ? 43101 : 0}))();
  await s.api('enableReminder',{id:s.b.id,accepted:true},'alice'); await s.worker()();
  assert.equal(s.sent.length,1); assert.equal(s.sent[0].touser,'alice');
});
test('模板字段按后台配置映射，北京时间不依赖服务器时区', () => {
  assert.equal(formatTime(Date.parse('2026-10-14T23:30:00Z')),'2026-10-15 07:30');
  const b = {_id:'id', title:'🟢'.repeat(20), location:'地点'.repeat(30), startAt:Date.now()};
  const m = makeMessage(b,{recipientId:'alice'},{...config, fields:{title:'thing7',time:'time9',location:'thing2'}});
  assert.equal(Array.from(m.data.thing7.value).length,20); assert.equal(Array.from(m.data.thing2.value).length,20);
  assert.throws(() => makeMessage(b,{recipientId:'alice'},{...config,fields:{title:'name1',time:'time2',location:'thing3'}}),/未正确配置/);
});
