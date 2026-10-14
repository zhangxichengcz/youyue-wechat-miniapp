const api = require('../../utils/api');
const { decorate } = require('../../utils/time');
Page({
  data: { demo: api.demoMode, items: [], visible: [], filter: 'all', filters: [{ id: 'all', label: '全部' }, { id: 'confirmed', label: '已确认' }, { id: 'pending', label: '待确认' }, { id: 'closed', label: '已结束' }], loading: false, error: '', hasMore: false },
  onShow() { this.load(true); },
  async load(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const r = await api.call('list', { offset: reset ? 0 : this.data.items.length });
      const items = (reset ? [] : this.data.items).concat(r.items.map(decorate));
      this.setData({ items, hasMore: r.hasMore }); this.applyFilter();
    } catch (err) { this.setData({ error: err.message }); }
    finally { this.setData({ loading: false }); }
  },
  filter(e) { this.setData({ filter: e.currentTarget.dataset.id }); this.applyFilter(); },
  applyFilter() {
    const f = this.data.filter;
    this.setData({ visible: this.data.items.filter(b => f === 'all' || (f === 'closed' ? !['confirmed', 'pending'].includes(b.status) : b.status === f)) });
  },
  detail(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }); },
  create() { wx.navigateTo({ url: '/pages/create/index' }); },
  more() { this.load(false); },
  retry() { this.load(true); }
});
