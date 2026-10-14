'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService, DAY } = require('../backend/domain');
const { memoryRepository } = require('./memory-repo');
function setup() {
  const repo = memoryRepository(), time = { value: Date.parse('2026-10-14T10:00:00+08:00') };
  return { repo, time, api: makeService({ repo, now: () => time.value, templateId: 'template', token: () => 'a'.repeat(48) }), input: { requestId: 'request_unique_0001', title: '咨询交流', name: '小林', location: '线上视频', note: '聊聊近期计划', startAt: time.value + 2 * DAY, endAt: time.value + 2 * DAY + 3600000 } };
}
test('预约需要对方确认，响应不泄露 OpenID 和邀请令牌', async () => {
  const { api, input } = setup();
  const invite = await api('create', input, 'alice');
  assert.equal(invite.status, 'pending');
  const guestView = await api('get', { id: invite.id, token: invite.token }, 'bob');
  assert.equal(guestView.role, 'visitor'); assert.equal(guestView.token, undefined); assert.equal(guestView.senderId, undefined);
  const confirmed = await api('accept', { id: invite.id, token: invite.token, name: '小陈' }, 'bob');
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.role, 'recipient');
  await assert.rejects(api('get', { id: invite.id, token: invite.token }, 'charlie'), /无权/);
  assert.equal((await api('list', {}, 'bob')).items.length, 1);
});
test('网络重试不会重复创建预约', async () => {
  const { api, input } = setup();
  const [a,b] = await Promise.all([api('create', input, 'alice'), api('create', input, 'alice')]);
  assert.equal(a.id,b.id); assert.equal((await api('list', {}, 'alice')).items.length, 1);
});
test('并发领取邀请时只有一个受邀人成功', async () => {
  const { api, input } = setup(); const b = await api('create', input, 'alice');
  const results = await Promise.allSettled(['bob', 'charlie'].map(uid => api('accept', { id: b.id, token: b.token, name: uid }, uid)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
});
test('发起人不能接受自己邀请，陌生人不能取消或订阅', async () => {
  const { api, input } = setup(); const b = await api('create', input, 'alice');
  await assert.rejects(api('accept', { id: b.id, name: '自己', token: b.token }, 'alice'), /自己/);
  await assert.rejects(api('cancel', { id: b.id }, 'mallory'), /权限/);
  await assert.rejects(api('enableReminder', { id: b.id, accepted: true, recipientId: 'alice' }, 'mallory'), /权限/);
  await assert.rejects(api('profile', {}, ''), /微信/);
});
test('无令牌不能读取或领取邀请', async () => {
  const { api, input } = setup(); const b = await api('create', input, 'alice');
  await assert.rejects(api('get', { id: b.id }, 'bob'), /无权/);
  await assert.rejects(api('accept', { id: b.id, name: '小陈' }, 'bob'), /无效/);
});
test('校验开始时间、时长、180天上限和模板长度', async () => {
  const { api, input, time } = setup();
  for (const changes of [{ startAt: time.value }, { endAt: input.startAt }, { startAt: input.startAt + 0.5 }, { title: '长'.repeat(21) }, { startAt: time.value + 181 * DAY }, { endAt: input.startAt + 9 * 3600000 }]) await assert.rejects(api('create', { ...input, ...changes }, 'alice'));
});
test('双方都检查时间冲突，失败的接受不改变邀请', async () => {
  const { api, input, repo } = setup(); const a = await api('create', input, 'alice');
  await assert.rejects(api('create', { ...input, requestId: 'request_unique_0002' }, 'alice'), /已有预约/);
  await api('create', input, 'bob');
  await assert.rejects(api('accept', { id: a.id, token: a.token, name: '小陈' }, 'bob'), /已有预约/);
  assert.equal((await repo.get('bookings',a.id)).status,'pending');
});
test('相邻时间不冲突，取消会释放双方时间', async () => {
  const { api, input } = setup(); const a = await api('create', input, 'alice');
  await api('accept', { id: a.id, token: a.token, name: '小陈' }, 'bob');
  await api('create', { ...input, requestId: 'request_unique_0002', startAt: input.endAt, endAt: input.endAt + 3600000 }, 'alice');
  await api('cancel', { id: a.id }, 'bob');
  await api('create', { ...input, requestId: 'request_unique_0003' }, 'alice');
  await api('create', { ...input, requestId: 'request_unique_0003' }, 'bob');
});
test('婉拒关闭邀请并释放发起人时间', async () => {
  const { api, input } = setup(); const a = await api('create', input, 'alice');
  await api('decline', { id: a.id, token: a.token }, 'bob');
  assert.equal((await api('get', { id: a.id }, 'alice')).status, 'declined');
  await api('create', { ...input, requestId: 'request_unique_0002' }, 'alice');
});
test('活动开始后邀请不能接受，状态显示过期', async () => {
  const { api, input, time } = setup(); const b = await api('create', input, 'alice'); time.value = input.startAt;
  await assert.rejects(api('accept', { id: b.id, token: b.token, name: '小陈' }, 'bob'), /失效/);
  assert.equal((await api('get', { id: b.id }, 'alice')).status,'expired');
});
test('提前授权的发起人只在对方确认后入提醒队列，双方各一条', async () => {
  const { api, input, repo } = setup(); const b = await api('create', input, 'alice');
  await assert.rejects(api('enableReminder', { id: b.id }, 'alice'), /同意/);
  await api('enableReminder', { id: b.id, accepted: true }, 'alice');
  assert.equal(await repo.get('reminder_jobs',`${b.id}_sender`),null);
  await api('accept', { id: b.id, token: b.token, name: '小陈' }, 'bob');
  await api('enableReminder', { id: b.id, accepted: true }, 'bob');
  assert.equal((await repo.get('reminder_jobs',`${b.id}_sender`)).dueAt, input.startAt - DAY);
  assert.equal((await repo.get('reminder_jobs',`${b.id}_recipient`)).recipientId, 'bob');
});
test('不足24小时的确认在授权后立即进入待发送队列', async () => {
  const { api, input, time, repo } = setup(); const b = await api('create', input, 'alice');
  time.value = input.startAt - 3600000;
  await api('accept', { id: b.id, token: b.token, name: '小陈' }, 'bob');
  await api('enableReminder', { id: b.id, accepted: true }, 'bob');
  assert.equal((await repo.get('reminder_jobs',`${b.id}_recipient`)).dueAt,time.value);
});
test('服务端未配置模板时不能误报提醒已开启', async () => {
  const { repo, input } = setup(); const api = makeService({ repo, now: () => input.startAt - 2 * DAY });
  const b = await api('create', input, 'alice');
  await assert.rejects(api('enableReminder', { id: b.id, accepted: true }, 'alice'), /未配置/);
});
test('首页查询下一次预约按开始时间排序，只返回参与者已确认预约', async () => {
  const { api, input } = setup(); const early=await api('create',input,'alice');
  await api('accept',{id:early.id,token:early.token,name:'小陈'},'bob');
  const later=await api('create',{...input,requestId:'request_unique_0002',startAt:input.startAt+DAY,endAt:input.endAt+DAY},'alice');
  await api('accept',{id:later.id,token:later.token,name:'小陈'},'bob');
  assert.equal((await api('upcoming',{},'alice')).booking.id,early.id);
  assert.equal((await api('upcoming',{},'mallory')).booking,null);
});
