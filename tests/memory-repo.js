'use strict';
const clone = value => value === undefined ? null : structuredClone(value);
function memoryRepository() {
  let data = new Map(), tail = Promise.resolve();
  const key = (collection, id) => `${collection}/${id}`;
  const methods = source => ({
    async get(collection, id) { return clone(source.get(key(collection, id))); },
    async set(collection, id, value) { source.set(key(collection, id), clone(Object.assign({}, value, { _id: id }))); }
  });
  const repo = {
    async get(collection, id) { return methods(data).get(collection, id); },
    async set(collection, id, value) { return methods(data).set(collection, id, value); },
    tx(fn) {
      const run = tail.then(async () => {
        const draft = new Map(Array.from(data, ([k,v]) => [k, clone(v)]));
        const result = await fn(methods(draft)); data = draft; return result;
      });
      tail = run.catch(() => {}); return run;
    },
    async list(uid, offset, limit) { return Array.from(data.values()).filter(b => b.participants && b.participants.includes(uid)).sort((a,b) => b.createdAt - a.createdAt).slice(offset, offset + limit).map(clone); },
    async upcoming(uid, now) { return clone(Array.from(data.values()).filter(b => b.participants && b.participants.includes(uid) && b.status === 'confirmed' && b.startAt > now).sort((a,b) => a.startAt-b.startAt)[0]); },
    async due(now, limit) { return Array.from(data.entries()).filter(([k,v]) => k.startsWith('reminder_jobs/') && v.status === 'pending' && v.dueAt <= now).map(([,v]) => clone(v)).sort((a,b) => a.dueAt - b.dueAt).slice(0,limit); },
    async stale(now, limit) { return Array.from(data.entries()).filter(([k,v]) => k.startsWith('reminder_jobs/') && v.status === 'dispatching' && v.claimedAt < now - 300000).map(([,v]) => clone(v)).slice(0,limit); }
  };
  return repo;
}
module.exports = { memoryRepository };
