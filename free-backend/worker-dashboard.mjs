// Generated for the Cloudflare dashboard. Edit source modules and rebuild.

// Source: core.mjs
const DAY = 86400000;
class AppError extends Error {
  constructor(message, code='INVALID', status=400) { super(message);this.code=code;this.status=status; }
}
function ensure(condition,message,code,status) { if(!condition) throw new AppError(message,code,status); }
function clean(value,max,required=true) {
  ensure(typeof value==='string','请填写有效的文字内容');const s=value.trim();
  ensure((!required||s.length>0)&&Array.from(s).length<=max,`文字长度需为${required?'1':'0'}～${max}字`);return s;
}
function times(p,now) {
  ensure(Number.isSafeInteger(p.startAt)&&Number.isSafeInteger(p.endAt),'请选择有效时间');
  ensure(p.startAt>=now+600000&&p.startAt<=now+180*DAY,'请选择10分钟后、180天内的开始时间');
  const duration=p.endAt-p.startAt;ensure(duration>=900000&&duration<=28800000&&duration%60000===0,'时长需为15分钟～8小时');
  return {startAt:p.startAt,endAt:p.endAt};
}
function hex(bytes) {return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function randomId(length=16) {return hex(crypto.getRandomValues(new Uint8Array(length)));}
async function hash(s) {return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
function roleOf(b,uid) {return b.senderId===uid?'sender':b.recipientId===uid?'recipient':'visitor';}
const VIEW_SQL=`SELECT b.*,mine.status AS myReminderStatus,peer.status AS peerReminderStatus
 FROM bookings b LEFT JOIN reminders mine ON mine.bookingId=b.id AND mine.userId=?
 LEFT JOIN reminders peer ON peer.bookingId=b.id AND peer.userId<>? AND peer.userId<>''`;
function publicView(b,uid,now) {
  const role=roleOf(b,uid);let status=b.status;
  if(status==='pending'&&b.startAt<=now)status='expired';if(status==='confirmed'&&b.endAt<=now)status='completed';
  const v={id:b.id,title:b.title,location:b.location,note:b.note,startAt:b.startAt,endAt:b.endAt,senderName:b.senderName,recipientName:b.recipientName,status,role,version:b.version,
    reminderStatus:role==='visitor'?'none':b.myReminderStatus||'none',
    otherReminderEnabled:role!=='visitor'&&['pending','dispatching','sent','uncertain'].includes(b.peerReminderStatus),
    proposedStartAt:role==='visitor'?null:b.proposedStartAt,proposedEndAt:role==='visitor'?null:b.proposedEndAt,
    canConfirmReschedule:role!=='visitor'&&b.proposerId&&b.proposerId!==uid?true:false,
    canReschedule:role!=='visitor'&&b.startAt>now&&['pending','confirmed'].includes(b.status)};
  if(role==='sender'&&status==='pending')v.token=b.token;return v;
}
function makeApi(env,{now=Date.now}={}) {
  const DB=env.DB,stmt=(sql,...args)=>DB.prepare(sql).bind(...args);
  const view=async(id,uid)=>stmt(`${VIEW_SQL} WHERE b.id=?`,uid,uid,id).first();
  const profile=name=>stmt('INSERT INTO profiles(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',name.uid,name.name);
  async function update(sql,args) {
    const r=await stmt(sql,...args).run();ensure(r.meta.changes===1,'预约已被其他操作更新，请刷新后重试','CONFLICT',409);
  }
  return async(action,p={},uid)=>{
    ensure(typeof uid==='string'&&uid.length>0,'请重新登录','UNAUTHORIZED',401);const t=now();
    if(action==='profile')return {name:(await stmt('SELECT name FROM profiles WHERE id=?',uid).first())?.name||'',templateId:env.REMINDER_TEMPLATE_ID||'',supportsReschedule:true};
    if(action==='list'){
      const offset=Number.isSafeInteger(p.offset)&&p.offset>=0?p.offset:0;ensure(offset<=10000,'页码无效');
      const r=await stmt(`${VIEW_SQL} WHERE b.senderId=? OR b.recipientId=? ORDER BY b.createdAt DESC,b.id DESC LIMIT 21 OFFSET ?`,uid,uid,uid,uid,offset).all();
      return {items:r.results.slice(0,20).map(b=>publicView(b,uid,t)),hasMore:r.results.length>20};
    }
    if(action==='upcoming'){
      const b=await stmt(`${VIEW_SQL} WHERE (b.senderId=? OR b.recipientId=?) AND b.status='confirmed' AND b.startAt>? ORDER BY b.startAt LIMIT 1`,uid,uid,uid,uid,t).first();return {booking:b?publicView(b,uid,t):null};
    }
    if(action==='create'){
      times(p,t);const title=clean(p.title,20),name=clean(p.name,20),location=clean(p.location,80),note=clean(p.note||'',200,false);
      ensure(typeof p.requestId==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(p.requestId),'请重新提交预约');
      const id=(await hash(`${uid}:${p.requestId}`)).slice(0,32),existing=await view(id,uid);
      if(existing)return publicView(existing,uid,t);
      await DB.batch([
        stmt(`INSERT OR IGNORE INTO bookings(id,title,location,note,senderId,senderName,status,startAt,endAt,createdAt,updatedAt,token) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?)`,id,title,location,note,uid,name,p.startAt,p.endAt,t,t,randomId(24)),
        profile({uid,name})
      ]);return publicView(await view(id,uid),uid,t);
    }
    ensure(typeof p.id==='string'&&/^[a-f0-9]{32}$/.test(p.id),'预约编号无效');
    let b=await view(p.id,uid);ensure(b,'预约不存在','NOT_FOUND',404);const role=roleOf(b,uid);
    const validInvite=b.status==='pending'&&p.token===b.token&&typeof p.token==='string'&&p.token.length===48;
    if(action==='get'){ensure(role!=='visitor'||validInvite,'邀请无效或你无权查看','FORBIDDEN',403);return publicView(b,uid,t);}
    if(p.expectedVersion!==undefined)ensure(p.expectedVersion===b.version,'预约已更新，请刷新后重试','CONFLICT',409);
    if(action==='accept'){
      if(b.status==='confirmed'&&b.recipientId===uid)return publicView(b,uid,t);
      ensure(validInvite&&role==='visitor'&&b.startAt>t,'邀请已失效或不能接受自己发起的邀请');
      const name=clean(p.name,20);
      await update(`UPDATE bookings SET recipientId=?,recipientName=?,status='confirmed',updatedAt=?,version=version+1 WHERE id=? AND status='pending' AND version=? AND startAt>?`,[uid,name,t,b.id,b.version,t]);
      await profile({uid,name}).run();
    }else if(action==='decline'){
      ensure(validInvite&&role==='visitor'&&b.startAt>t,'邀请已失效');
      await update(`UPDATE bookings SET status='declined',updatedAt=?,version=version+1 WHERE id=? AND status='pending' AND version=?`,[t,b.id,b.version]);return {id:b.id,status:'declined'};
    }else{
      ensure(role!=='visitor','你没有权限操作这份预约','FORBIDDEN',403);
      ensure(['pending','confirmed'].includes(b.status)&&b.startAt>t,'预约已失效');
      if(action==='cancel'){
        await update(`UPDATE bookings SET status='cancelled',proposedStartAt=NULL,proposedEndAt=NULL,proposerId=NULL,updatedAt=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','confirmed')`,[t,b.id,b.version]);
      }else if(action==='enableReminder'){
        ensure(env.REMINDER_TEMPLATE_ID,'尚未配置微信订阅消息模板');ensure(p.accepted===true,'请先同意微信订阅提醒');
        await stmt(`UPDATE reminders SET status='pending',authorizedAt=?,dueAt=MAX((SELECT startAt-86400000 FROM bookings WHERE id=reminders.bookingId),?),attempts=0,errorCode=NULL
          WHERE bookingId=? AND userId=? AND status IN ('none','failed','skipped','expired')
          AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=reminders.bookingId AND b.status IN ('pending','confirmed') AND b.startAt>?)`,t,t,b.id,uid,t).run();
      }else if(action==='reschedule'){
        times(p,t);ensure(p.startAt!==b.startAt||p.endAt!==b.endAt,'请选一个新的时间');
        if(b.status==='pending'){
          ensure(role==='sender','只有发起人能修改待确认邀请');
          await update(`UPDATE bookings SET startAt=?,endAt=?,updatedAt=?,version=version+1,scheduleRevision=scheduleRevision+1 WHERE id=? AND version=? AND status='pending'`,[p.startAt,p.endAt,t,b.id,b.version]);
        }else{
          ensure(!b.proposerId,'已有改期申请，请先处理');
          await update(`UPDATE bookings SET proposedStartAt=?,proposedEndAt=?,proposerId=?,updatedAt=?,version=version+1 WHERE id=? AND version=? AND status='confirmed'`,[p.startAt,p.endAt,uid,t,b.id,b.version]);
        }
      }else if(action==='acceptReschedule'||action==='rejectReschedule'){
        ensure(b.status==='confirmed'&&b.proposerId&&b.proposerId!==uid,'只能处理另一位用户提出的改期申请');
        if(action==='acceptReschedule'){
          times({startAt:b.proposedStartAt,endAt:b.proposedEndAt},t);
          await update(`UPDATE bookings SET startAt=proposedStartAt,endAt=proposedEndAt,proposedStartAt=NULL,proposedEndAt=NULL,proposerId=NULL,updatedAt=?,version=version+1,scheduleRevision=scheduleRevision+1 WHERE id=? AND version=? AND status='confirmed'`,[t,b.id,b.version]);
        }else await update(`UPDATE bookings SET proposedStartAt=NULL,proposedEndAt=NULL,proposerId=NULL,updatedAt=?,version=version+1 WHERE id=? AND version=? AND status='confirmed'`,[t,b.id,b.version]);
      }else if(action==='withdrawReschedule'){
        ensure(b.proposerId===uid,'只有提出改期的人能撤回申请');
        await update(`UPDATE bookings SET proposedStartAt=NULL,proposedEndAt=NULL,proposerId=NULL,updatedAt=?,version=version+1 WHERE id=? AND version=? AND status='confirmed'`,[t,b.id,b.version]);
      }else throw new AppError('未知操作');
    }
    b=await view(p.id,uid);return publicView(b,uid,t);
  };
}
function databaseError(error) {
  if(error instanceof AppError)return error;
  const s=String(error.message||'');
  if(s.includes('TIME_CONFLICT'))return new AppError('这个时间已有预约，请换个时间','CONFLICT',409);
  if(s.includes('TOO_MANY_BOOKINGS'))return new AppError('未结束的预约过多，请先取消不需要的预约');
  if(s.includes('REMINDER_SENDING'))return new AppError('提醒正在发送，请稍后再确认改期');
  return new AppError('服务暂时不可用，可能已达到免费额度；请稍后重试','SERVICE_ERROR',503);
}

// Source: auth.mjs
const encoder=new TextEncoder();
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function unb64(s){ensure(/^[A-Za-z0-9_-]+$/.test(s),'登录已失效','UNAUTHORIZED',401);return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function key(secret){ensure(typeof secret==='string'&&secret.length>=32,'后台登录密钥未配置','CONFIG',503);return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function signSession(uid,secret,now=Date.now()){
  const expiresAt=now+12*3600000,payload=b64(encoder.encode(JSON.stringify({uid,expiresAt})));
  const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload));
  return {token:`${payload}.${b64(new Uint8Array(signature))}`,expiresAt};
}
async function verifySession(token,secret,now=Date.now()){
  try{
    ensure(typeof token==='string'&&token.length<=1024,'请重新登录','UNAUTHORIZED',401);
    const parts=token.split('.');ensure(parts.length===2,'请重新登录','UNAUTHORIZED',401);
    const valid=await crypto.subtle.verify('HMAC',await key(secret),unb64(parts[1]),encoder.encode(parts[0]));
    ensure(valid,'请重新登录','UNAUTHORIZED',401);
    const p=JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    ensure(typeof p.uid==='string'&&p.uid.length>0&&p.uid.length<=128&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>now,'请重新登录','UNAUTHORIZED',401);return p.uid;
  }catch(error){if(error instanceof AppError&&error.code==='CONFIG')throw error;throw new AppError('登录已失效，请重新登录','UNAUTHORIZED',401);}
}
async function jsonFetch(url,options={},fetcher=fetch){
  const response=await fetcher(url,{...options,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('UPSTREAM_HTTP_ERROR');return response.json();
}
async function login(code,env,{fetcher=fetch,now=Date.now}={}){
  ensure(typeof code==='string'&&code.length>0&&code.length<=256,'微信登录凭证无效');
  ensure(env.WX_APPID&&env.WX_APP_SECRET,'后台微信登录尚未配置','CONFIG',503);
  const query=new URLSearchParams({appid:env.WX_APPID,secret:env.WX_APP_SECRET,js_code:code,grant_type:'authorization_code'});
  const response=await jsonFetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`,{},fetcher);
  ensure(!response.errcode&&typeof response.openid==='string'&&response.openid.length>0,'微信登录失败，请稍后重试','LOGIN_FAILED',401);
  // session_key 与 AppSecret 只在后台使用，不返回客户端。
  return signSession(response.openid,env.SESSION_SECRET,now());
}

// Source: reminders.mjs
const pad=n=>String(n).padStart(2,'0');
function format(ms){const d=new Date(ms+8*3600000);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;}
function message(b,job,env){
  const title=env.REMINDER_TITLE_FIELD||'thing1',time=env.REMINDER_TIME_FIELD||'time2',location=env.REMINDER_LOCATION_FIELD||'thing3';
  ensure(env.REMINDER_TEMPLATE_ID&&/^thing\d+$/.test(title)&&/^time\d+$/.test(time)&&/^thing\d+$/.test(location)&&new Set([title,time,location]).size===3,'微信提醒模板未配置','CONFIG',503);
  const cut=s=>Array.from(s).slice(0,20).join('');
  return {touser:job.userId,template_id:env.REMINDER_TEMPLATE_ID,page:`pages/detail/index?id=${b.id}`,miniprogram_state:env.MINIPROGRAM_STATE||'trial',lang:'zh_CN',data:{[title]:{value:cut(b.title)},[time]:{value:format(b.startAt)},[location]:{value:cut(b.location)}}};
}
let localToken=null;
async function accessToken(env,now,fetcher){
  if(localToken&&localToken.appid===env.WX_APPID&&localToken.expiresAt>now+120000)return localToken.token;
  const cache=await env.DB.prepare('SELECT token,expiresAt FROM service_tokens WHERE id=?').bind('wechat').first();
  if(cache&&cache.expiresAt>now+120000){localToken={...cache,appid:env.WX_APPID};return cache.token;}
  ensure(env.WX_APP_SECRET,'后台微信密钥未配置','CONFIG',503);
  const r=await jsonFetch('https://api.weixin.qq.com/cgi-bin/stable_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:env.WX_APPID,secret:env.WX_APP_SECRET,force_refresh:false})},fetcher);
  if(r.errcode||!r.access_token)throw new AppError('微信发送凭证暂不可用','TOKEN_FAILED',503);
  const expiresAt=now+Number(r.expires_in||7200)*1000;
  await env.DB.prepare('INSERT INTO service_tokens(id,token,expiresAt) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expiresAt=excluded.expiresAt').bind('wechat',r.access_token,expiresAt).run();
  localToken={token:r.access_token,expiresAt,appid:env.WX_APPID};return r.access_token;
}
function makeReminderWorker(env,{now=Date.now,send=null,fetcher=fetch}={}){
  const sql=(s,...p)=>env.DB.prepare(s).bind(...p);
  async function deliver(payload){
    let token;
    try { token=await accessToken(env,now(),fetcher); }
    catch (_) { throw new AppError('微信发送凭证暂不可用','TOKEN_FAILED',503); }
    return jsonFetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},fetcher);
  }
  return async()=>{
    if(!env.REMINDER_TEMPLATE_ID)return {configured:false};
    // 未配置有效字段时不领取任何消息。
    message({id:'check',title:'测试',location:'地点',startAt:now()},{userId:'check'},env);
    const summary={sent:0,failed:0,uncertain:0,retried:0,skipped:0};
    await sql(`UPDATE reminders SET status='uncertain',errorCode='STALE_DISPATCH' WHERE status='dispatching' AND claimedAt<?`,now()-300000).run();
    await sql(`UPDATE reminders SET status='expired' WHERE status='pending' AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=reminders.bookingId AND b.startAt<=?)`,now()).run();
    // 每次只处理两条，控制免费计划的 CPU 和子请求用量；积压会在后续扫描处理。
    const due=await sql(`SELECT r.* FROM reminders r JOIN bookings b ON b.id=r.bookingId
      WHERE r.status='pending' AND r.dueAt<=? AND b.status='confirmed' AND b.startAt>? AND r.userId<>'' ORDER BY r.dueAt LIMIT 2`,now(),now()).all();
    for(const candidate of due.results){
      const claim=randomId();
      const claimed=await sql(`UPDATE reminders SET status='dispatching',claim=?,claimedAt=?,attempts=attempts+1
        WHERE bookingId=? AND role=? AND generation=? AND status='pending' AND dueAt<=?
        AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=reminders.bookingId AND b.status='confirmed' AND b.startAt>? AND b.scheduleRevision=reminders.generation)`,claim,now(),candidate.bookingId,candidate.role,candidate.generation,now(),now()).run();
      if(claimed.meta.changes!==1)continue;
      async function finish(status,errorCode=null,dueAt=null){await sql(`UPDATE reminders SET status=?,errorCode=?,sentAt=?,dueAt=COALESCE(?,dueAt) WHERE bookingId=? AND role=? AND claim=? AND status='dispatching'`,status,errorCode,status==='sent'?now():null,dueAt,candidate.bookingId,candidate.role,claim).run();}
      let b=await sql('SELECT * FROM bookings WHERE id=?',candidate.bookingId).first();
      if(!b||b.status!=='confirmed'||b.startAt<=now()||b.scheduleRevision!==candidate.generation){await finish('skipped');summary.skipped++;continue;}
      let response;
      try{response=await (send||deliver)(message(b,candidate,env));}
      catch(error){
        // 未取得发送凭证时确定尚未提交给发送接口，可在稍后重试。
        if(error instanceof AppError&&error.code==='TOKEN_FAILED')response={errcode:-1};else response=null;
      }
      const code=response&&typeof response.errcode==='number'?response.errcode:null;
      if(code===0){await finish('sent','0');summary.sent++;}
      else if((code===45009||code===-1)&&candidate.attempts<2&&now()+60000<b.startAt){await finish('pending',String(code),now()+(candidate.attempts+1)*60000);summary.retried++;}
      else {const status=code===null?'uncertain':'failed';await finish(status,code===null?'NETWORK_UNKNOWN':String(code));summary[status]++;}
    }
    return summary;
  };
}

// Source: worker.mjs
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
