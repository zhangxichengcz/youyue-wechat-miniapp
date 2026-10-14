const api = require('../../utils/api');
const { decorate } = require('../../utils/time');
Page({
  data: { demo: api.demoMode, b: null, loading: true, busy: false, error: '', name: '', templateId: '', handled: false, supportsReschedule: false },
  onLoad(options) { this.bookingId = options.id; this.inviteToken = options.token || ''; },
  onShow() { this.active = true; this.load(); },
  onHide() { this.active = false; clearTimeout(this.pollTimer); },
  onUnload() { this.active = false; clearTimeout(this.pollTimer); },
  poll() {
    clearTimeout(this.pollTimer);
    if (this.active && !api.demoMode && this.data.b && this.data.b.role !== 'visitor' && this.data.b.canAct) {
      this.pollTimer = setTimeout(() => this.load(true), 15000);
    }
  },
  async load(quiet = false) {
    if (this.data.handled || this.fetching) return;
    if (this.data.busy) { this.poll(); return; }
    this.fetching = true;
    if (!quiet) this.setData({ loading: true, error: '' });
    try {
      const results = await Promise.all([api.call('get', { id: this.bookingId, token: this.inviteToken }), api.call('profile')]);
      const b = results[0], profile = results[1];
      const update = { b: decorate(b), templateId: profile.templateId, supportsReschedule: !!profile.supportsReschedule };
      if (!quiet) update.name = profile.name || '';
      this.setData(update);
    } catch (err) { if (!quiet) this.setData({ error: err.message, b: null }); }
    finally { this.fetching = false; if (!quiet) this.setData({ loading: false }); this.poll(); }
  },
  inputName(e) { this.setData({ name: e.detail.value }); },
  retry() { this.load(); },
  async accept() {
    if (!this.data.name.trim()) { api.showError(new Error('请填写你的称呼')); return; }
    await this.run('accept', { name: this.data.name.trim(), token: this.inviteToken });
  },
  async run(action, payload = {}) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const b = await api.call(action, Object.assign({ id: this.bookingId, expectedVersion: this.data.b.version }, payload));
      if (action === 'decline') this.setData({ handled: true, b: null });
      else this.setData({ b: decorate(b) });
    } catch (err) { api.showError(err); }
    finally { this.setData({ busy: false }); this.poll(); }
  },
  cancel() { wx.showModal({ title: '取消这次预约？', content: '取消后会释放双方时间，停止尚未发送的提醒。', confirmText: '取消预约', confirmColor: '#a35648', success: r => { if (r.confirm) this.run('cancel'); } }); },
  decline() { wx.showModal({ title: '婉拒这次邀请？', content: '这份邀请将关闭，你可以与对方另约时间。', confirmText: '婉拒邀请', success: r => { if (r.confirm) this.run('decline', { token: this.inviteToken }); } }); },
  async enableReminder() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      // 在用户点击时直接请求授权，不在加载页面或定时回调中请求。
      const accepted = await api.subscribe(this.data.templateId);
      if (!accepted) { api.showError(new Error('你未同意提醒；预约仍然有效，可稍后开启')); return; }
      const b = await api.call('enableReminder', { id: this.bookingId, accepted: true });
      this.setData({ b: decorate(b) });
      wx.showToast({ title: this.data.demo ? '已开启演示提醒' : '已开启提醒', icon: 'success' });
    } catch (err) { api.showError(err); }
    finally { this.setData({ busy: false }); }
  },
  async switchRole() { await api.call('switchRole'); this.inviteToken = 'demo-invitation'; await this.load(); },
  home() { wx.reLaunch({ url: '/pages/home/index' }); },
  bookings() { wx.navigateTo({ url: '/pages/bookings/index' }); },
  reschedule() { wx.navigateTo({ url: `/pages/reschedule/index?id=${this.bookingId}` }); },
  acceptReschedule() {
    wx.showModal({ title: '确认改到这个时间？', content: `${this.data.b.proposedStartText} 至 ${this.data.b.proposedEndText}。对方确认的新时间将替换旧时间；已发过提醒的用户需要重新开启提醒。`, confirmText: '确认改期', success: r => { if (r.confirm) this.run('acceptReschedule'); } });
  },
  rejectReschedule() { this.run('rejectReschedule'); },
  withdrawReschedule() { this.run('withdrawReschedule'); },
  onShareAppMessage() {
    const b = this.data.b;
    if (b && b.role === 'sender' && b.status === 'pending' && b.token && b.canAct) return { title: `${b.senderName}邀请你：${b.title}`, path: `/pages/detail/index?id=${b.id}&token=${b.token}` };
    return { title: '有约 · 把见面安排好', path: '/pages/home/index' };
  }
});
