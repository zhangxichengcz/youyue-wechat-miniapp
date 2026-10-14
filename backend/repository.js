'use strict';
// @cloudbase/node-sdk 的 set/update 接收文档本身，不使用客户端 { data } 包装。
function makeRepository(db) {
  function checked(response) {
    if (response && response.code) { const e = new Error(response.message || '数据库操作失败'); e.code = response.code; throw e; }
    return response;
  }
  const adapter = source => ({
    async get(collection, id) {
      const response = checked(await source.collection(collection).doc(id).get());
      const data = response.data;
      return Array.isArray(data) ? data[0] || null : data || null;
    },
    async set(collection, id, value) {
      const doc = Object.assign({}, value); delete doc._id;
      return checked(await source.collection(collection).doc(id).set(doc));
    }
  });
  const base = adapter(db);
  return Object.assign(base, {
    async tx(fn) {
      const result = checked(await db.runTransaction(transaction => fn(adapter(transaction))));
      return result && Object.prototype.hasOwnProperty.call(result, 'result') ? result.result : result;
    },
    async list(uid, offset, limit) {
      const r = checked(await db.collection('bookings').where({ participants: uid }).orderBy('createdAt', 'desc').skip(offset).limit(limit).get()); return r.data;
    },
    async upcoming(uid, now) {
      const r = checked(await db.collection('bookings').where({ participants: uid, status: 'confirmed', startAt: db.command.gt(now) }).orderBy('startAt', 'asc').limit(1).get()); return r.data[0] || null;
    },
    async due(now, limit = 40) {
      const r = checked(await db.collection('reminder_jobs').where({ status: 'pending', dueAt: db.command.lte(now) }).orderBy('dueAt', 'asc').limit(limit).get()); return r.data;
    },
    async stale(now, limit = 40) {
      const r = checked(await db.collection('reminder_jobs').where({ status: 'dispatching', claimedAt: db.command.lt(now - 300000) }).orderBy('claimedAt', 'asc').limit(limit).get()); return r.data;
    }
  });
}
module.exports = { makeRepository };
