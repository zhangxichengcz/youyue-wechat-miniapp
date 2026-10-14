// 仅用于本机体验：不会调用微信消息接口，也不能跨设备分享真实预约。
const KEY = 'youyue-demo-v1';
const { decorate } = require('./time');
function store() { return wx.getStorageSync(KEY) || { role: 'sender', bookings: [], names: { sender: '', guest: '' } }; }
function save(s) { wx.setStorageSync(KEY, s); }
function view(b, s) {
  const participant = b.senderId === s.role || b.recipientId === s.role;
  return decorate(Object.assign({}, b, { role: b.senderId === s.role ? 'sender' : participant ? 'recipient' : 'visitor', reminderStatus: b.reminders[s.role] || 'none', otherReminderEnabled: participant && b.reminders[s.role === 'sender' ? 'guest' : 'sender'] !== 'none', canReschedule: participant && ['pending','confirmed'].includes(b.status) && b.startAt > Date.now(), canConfirmReschedule: participant && b.proposerId && b.proposerId !== s.role ? true : false }));
}
async function call(action, p) {
  const s = store();
  if (action === 'switchRole') { s.role = s.role === 'sender' ? 'guest' : 'sender'; save(s); return {}; }
  if (action === 'profile') return { name: s.names[s.role], templateId: 'DEMO', demoRole: s.role, supportsReschedule: true };
  if (action === 'upcoming') { const b = s.bookings.filter(b => (b.senderId === s.role || b.recipientId === s.role) && b.status === 'confirmed' && b.startAt > Date.now()).sort((a,b) => a.startAt - b.startAt)[0]; return { booking: b ? view(b,s) : null }; }
  if (action === 'list') return { items: s.bookings.filter(b => b.senderId === s.role || b.recipientId === s.role).map(b => view(b, s)), hasMore: false };
  if (action === 'create') {
    if (p.startAt < Date.now() + 600000) throw new Error('开始时间至少在 10 分钟之后');
    if (s.bookings.some(b => b.senderId === s.role && ['pending', 'confirmed'].includes(b.status) && b.startAt < p.endAt && b.endAt > p.startAt)) throw new Error('这个时间已有预约，请换个时间');
    const b = Object.assign({}, p, { id: `demo-${Date.now()}`, token: 'demo-invitation', senderId: s.role, senderName: p.name, recipientName: '', recipientId: '', status: 'pending', reminders: { sender: 'none', guest: 'none' } });
    s.names[s.role] = p.name; s.bookings.unshift(b); save(s); return view(b, s);
  }
  const b = s.bookings.find(x => x.id === p.id);
  if (!b) throw new Error('演示预约不存在，请先在本机创建');
  if (action === 'get') return view(b, s);
  if (action === 'accept') {
    if (b.senderId === s.role) throw new Error('请切换为对方体验');
    if (b.status !== 'pending' || b.startAt <= Date.now()) throw new Error('这份邀请已失效');
    b.status = 'confirmed'; b.recipientId = s.role; b.recipientName = p.name; s.names[s.role] = p.name;
  } else if (action === 'decline') { if (b.status !== 'pending') throw new Error('邀请已处理'); b.status = 'declined'; }
  else if (action === 'cancel') b.status = 'cancelled';
  else if (action === 'enableReminder') b.reminders[s.role] = 'pending';
  else if (action === 'reschedule') {
    if (b.senderId !== s.role && b.recipientId !== s.role) throw new Error('没有权限');
    if (p.startAt < Date.now() + 600000) throw new Error('开始时间至少在10分钟之后');
    if (b.status === 'pending') { b.startAt = p.startAt; b.endAt = p.endAt; }
    else if (b.status === 'confirmed') { if (b.proposerId) throw new Error('已有改期申请，请先处理'); b.proposedStartAt = p.startAt; b.proposedEndAt = p.endAt; b.proposerId = s.role; }
    else throw new Error('预约已失效');
  } else if (action === 'acceptReschedule') {
    if (!b.proposerId || b.proposerId === s.role) throw new Error('不能确认自己的改期申请');
    b.startAt = b.proposedStartAt; b.endAt = b.proposedEndAt; b.proposedStartAt = null; b.proposedEndAt = null; b.proposerId = null;
  } else if (action === 'rejectReschedule' || action === 'withdrawReschedule') { b.proposedStartAt = null; b.proposedEndAt = null; b.proposerId = null; }
  else throw new Error('未知操作');
  save(s); return view(b, s);
}
module.exports = { call };
