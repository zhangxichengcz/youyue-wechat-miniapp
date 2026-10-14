function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// 此入口只调用同账号绑定的预约 Worker，不使用外部地址或另存微信密钥。
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && (path === '/' || path === '/reachability')) {
      return json({ ok: true, service: 'youyue-free-entry', reachable: true });
    }
    const allowed = (request.method === 'GET' && path === '/health') ||
      (request.method === 'POST' && (path === '/login' || path === '/api'));
    if (!allowed) return json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' }, 404);
    if (!env.BACKEND || typeof env.BACKEND.fetch !== 'function') {
      return json({ ok: false, code: 'CONFIG', message: '备用入口尚未绑定预约后台' }, 503);
    }
    try {
      // 原样保留身份令牌、请求正文及后台返回，鉴权仍由原预约后台执行。
      return await env.BACKEND.fetch(request);
    } catch (_) {
      // 不输出身份令牌、请求正文或后台错误详情。
      return json({ ok: false, code: 'UPSTREAM_UNAVAILABLE', message: '预约服务暂时不可用，请稍后重试' }, 503);
    }
  }
};
