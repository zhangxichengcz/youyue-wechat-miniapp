'use strict';
const cloud = require('wx-server-sdk');
const cloudbase = require('@cloudbase/node-sdk');
const { makeRepository } = require('./lib/repository');
const { makeWorker } = require('./lib/reminders');
const { configuration } = require('./lib/config');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const database = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV }).database();
exports.main = async () => {
  // 定时任务不可由客户端手工触发；不会依据 event 里伪造的 Type 来判断。
  if (cloud.getWXContext().OPENID) throw new Error('仅允许云端定时调用');
  const run = makeWorker({ repo: makeRepository(database), config: configuration(), send: data => cloud.openapi.subscribeMessage.send(data) });
  const summary = await run(); console.log('REMINDER_SUMMARY', summary); return summary;
};
