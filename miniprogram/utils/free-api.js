const config = require('../config');
let session = null, loggingIn = null;
function connectionError(failure) {
  const detail = String(failure && failure.errMsg || '');
  let code = 'NETWORK_FAILED', message = '暂时无法连接预约服务，请切换网络后重试';
  if (/url not in domain list|not in.*domain list|合法域名|不在.*域名/i.test(detail)) {
    code = 'NETWORK_DOMAIN'; message = '服务地址未通过微信连接验证，请联系维护者检查域名配置';
  } else if (/timeout|timed[_ ]?out/i.test(detail)) {
    code = 'NETWORK_TIMEOUT'; message = '连接预约服务超时，请检查网络后重试';
  } else if (/name_not_resolved|dns|域名解析/i.test(detail)) {
    code = 'NETWORK_DNS'; message = '当前网络无法找到预约服务，请切换网络后重试';
  } else if (/ssl|tls|certificate|cert_|handshake/i.test(detail)) {
    code = 'NETWORK_TLS'; message = '无法建立安全连接，请联系维护者检查服务证书';
  }
  const error = new Error(message); error.code = code; return error;
}
function request(path,data,token) {
  if (!/^https:\/\/[^/]+(?:\/.*)?$/.test(config.apiBase || '')) return Promise.reject(new Error('请先填写免费后台的 HTTPS 地址'));
  const base = config.apiBase.replace(/\/+$/, '');
  return new Promise((resolve,reject) => wx.request({
    url: base+path, method: 'POST', data, timeout: 20000,
    header: Object.assign({'content-type':'application/json'},token?{Authorization:'Bearer '+token}:{}),
    success: response => {
      const r=response.data;
      if(r && r.ok) resolve(r.data);
      else {const error=new Error(r&&r.message||'后台暂时不可用，请稍后重试');error.code=r&&r.code;reject(error);}
    },
    fail: failure => {
      const error = connectionError(failure);
      // 仅记录固定接口路径和错误类别，不记录原始错误、登录凭证、令牌或请求正文。
      console.warn('YOUYUE_NETWORK_FAILURE', { path, reason: error.code });
      reject(error);
    }
  }));
}
function login() {
  if(session&&session.expiresAt>Date.now()+60000)return Promise.resolve(session);
  if(loggingIn)return loggingIn;
  loggingIn=new Promise((resolve,reject)=>wx.login({success:r=>r.code?resolve(r.code):reject(new Error('微信登录失败，请重新打开')),fail:()=>reject(new Error('微信登录失败，请重新打开'))}))
    .then(code=>request('/login',{code})).then(result=>{session=result;return result;})
    .then(result=>{loggingIn=null;return result;},error=>{loggingIn=null;throw error;});
  return loggingIn;
}
async function call(action,payload) {
  let auth=await login();
  try{return await request('/api',{action,payload},auth.token);}
  catch(error){
    if(error.code!=='UNAUTHORIZED')throw error;
    session=null;auth=await login();return request('/api',{action,payload},auth.token);
  }
}
module.exports={call};
