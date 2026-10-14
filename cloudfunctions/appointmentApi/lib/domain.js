'use strict';
const crypto = require('node:crypto');
const DAY = 86400000;
class AppError extends Error { constructor(message, code = 'INVALID') { super(message); this.code = code; } }
function ensure(ok, message, code) { if (!ok) throw new AppError(message, code); }
function text(value, max, required = true) {
  ensure(typeof value === 'string', '请填写有效的文字内容');
  const s = value.trim(); ensure((!required || s.length > 0) && Array.from(s).length <= max, `文字长度需为${required ? '1' : '0'}～${max}字`); return s;
}
function validateInput(p, now) {
  const title = text(p.title, 20), name = text(p.name, 20), location = text(p.location, 80), note = text(p.note || '', 200, false);
  ensure(Number.isSafeInteger(p.startAt) && Number.isSafeInteger(p.endAt), '请选择有效时间');
  ensure(p.startAt >= now + 600000 && p.startAt <= now + 180 * DAY, '请选择 10 分钟后、180 天内的开始时间');
  const duration = p.endAt - p.startAt;
  ensure(duration >= 900000 && duration <= 8 * 3600000 && duration % 60000 === 0, '活动时长需为 15 分钟～8 小时');
  return { title, name, location, note, startAt: p.startAt, endAt: p.endAt };
}
function roleOf(b, uid) { return b.senderId === uid ? 'sender' : b.recipientId === uid ? 'recipient' : 'visitor'; }
function canView(b, uid, token) { return roleOf(b, uid) !== 'visitor' || (b.status === 'pending' && typeof token === 'string' && token.length === 48 && token === b.token); }
function assertParticipant(b, uid) { ensure(roleOf(b, uid) !== 'visitor', '你没有权限操作这份预约', 'FORBIDDEN'); }
function assertInvite(b, uid, token, now) {
  ensure(canView(b, uid, token), '邀请无效或已被领取', 'FORBIDDEN');
  ensure(b.senderId !== uid, '不能接受自己发起的邀请');
  ensure(b.status === 'pending' && b.startAt > now, '这份邀请已失效');
}
function publicView(b, uid, now) {
  const role = roleOf(b, uid), participant = role !== 'visitor';
  let status = b.status;
  if (status === 'pending' && b.startAt <= now) status = 'expired';
  if (status === 'confirmed' && b.endAt <= now) status = 'completed';
  const result = { id: b._id, title: b.title, startAt: b.startAt, endAt: b.endAt, location: b.location, note: b.note, senderName: b.senderName, recipientName: b.recipientName || '', status, role, reminderStatus: participant ? b.reminders[role].status : 'none', otherReminderEnabled: participant && ['pending', 'dispatching', 'sent', 'uncertain'].includes(b.reminders[role === 'sender' ? 'recipient' : 'sender'].status) };
  if (role === 'sender' && b.status === 'pending' && b.startAt > now) result.token = b.token;
  return result;
}
function reserve(calendar, b, now) {
  const slots = (calendar && calendar.slots || []).filter(s => s.endAt > now && s.id !== b._id);
  ensure(slots.length < 100, '未结束的预约过多，请先取消不需要的预约');
  ensure(!slots.some(s => s.startAt < b.endAt && s.endAt > b.startAt), '这个时间已有预约，请换个时间', 'CONFLICT');
  slots.push({ id: b._id, startAt: b.startAt, endAt: b.endAt }); return { slots };
}
function release(calendar, id, now) { return { slots: (calendar && calendar.slots || []).filter(s => s.endAt > now && s.id !== id) }; }
function newReminder() { return { status: 'none', attempts: 0 }; }
function makeService({ repo, now = Date.now, token = () => crypto.randomBytes(24).toString('hex'), templateId = '' }) {
  function bookingId(p) { ensure(typeof p.id === 'string' && /^[a-f0-9]{32}$/.test(p.id), '预约编号无效'); return p.id; }
  return async function service(action, p = {}, uid) {
    ensure(typeof uid === 'string' && uid.length > 0, '请从微信小程序内访问', 'UNAUTHORIZED');
    const timestamp = now();
    if (action === 'profile') {
      const profile = await repo.get('profiles', uid); return { name: profile && profile.name || '', templateId };
    }
    if (action === 'upcoming') {
      const b = await repo.upcoming(uid, timestamp);
      return { booking: b ? publicView(b, uid, timestamp) : null };
    }
    if (action === 'list') {
      const offset = Number.isSafeInteger(p.offset) && p.offset >= 0 ? p.offset : 0;
      ensure(offset <= 10000, '记录页码无效');
      const items = await repo.list(uid, offset, 21);
      return { items: items.slice(0, 20).map(b => publicView(b, uid, timestamp)), hasMore: items.length > 20 };
    }
    if (action === 'create') {
      const input = validateInput(p, timestamp);
      ensure(typeof p.requestId === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(p.requestId), '请重新提交预约');
      // 网络重试复用同一编号，避免重复创建。
      const bid = crypto.createHash('sha256').update(`${uid}:${p.requestId}`).digest('hex').slice(0, 32);
      return repo.tx(async tx => {
        const existing = await tx.get('bookings', bid);
        if (existing) return publicView(existing, uid, timestamp);
        const b = { _id: bid, title: input.title, location: input.location, note: input.note, startAt: input.startAt, endAt: input.endAt, senderId: uid, senderName: input.name, recipientId: '', recipientName: '', participants: [uid], token: token(), status: 'pending', createdAt: timestamp, remindAt: input.startAt - DAY, reminders: { sender: newReminder(), recipient: newReminder() } };
        const calendar = await tx.get('calendars', uid);
        await tx.set('calendars', uid, reserve(calendar, b, timestamp));
        await tx.set('profiles', uid, { name: input.name });
        await tx.set('bookings', bid, b);
        return publicView(b, uid, timestamp);
      });
    }
    const bid = bookingId(p);
    if (action === 'get') {
      const b = await repo.get('bookings', bid); ensure(b && canView(b, uid, p.token), '邀请无效或你无权查看', 'FORBIDDEN'); return publicView(b, uid, timestamp);
    }
    ensure(['accept', 'decline', 'cancel', 'enableReminder'].includes(action), '未知操作');
    return repo.tx(async tx => {
      const b = await tx.get('bookings', bid); ensure(b, '预约不存在', 'NOT_FOUND');
      if (action === 'accept') {
        if (b.status === 'confirmed' && b.recipientId === uid) return publicView(b, uid, timestamp);
        assertInvite(b, uid, p.token, timestamp);
        const name = text(p.name, 20);
        await tx.set('calendars', uid, reserve(await tx.get('calendars', uid), b, timestamp));
        await tx.set('profiles', uid, { name });
        b.recipientId = uid; b.recipientName = name; b.participants.push(uid); b.status = 'confirmed'; b.confirmedAt = timestamp;
        for (const role of ['sender', 'recipient']) {
          if (b.reminders[role].status === 'pending') await enqueue(tx, b, role, timestamp);
        }
      } else if (action === 'decline' || action === 'cancel') {
        if (action === 'decline') assertInvite(b, uid, p.token, timestamp);
        else { assertParticipant(b, uid); ensure(['pending', 'confirmed'].includes(b.status) && b.startAt > timestamp, '预约已结束或已经取消'); }
        b.status = action === 'decline' ? 'declined' : 'cancelled'; b.closedAt = timestamp;
        for (const userId of b.participants) await tx.set('calendars', userId, release(await tx.get('calendars', userId), bid, timestamp));
        for (const role of ['sender', 'recipient']) {
          const job = await tx.get('reminder_jobs', `${bid}_${role}`);
          if (job && job.status === 'pending') { job.status = 'skipped'; await tx.set('reminder_jobs', job._id, job); }
          if (b.reminders[role].status === 'pending') b.reminders[role].status = 'skipped';
        }
      } else {
        assertParticipant(b, uid); ensure(['pending', 'confirmed'].includes(b.status) && b.startAt > timestamp, '预约已失效');
        ensure(templateId, '尚未配置微信订阅消息模板');
        ensure(p.accepted === true, '请先同意微信订阅提醒');
        const role = roleOf(b, uid), r = b.reminders[role];
        if (['sent', 'dispatching', 'uncertain', 'pending'].includes(r.status)) return publicView(b, uid, timestamp);
        r.status = 'pending'; r.authorizedAt = timestamp;
        if (b.status === 'confirmed') await enqueue(tx, b, role, timestamp);
      }
      await tx.set('bookings', bid, b);
      // 婉拒者不会成为预约参与人，响应只给处理结果。
      return action === 'decline' ? { id: bid, status: 'declined' } : publicView(b, uid, timestamp);
    });
  };
}
async function enqueue(tx, b, role, now) {
  const jobId = `${b._id}_${role}`;
  const old = await tx.get('reminder_jobs', jobId);
  if (old && ['sent', 'dispatching', 'uncertain'].includes(old.status)) return;
  const job = { _id: jobId, bookingId: b._id, role, recipientId: role === 'sender' ? b.senderId : b.recipientId, status: 'pending', dueAt: Math.max(b.remindAt, now), startAt: b.startAt, attempts: 0, createdAt: now };
  await tx.set('reminder_jobs', jobId, job);
}
module.exports = { makeService, AppError, validateInput, publicView, reserve, release, DAY };
