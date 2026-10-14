export const DAY = 86400000;
export class AppError extends Error {
  constructor(message, code='INVALID', status=400) { super(message);this.code=code;this.status=status; }
}
export function ensure(condition,message,code,status) { if(!condition) throw new AppError(message,code,status); }
export function clean(value,max,required=true) {
  ensure(typeof value==='string','请填写有效的文字内容');const s=value.trim();
  ensure((!required||s.length>0)&&Array.from(s).length<=max,`文字长度需为${required?'1':'0'}～${max}字`);return s;
}
export function times(p,now) {
  ensure(Number.isSafeInteger(p.startAt)&&Number.isSafeInteger(p.endAt),'请选择有效时间');
  ensure(p.startAt>=now+600000&&p.startAt<=now+180*DAY,'请选择10分钟后、180天内的开始时间');
  const duration=p.endAt-p.startAt;ensure(duration>=900000&&duration<=28800000&&duration%60000===0,'时长需为15分钟～8小时');
  return {startAt:p.startAt,endAt:p.endAt};
}
export function hex(bytes) {return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export function randomId(length=16) {return hex(crypto.getRandomValues(new Uint8Array(length)));}
export async function hash(s) {return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
export function roleOf(b,uid) {return b.senderId===uid?'sender':b.recipientId===uid?'recipient':'visitor';}
const VIEW_SQL=`SELECT b.*,mine.status AS myReminderStatus,peer.status AS peerReminderStatus
 FROM bookings b LEFT JOIN reminders mine ON mine.bookingId=b.id AND mine.userId=?
 LEFT JOIN reminders peer ON peer.bookingId=b.id AND peer.userId<>? AND peer.userId<>''`;
export function publicView(b,uid,now) {
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
export function makeApi(env,{now=Date.now}={}) {
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
export function databaseError(error) {
  if(error instanceof AppError)return error;
  const s=String(error.message||'');
  if(s.includes('TIME_CONFLICT'))return new AppError('这个时间已有预约，请换个时间','CONFLICT',409);
  if(s.includes('TOO_MANY_BOOKINGS'))return new AppError('未结束的预约过多，请先取消不需要的预约');
  if(s.includes('REMINDER_SENDING'))return new AppError('提醒正在发送，请稍后再确认改期');
  return new AppError('服务暂时不可用，可能已达到免费额度；请稍后重试','SERVICE_ERROR',503);
}
