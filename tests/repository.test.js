'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRepository } = require('../backend/repository');
test('CloudBase 适配正确处理数组响应、缺失文档和数据库错误', async () => {
  let response = {data:[{_id:'one',name:'小林'}]};
  const db = { collection: () => ({ doc: () => ({get:async()=>response}) }) };
  const repo = makeRepository(db);
  assert.equal((await repo.get('profiles','one')).name,'小林');
  response={data:[]};assert.equal(await repo.get('profiles','missing'),null);
  response={code:'PERMISSION_DENIED',message:'拒绝访问'};
  await assert.rejects(repo.get('profiles','one'),/拒绝访问/);
});
test('CloudBase 事务使用单文档读写、原始 set 格式和返回值解包', async () => {
  const records=new Map();
  const tx={collection:collection=>({doc:id=>({
    get:async()=>({data:records.has(`${collection}/${id}`)?{...records.get(`${collection}/${id}`),_id:id}:null}),
    set:async value=>{assert.equal(value._id,undefined);assert.equal(value.data,undefined);records.set(`${collection}/${id}`,value);return {updated:1};}
  })})};
  const repo=makeRepository({runTransaction:async fn=>({result:await fn(tx),errMsg:'ok'})});
  const result=await repo.tx(async t=>{await t.set('bookings','one',{_id:'one',status:'pending'});return t.get('bookings','one');});
  assert.equal(result.status,'pending');assert.equal(result._id,'one');
});
