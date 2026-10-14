const pad = n => String(n).padStart(2, '0');
function dateKey(ms) {
  const d = new Date(ms + 8 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function format(ms) {
  const d = new Date(ms + 8 * 3600000);
  return `${dateKey(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function parse(date, time) { return new Date(`${date}T${time}:00+08:00`).getTime(); }
const statusText = { pending: '待对方确认', confirmed: '预约成功', cancelled: '已取消', declined: '对方已婉拒', expired: '邀请已过期', completed: '活动已结束' };
const reminderText = { none: '尚未开启', pending: '已开启，等待提醒', dispatching: '正在发送', sent: '提醒已发送', failed: '发送失败，请重新开启', uncertain: '发送结果待核实', skipped: '已停止', expired: '已错过提醒时间' };
function decorate(b) {
  const now = Date.now();
  const status = b.status === 'pending' && b.startAt <= now ? 'expired' : b.status === 'confirmed' && b.endAt <= now ? 'completed' : b.status;
  return Object.assign({}, b, { status, statusText: statusText[status], startText: format(b.startAt), endText: format(b.endAt), proposedStartText: b.proposedStartAt ? format(b.proposedStartAt) : '', proposedEndText: b.proposedEndAt ? format(b.proposedEndAt) : '', reminderText: reminderText[b.reminderStatus || 'none'], canAct: b.startAt > now && ['pending', 'confirmed'].includes(status) });
}
module.exports = { dateKey, format, parse, decorate };
