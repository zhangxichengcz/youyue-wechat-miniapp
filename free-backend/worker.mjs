import {makeApi,AppError,ensure,databaseError,hash} from './core.mjs';
import {login,verifySession} from './auth.mjs';
import {makeReminderWorker} from './reminders.mjs';
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
async function limitLogin(request,env){
  // 按 IP 的一分钟登录次数限制，仅保存 IP 的哈希；避免匿名请求耗尽登录接口额度。
  const ip=request.headers.get('CF-Connecting-IP')||'local',windowAt=Math.floor(Date.now()/60000)*60000,id=await hash(`${ip}:${windowAt}`);
  const r=await env.DB.prepare('INSERT INTO rate_limits(id,windowAt,hits) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET hits=hits+1 RETURNING hits').bind(id,windowAt).first();
  ensure(r.hits<=30,'登录过于频繁，请一分钟后重试','RATE_LIMIT',429);
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'youyue-free-backend',configured:!!(env.DB&&env.WX_APP_SECRET&&env.SESSION_SECRET),remindersConfigured:!!env.REMINDER_TEMPLATE_ID});
    try{
      ensure(env.DB,'数据库尚未绑定','CONFIG',503);
      ensure(request.method==='POST'&&['/login','/api'].includes(url.pathname),'接口不存在','NOT_FOUND',404);
      const length=Number(request.headers.get('Content-Length')||0);ensure(length<=16384,'请求内容过长');
      const content=await request.text();ensure(new TextEncoder().encode(content).length<=16384,'请求内容过长');
      let body;try{body=JSON.parse(content);}catch(_){throw new AppError('请求格式无效');}
      ensure(body&&typeof body==='object'&&!Array.isArray(body),'请求格式无效');
      if(url.pathname==='/login'){await limitLogin(request,env);return json({ok:true,data:await login(body.code,env)});}
      const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
      const uid=await verifySession(token,env.SESSION_SECRET);
      const payload=body.payload===undefined?{}:body.payload;ensure(payload&&typeof payload==='object'&&!Array.isArray(payload),'请求内容无效');
      return json({ok:true,data:await makeApi(env)(body.action,payload,uid)});
    }catch(error){const known=databaseError(error);return json({ok:false,code:known.code,message:known.message},known.status);}
  },
  async scheduled(controller,env){
    const summary=await makeReminderWorker(env)();
    // 不记录 OpenID、微信密钥、预约备注或访问令牌。
    console.log('REMINDER_SUMMARY',summary);
    // 仅清理过期登录限流计数，不删除用户预约。
    await env.DB.prepare('DELETE FROM rate_limits WHERE windowAt<?').bind(Date.now()-86400000).run();
  }
};
