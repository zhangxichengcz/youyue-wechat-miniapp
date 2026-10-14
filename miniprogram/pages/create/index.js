const api = require('../../utils/api');
const { dateKey, parse } = require('../../utils/time');
Page({
  data: { demo: api.demoMode, activities: ['私人会面', '咨询交流', '咖啡小聚', '线上沟通', '自定义'], selected: '私人会面', customTitle: '', date: '', minDate: '', maxDate: '', time: '14:00', durations: ['30 分钟', '60 分钟', '90 分钟', '120 分钟'], durationIndex: 1, name: '', location: '', note: '', busy: false, error: '' },
  onLoad() {
    this.requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
    this.setData({ date: dateKey(Date.now() + 2 * 86400000), minDate: dateKey(Date.now()), maxDate: dateKey(Date.now() + 180 * 86400000) });
    api.call('profile').then(p => this.setData({ name: p.name })).catch(api.showError);
  },
  activity(e) { this.setData({ selected: e.currentTarget.dataset.value }); },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  duration(e) { this.setData({ durationIndex: Number(e.detail.value) }); },
  async submit() {
    if (this.data.busy) return;
    const d = this.data;
    const title = (d.selected === '自定义' ? d.customTitle : d.selected).trim();
    const startAt = parse(d.date, d.time), endAt = startAt + [30, 60, 90, 120][d.durationIndex] * 60000;
    if (!title || !d.name.trim() || !d.location.trim()) { this.setData({ error: '请填写活动内容、你的称呼和见面地点。' }); return; }
    if (!Number.isFinite(startAt) || startAt < Date.now() + 600000) { this.setData({ error: '开始时间至少在 10 分钟之后。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const b = await api.call('create', { requestId: this.requestId, title, startAt, endAt, name: d.name.trim(), location: d.location.trim(), note: d.note.trim() });
      wx.redirectTo({ url: `/pages/detail/index?id=${b.id}` });
    } catch (err) { this.setData({ error: err.message }); }
    finally { this.setData({ busy: false }); }
  }
});
