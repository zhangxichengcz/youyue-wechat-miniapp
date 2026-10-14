'use strict';
const { AppError } = require('./domain');
const pad = n => String(n).padStart(2, '0');
function formatTime(ms) {
  const d = new Date(ms + 8 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function makeMessage(b, job, config) {
  const keys = config.fields;
  if (!config.templateId || !keys || !/^thing\d+$/.test(keys.title) || !/^time\d+$/.test(keys.time) || !/^thing\d+$/.test(keys.location) || new Set(Object.values(keys)).size !== 3) throw new AppError('微信模板 ID 或字段映射未正确配置', 'CONFIG');
  const cut = s => Array.from(s).slice(0, 20).join('');
  return { touser: job.recipientId, templateId: config.templateId, page: `pages/detail/index?id=${b._id}`, miniprogramState: config.state || 'formal', lang: 'zh_CN', data: { [keys.title]: { value: cut(b.title) }, [keys.time]: { value: formatTime(b.startAt) }, [keys.location]: { value: cut(b.location) } } };
}
function makeWorker({ repo, send, config, now = Date.now, owner = () => require('node:crypto').randomBytes(16).toString('hex') }) {
  async function finish(id, claim, status, extra = {}) {
    return repo.tx(async tx => {
      const job = await tx.get('reminder_jobs', id);
      if (!job || job.status !== 'dispatching' || job.claim !== claim) return;
      Object.assign(job, extra, { status, updatedAt: now() });
      await tx.set('reminder_jobs', id, job);
      const b = await tx.get('bookings', job.bookingId);
      if (b) { b.reminders[job.role].status = status; await tx.set('bookings', b._id, b); }
    });
  }
  return async function run() {
    // 无配置时保持队列不动，让维护者补齐模板后仍能正常发送。
    makeMessage({ _id: 'check', title: '配置校验', location: '地点', startAt: now() }, { recipientId: 'check' }, config);
    const result = { sent: 0, failed: 0, uncertain: 0, skipped: 0, retried: 0 };
    for (const stale of await repo.stale(now(), 20)) {
      await finish(stale._id, stale.claim, 'uncertain', { errorCode: 'STALE_DISPATCH' }); result.uncertain++;
    }
    for (const candidate of await repo.due(now(), 30)) {
      const claim = owner();
      const claimed = await repo.tx(async tx => {
        const job = await tx.get('reminder_jobs', candidate._id);
        if (!job || job.status !== 'pending' || job.dueAt > now()) return null;
        const b = await tx.get('bookings', job.bookingId);
        if (!b || b.status !== 'confirmed' || b.startAt <= now() || b.reminders[job.role].status !== 'pending') {
          job.status = b && b.startAt <= now() ? 'expired' : 'skipped';
          await tx.set('reminder_jobs', job._id, job);
          if (b && b.reminders[job.role].status === 'pending') { b.reminders[job.role].status = job.status; await tx.set('bookings', b._id, b); }
          result.skipped++; return null;
        }
        job.status = 'dispatching'; job.claim = claim; job.claimedAt = now(); job.attempts++;
        b.reminders[job.role].status = 'dispatching';
        await tx.set('reminder_jobs', job._id, job); await tx.set('bookings', b._id, b);
        return { job, b };
      });
      if (!claimed) continue;
      let delivery;
      try {
        // 发送前再次检查取消状态，降低取消与发送的竞态窗口。
        const latest = await repo.get('bookings', claimed.b._id);
        if (!latest || latest.status !== 'confirmed' || latest.startAt <= now()) { await finish(candidate._id, claim, 'skipped'); result.skipped++; continue; }
        delivery = await send(makeMessage(latest, claimed.job, config));
      } catch (error) {
        // 微信明确返回的失败码可分类；网络超时不能判断是否已送达。
        delivery = { errCode: error.errCode === undefined ? error.errcode : error.errCode };
      }
      const raw = delivery && (delivery.errCode === undefined ? delivery.errcode : delivery.errCode);
      const code = raw === undefined || raw === null ? null : Number(raw);
      if (code === 0) { await finish(candidate._id, claim, 'sent', { sentAt: now(), errorCode: 0 }); result.sent++; }
      else if ((code === 45009 || code === -1) && claimed.job.attempts < 3 && now() + 60000 < claimed.b.startAt) {
        await finish(candidate._id, claim, 'pending', { dueAt: now() + claimed.job.attempts * 60000, errorCode: code }); result.retried++;
      } else {
        const status = code === null || !Number.isFinite(code) ? 'uncertain' : 'failed';
        await finish(candidate._id, claim, status, { errorCode: code === null ? 'NETWORK_UNKNOWN' : code }); result[status]++;
      }
    }
    return result;
  };
}
module.exports = { makeWorker, makeMessage, formatTime };
