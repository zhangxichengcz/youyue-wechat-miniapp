// 临时真机检测页：不依赖业务模块、Promise、async 或编译运行时辅助模块。
Page({
  data: { build: '1.0.4', actualVersion: '读取中', base: '', busy: false, health: '尚未检测', login: '尚未检测' },
  onLoad: function () {
    var config = getApp().globalData.config;
    var actualVersion = '开发预览';
    try {
      var info = wx.getAccountInfoSync();
      actualVersion = info.miniProgram.version || info.miniProgram.envVersion || actualVersion;
    } catch (_) {}
    this.setData({ base: config.apiBase || '', actualVersion: actualVersion });
  },
  failure: function (stage, failure) {
    // wx.request 的错误描述仅用于定位网络；不展示请求正文、授权头或响应令牌。
    var detail = String(failure && failure.errMsg || '连接失败').slice(0, 300);
    var patch = { busy: false };
    patch[stage] = detail;
    this.setData(patch);
  },
  checkHealth: function () {
    if (this.data.busy) return;
    var page = this;
    this.setData({ busy: true, health: '正在检测微信内的连接…' });
    wx.request({
      url: this.data.base + '/health', method: 'GET', timeout: 20000,
      success: function (response) {
        var body = response.data;
        var message = 'HTTP ' + response.statusCode;
        if (response.statusCode === 200 && body && body.ok && body.configured && body.remindersConfigured) {
          message += '，后台连接正常，两个配置状态均为 true';
        } else if (body && typeof body.message === 'string') {
          message += '，' + body.message;
        } else {
          message += '，返回结果未通过检查';
        }
        page.setData({ busy: false, health: message });
      },
      fail: function (failure) { page.failure('health', failure); }
    });
  },
  checkLogin: function () {
    if (this.data.busy) return;
    var page = this;
    this.setData({ busy: true, login: '正在检测微信登录…' });
    wx.login({
      success: function (result) {
        if (!result.code) { page.setData({ busy: false, login: '微信未提供登录凭证' }); return; }
        wx.request({
          url: page.data.base + '/login', method: 'POST', timeout: 20000,
          header: { 'content-type': 'application/json' }, data: { code: result.code },
          success: function (response) {
            var body = response.data;
            var message = 'HTTP ' + response.statusCode;
            if (response.statusCode === 200 && body && body.ok && body.data && body.data.token) {
              message += '，微信登录正常';
            } else if (body && typeof body.message === 'string') {
              message += '，' + body.message;
            } else { message += '，登录检查未通过'; }
            // 丢弃检测产生的令牌，业务页会正常重新登录。不保存或显示凭证。
            page.setData({ busy: false, login: message });
          },
          fail: function (failure) { page.failure('login', failure); }
        });
      },
      fail: function () { page.setData({ busy: false, login: '微信登录调用失败' }); }
    });
  },
  home: function () { wx.reLaunch({ url: '/pages/home/index' }); }
});
