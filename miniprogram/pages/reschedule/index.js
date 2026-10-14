const api = require('../../utils/api');
const { dateKey, parse, format, decorate } = require('../../utils/time');
Page({
  data: { demo: api.demoMode, b: null, date: '', minDate: '', maxDate: '', time: '', durations: ['30 分钟','60 分钟','90 分钟','120 分钟'], durationIndex: 1, busy: false, loading: true, error: '' },
  async onLoad(options) {
    this.bookingId = options.id;
    try {
      const b = await api.call('get', { id: this.bookingId });
      if (!b.canReschedule) throw new Error('预约已失效或你无权改期');
      const index = [30,60,90,120].indexOf((b.endAt - b.startAt) / 60000);
      this.setData({ b: decorate(b), date: dateKey(b.startAt), time: format(b.startAt).slice(11), minDate: dateKey(Date.now()), maxDate: dateKey(Date.now() + 180 * 86400000), durationIndex: index >= 0 ? index : 1 });
    } catch (e) { this.setData({ error: e.message }); }
    finally { this.setData({ loading: false }); }
  },
  change(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  async submit() {
    if (this.data.busy || !this.data.b) return;
    const startAt = parse(this.data.date, this.data.time), endAt = startAt + [30,60,90,120][Number(this.data.durationIndex)] * 60000;
    if (startAt < Date.now() + 600000) { this.setData({ error: '开始时间至少在10分钟之后' }); return; }
    if (startAt === this.data.b.startAt && endAt === this.data.b.endAt) { this.setData({ error: '请选一个新的时间' }); return; }
    this.setData({ busy: true, error: '' });
    try { await api.call('reschedule', { id: this.bookingId, startAt, endAt, expectedVersion: this.data.b.version }); wx.navigateBack(); }
    catch (e) { this.setData({ error: e.message }); }
    finally { this.setData({ busy: false }); }
  }
});
