const config = require('../config');
const demo = require('./demo');
async function call(action, payload = {}) {
  if (config.demoMode) return demo.call(action, payload);
  if (config.backend === 'free') return require('./free-api').call(action, payload);
  if (!wx.cloud || !config.cloudEnv) throw new Error('请先在 config.js 配置云开发环境');
  const response = await wx.cloud.callFunction({ name: 'appointmentApi', data: { action, payload } });
  const result = response.result;
  if (!result || !result.ok) throw new Error(result && result.message || '服务暂时不可用，请稍后重试');
  return result.data;
}
async function subscribe(templateId) {
  if (config.demoMode) return true;
  if (!templateId) throw new Error('尚未配置微信提醒模板，请联系小程序维护者');
  return new Promise((resolve, reject) => wx.requestSubscribeMessage({
    tmplIds: [templateId],
    success: r => resolve(r[templateId] === 'accept'),
    fail: () => reject(new Error('未能开启提醒，请在真机微信中重试'))
  }));
}
function showError(err) { wx.showToast({ title: err.message || '操作失败', icon: 'none', duration: 3000 }); }
module.exports = { call, subscribe, showError, demoMode: config.demoMode };
