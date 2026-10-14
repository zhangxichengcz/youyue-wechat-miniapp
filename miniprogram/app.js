var config = require('./config');
App({
  globalData: { config, profile: null },
  onLaunch: function () {
    if (!config.demoMode && config.backend !== 'free' && wx.cloud && config.cloudEnv) {
      wx.cloud.init({ env: config.cloudEnv, traceUser: false });
    }
  }
});
