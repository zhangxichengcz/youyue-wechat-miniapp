const api = require('../../utils/api');
const { decorate } = require('../../utils/time');
Page({
  data: { demo: api.demoMode, next: null, error: '', loading: true },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const r = await api.call('upcoming');
      this.setData({ next: r.booking ? decorate(r.booking) : null });
    } catch (err) { this.setData({ error: err.message }); }
    finally { this.setData({ loading: false }); }
  },
  create() { wx.navigateTo({ url: '/pages/create/index' }); },
  bookings() { wx.navigateTo({ url: '/pages/bookings/index' }); },
  diagnostics() { wx.navigateTo({ url: '/pages/diagnostics/index' }); },
  detail() { wx.navigateTo({ url: `/pages/detail/index?id=${this.data.next.id}` }); },
  onShareAppMessage() { return { title: '见面日程簿 · 把见面安排好', path: '/pages/home/index' }; }
});
