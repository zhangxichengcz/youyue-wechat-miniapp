import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {makeApi,DAY} from '../free-backend/core.mjs';
import {makeReminderWorker,message} from '../free-backend/reminders.mjs';
import {signSession,verifySession,login} from '../free-backend/auth.mjs';
import worker from '../free-backend/worker.mjs';
test('网页单行粘贴脚本与源码均完整建立5张表和7条规则，可补齐现有表',()=>{
  const source=readFileSync(new URL('../free-backend/schema.sql',import.meta.url),'utf8');
  const consoleSql=readFileSync(new URL('../free-backend/schema-console.sql',import.meta.url),'utf8');
  assert.equal(consoleSql.includes('--'),false);
  const db=new DatabaseSync(':memory:');
  // 模拟用户当前已有5张表但没有触发器的状态。
  db.exec(source.slice(0,source.indexOf('CREATE TRIGGER')));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n,0);
  db.exec(consoleSql.replace(/\r?\n/g,' '));
  db.exec(consoleSql); // 重复执行不能删除数据或产生重复规则。
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,5);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n,7);
  const folded=new DatabaseSync(':memory:');folded.exec(source.replace(/\r?\n/g,' '));
  assert.equal(folded.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n,7);
});
function database(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../free-backend/schema.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){let args=[];const obj={bind(...values){args=values;return obj;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};return obj;},async batch(items){sqlite.exec('BEGIN');try{const result=[];for(const s of items)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  return {sqlite,DB};
}
function setup(){
  const {sqlite,DB}=database(),time={value:Date.parse('2026-10-14T10:00:00+08:00')};
  const env={DB,WX_APPID:'wx-test',WX_APP_SECRET:'test-only',SESSION_SECRET:'test-secret-at-least-32-characters-long',REMINDER_TEMPLATE_ID:'template-test'};
  const api=makeApi(env,{now:()=>time.value});
  const input={requestId:'request_unique_0001',title:'私人会面',name:'小林',location:'公园咖啡馆',note:'聊聊计划',startAt:time.value+2*DAY,endAt:time.value+2*DAY+3600000};
  const sends=[];const reminders=send=>makeReminderWorker(env,{now:()=>time.value,send:send|| (async data=>{sends.push(data);return {errcode:0};})});
  return {sqlite,env,api,time,input,sends,reminders};
}
async function confirmed(s){const b=await s.api('create',s.input,'alice');await s.api('accept',{id:b.id,token:b.token,name:'小陈'},'bob');return b;}
async function bothReminders(s,b){for(const uid of ['alice','bob'])await s.api('enableReminder',{id:b.id,accepted:true},uid);}
test('免费后台创建、确认、权限和防重使用实际 SQLite',async()=>{
  const s=setup(),b=await s.api('create',s.input,'alice');assert.equal(b.status,'pending');
  assert.equal((await s.api('create',s.input,'alice')).id,b.id);
  await assert.rejects(s.api('get',{id:b.id},'bob'),/无权/);
  const visitor=await s.api('get',{id:b.id,token:b.token},'bob');assert.equal(visitor.senderId,undefined);assert.equal(visitor.token,undefined);
  await s.api('accept',{id:b.id,token:b.token,name:'小陈'},'bob');
  await assert.rejects(s.api('accept',{id:b.id,token:b.token,name:'第三人'},'charlie'),/失效/);
  await assert.rejects(s.api('cancel',{id:b.id},'charlie'),/权限/);
  assert.equal((await s.api('list',{},'bob')).items.length,1);
});
test('并发领取邀请只有一位用户成功',async()=>{
  const s=setup(),b=await s.api('create',s.input,'alice');
  const r=await Promise.allSettled(['bob','charlie'].map(uid=>s.api('accept',{id:b.id,token:b.token,name:uid},uid)));
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
});
test('数据库触发器保护双方时间冲突，并在取消后释放时间',async()=>{
  const s=setup(),b=await confirmed(s);
  await assert.rejects(s.api('create',{...s.input,requestId:'request_unique_0002'},'alice'),/TIME_CONFLICT/);
  await assert.rejects(s.api('create',{...s.input,requestId:'request_unique_0002'},'bob'),/TIME_CONFLICT/);
  await s.api('cancel',{id:b.id},'bob');await s.api('create',{...s.input,requestId:'request_unique_0002'},'alice');
});
test('确认前开启提醒不会发送，确认后双方独立发送一次',async()=>{
  const s=setup(),b=await s.api('create',s.input,'alice');await s.api('enableReminder',{id:b.id,accepted:true},'alice');
  s.time.value+=DAY;await s.reminders()();assert.equal(s.sends.length,0);
  await s.api('accept',{id:b.id,token:b.token,name:'小陈'},'bob');await s.api('enableReminder',{id:b.id,accepted:true},'bob');
  await Promise.all([s.reminders()(),s.reminders()()]);await s.reminders()();
  assert.deepEqual(s.sends.map(m=>m.touser).sort(),['alice','bob']);
});
test('取消同步给双方并停止待发送提醒',async()=>{
  const s=setup(),b=await confirmed(s);await bothReminders(s,b);await s.api('cancel',{id:b.id},'alice');
  assert.equal((await s.api('get',{id:b.id},'bob')).status,'cancelled');s.time.value+=DAY;await s.reminders()();assert.equal(s.sends.length,0);
});
test('改期需要对方确认，确认前原预约与提醒有效',async()=>{
  const s=setup(),b=await confirmed(s);await bothReminders(s,b);
  const newStart=s.input.startAt+DAY;await s.api('reschedule',{id:b.id,startAt:newStart,endAt:newStart+3600000},'alice');
  const pending=await s.api('get',{id:b.id},'bob');assert.equal(pending.startAt,s.input.startAt);assert.equal(pending.canConfirmReschedule,true);
  await assert.rejects(s.api('acceptReschedule',{id:b.id},'alice'),/另一位/);
  await s.api('acceptReschedule',{id:b.id},'bob');
  const a=await s.api('get',{id:b.id},'alice');assert.equal(a.startAt,newStart);assert.equal(a.proposedStartAt,null);
  s.time.value+=DAY;await s.reminders()();assert.equal(s.sends.length,0);
  s.time.value+=DAY;await s.reminders()();assert.equal(s.sends.length,2);assert.equal(s.sends[0].data.time2.value,'2026-10-17 10:00');
});
test('改期被拒绝或撤回后仍保留旧时间',async()=>{
  const s=setup(),b=await confirmed(s),p={id:b.id,startAt:s.input.startAt+DAY,endAt:s.input.endAt+DAY};
  await s.api('reschedule',p,'alice');await s.api('rejectReschedule',{id:b.id},'bob');assert.equal((await s.api('get',{id:b.id},'alice')).startAt,s.input.startAt);
  await s.api('reschedule',p,'alice');await s.api('withdrawReschedule',{id:b.id},'alice');assert.equal((await s.api('get',{id:b.id},'alice')).proposedStartAt,null);
});
test('新时间与任一参与者日程冲突时不能确认，事务保留原时间',async()=>{
  const s=setup(),b=await confirmed(s),p={id:b.id,startAt:s.input.startAt+DAY,endAt:s.input.endAt+DAY};
  await s.api('create',{...s.input,requestId:'request_unique_0002',startAt:p.startAt,endAt:p.endAt},'bob');
  await s.api('reschedule',p,'alice');await assert.rejects(s.api('acceptReschedule',{id:b.id},'bob'),/TIME_CONFLICT/);
  assert.equal((await s.api('get',{id:b.id},'alice')).startAt,s.input.startAt);
});
test('旧提醒已发出，改期后需重新授权；未授权不重发',async()=>{
  const s=setup(),b=await confirmed(s);await bothReminders(s,b);s.time.value+=DAY;await s.reminders()();assert.equal(s.sends.length,2);
  await s.api('reschedule',{id:b.id,startAt:s.input.startAt+DAY,endAt:s.input.endAt+DAY},'alice');await s.api('acceptReschedule',{id:b.id},'bob');
  assert.equal((await s.api('get',{id:b.id},'alice')).reminderStatus,'none');s.time.value+=DAY;await s.reminders()();assert.equal(s.sends.length,2);
  await s.api('enableReminder',{id:b.id,accepted:true},'alice');await s.reminders()();assert.equal(s.sends.length,3);assert.equal(s.sends[2].touser,'alice');
});
test('开始不足一天时授权后尽快提醒，开始后不补发',async()=>{
  const s=setup(),b=await confirmed(s);s.time.value=s.input.startAt-3600000;await bothReminders(s,b);await s.reminders()();assert.equal(s.sends.length,2);
  const s2=setup(),b2=await confirmed(s2);await bothReminders(s2,b2);s2.time.value=s2.input.startAt;await s2.reminders()();assert.equal(s2.sends.length,0);
});
test('一方拒收不影响另一方，限流最多尝试三次',async()=>{
  const s=setup(),b=await confirmed(s);await bothReminders(s,b);s.time.value+=DAY;let calls=0;
  const run=s.reminders(async m=>{calls++;return {errcode:m.touser==='alice'?45009:43101};});
  await run();s.time.value+=61000;await run();s.time.value+=121000;await run();s.time.value+=3600000;await run();assert.equal(calls,4);
  assert.equal((await s.api('get',{id:b.id},'alice')).reminderStatus,'failed');
});
test('发送超时与崩溃锁标记结果不明，不自动重发',async()=>{
  const s=setup(),b=await confirmed(s);await bothReminders(s,b);s.time.value+=DAY;let calls=0;
  const run=s.reminders(async()=>{calls++;throw new Error('timeout');});await run();s.time.value+=3600000;await run();assert.equal(calls,2);
  assert.equal((await s.api('get',{id:b.id},'alice')).reminderStatus,'uncertain');
});
test('签名登录令牌不能伪造身份或使用过期令牌',async()=>{
  const secret='test-secret-at-least-32-characters-long',now=Date.now();const s=await signSession('alice',secret,now);
  assert.equal(await verifySession(s.token,secret,now),'alice');await assert.rejects(verifySession(s.token,secret,now+13*3600000),/失效/);
  await assert.rejects(verifySession(s.token.slice(0,-3)+'xyz',secret,now),/失效/);
});
test('微信登录仅返回短期令牌，不返回AppSecret或session_key',async()=>{
  const s=setup();let requested='';
  const r=await login('wx-login-code',s.env,{now:()=>s.time.value,fetcher:async url=>{requested=url;return new Response(JSON.stringify({openid:'alice',session_key:'private-session-key'}),{status:200});}});
  assert.equal(await verifySession(r.token,s.env.SESSION_SECRET,s.time.value),'alice');assert.equal(r.session_key,undefined);assert.equal(r.secret,undefined);assert.match(requested,/jscode2session/);
});
test('免费后台网络接口拒绝匿名调用，密钥不会返回客户端',async()=>{
  const s=setup();const r=await worker.fetch(new Request('https://example.test/api',{method:'POST',body:JSON.stringify({action:'profile'})}),s.env);
  assert.equal(r.status,401);const result=await r.json();assert.equal(result.code,'UNAUTHORIZED');assert.equal(result.WX_APP_SECRET,undefined);
});
test('旧版本操作不会覆盖已更新预约',async()=>{
  const s=setup(),b=await confirmed(s);await assert.rejects(s.api('cancel',{id:b.id,expectedVersion:b.version},'alice'),/已更新/);
});
test('自定义模板字段映射与北京时间正确',()=>{
  const m=message({id:'id',title:'活动',location:'地点',startAt:Date.parse('2026-10-14T23:30:00Z')},{userId:'alice'},{REMINDER_TEMPLATE_ID:'template',REMINDER_TITLE_FIELD:'thing7',REMINDER_TIME_FIELD:'time9',REMINDER_LOCATION_FIELD:'thing2'});
  assert.equal(m.data.time9.value,'2026-10-15 07:30');assert.equal(m.touser,'alice');assert.equal(m.template_id,'template');
});
test('HTTP接口使用签名身份，取消后另一位用户读取同一状态',async()=>{
  const s=setup(),b=await confirmed(s);
  const invoke=async(uid,action,payload)=>{
    const auth=await signSession(uid,s.env.SESSION_SECRET);
    return worker.fetch(new Request('https://example.test/api',{method:'POST',headers:{Authorization:'Bearer '+auth.token},body:JSON.stringify({action,payload})}),s.env);
  };
  const cancel=await invoke('alice','cancel',{id:b.id});assert.equal(cancel.status,200);
  const guest=await invoke('bob','get',{id:b.id});assert.equal((await guest.json()).data.status,'cancelled');
  const outsider=await invoke('charlie','get',{id:b.id});assert.equal(outsider.status,403);
});
test('实际微信请求组装：后台获取发送凭证，复用缓存并给双方分别发送',async()=>{
  const s=setup();s.env.WX_APPID='wx-token-flow';const b=await confirmed(s);await bothReminders(s,b);s.time.value+=DAY;
  let tokens=0;const outgoing=[];
  const run=makeReminderWorker(s.env,{now:()=>s.time.value,fetcher:async(url,options)=>{
    if(url.endsWith('/stable_token')){tokens++;const request=JSON.parse(options.body);assert.equal(request.appid,'wx-token-flow');return new Response(JSON.stringify({access_token:'test-only-token',expires_in:7200}));}
    assert.match(url,/subscribe\/send\?access_token=test-only-token$/);outgoing.push(JSON.parse(options.body));return new Response(JSON.stringify({errcode:0}));
  }});
  await run();assert.equal(tokens,1);assert.deepEqual(outgoing.map(m=>m.touser).sort(),['alice','bob']);
});
test('取得发送凭证前网络失败可重试，尚未提交提醒不会误标已发送',async()=>{
  const s=setup();s.env.WX_APPID='wx-token-failure';const b=await confirmed(s);await bothReminders(s,b);s.time.value+=DAY;
  const run=makeReminderWorker(s.env,{now:()=>s.time.value,fetcher:async()=>{throw new Error('network timeout');}});
  const result=await run();assert.equal(result.retried,2);assert.equal((await s.api('get',{id:b.id},'alice')).reminderStatus,'pending');
});
