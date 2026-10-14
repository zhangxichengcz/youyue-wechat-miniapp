'use strict';
const cloud = require('wx-server-sdk');
const cloudbase = require('@cloudbase/node-sdk');
const { makeRepository } = require('./lib/repository');
const { makeService, AppError } = require('./lib/domain');
const { configuration } = require('./lib/config');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const database = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV }).database();
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  try {
    const service = makeService({ repo: makeRepository(database), templateId: configuration().templateId });
    return { ok: true, data: await service(event.action, event.payload || {}, OPENID) };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: error.code, message: error.message };
    console.error('APPOINTMENT_API_ERROR', error.code || error.errCode || 'UNKNOWN');
    return { ok: false, code: 'SERVICE_ERROR', message: '服务暂时不可用，请稍后重试' };
  }
};
