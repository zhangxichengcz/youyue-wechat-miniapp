import {AppError,ensure,randomId} from './core.mjs';
import {jsonFetch} from './auth.mjs';
const pad=n=>String(n).padStart(2,'0');
function format(ms){const d=new Date(ms+8*3600000);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;}
export function message(b,job,env){
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
export function makeReminderWorker(env,{now=Date.now,send=null,fetcher=fetch}={}){
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
