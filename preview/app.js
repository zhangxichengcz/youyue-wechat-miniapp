'use strict';
const screen = document.getElementById('screen');
const esc = s => String(s || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = ms => new Date(ms + 8*3600000).toISOString().slice(0,10);
const format = ms => new Date(ms + 8*3600000).toISOString().slice(0,16).replace('T',' ');
const statuses = {pending:'待对方确认',confirmed:'预约成功',cancelled:'已取消',declined:'已婉拒',expired:'邀请已过期',completed:'活动已结束'};
let bookings = []; try { bookings = JSON.parse(localStorage.getItem('youyue-browser-demo') || '[]'); } catch (_) { /* 隐私浏览仍可在内存体验 */ }
let role = 'sender', route = 'home', current = null, filter = 'all';
function save() { try { localStorage.setItem('youyue-browser-demo',JSON.stringify(bookings)); } catch(_) {} }
function toast(message) { const t=document.getElementById('toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3200); }
function go(page,id) { route=page;if(id) current=bookings.find(b=>b.id===id);render();screen.scrollTop=0; }
function button(label,action,kind='primary') { return `<button class="btn ${kind}" data-action="${action}">${label}</button>`; }
function visibleStatus(b) { return b.status==='pending' && b.startAt <= Date.now() ? 'expired' : b.status==='confirmed' && b.endAt <= Date.now() ? 'completed' : b.status; }
function card(b) { return `<div class="s-card list-card" data-id="${esc(b.id)}"><div class="s-row"><b>${esc(b.title)}</b><span class="pill">${statuses[visibleStatus(b)]}</span></div><div class="list-date">${format(b.startAt)}</div><div class="s-muted">${esc(b.location)}</div><div class="list-bottom"><span>${role==='sender'?'我发起的':'我收到的'}</span><span>${esc(role==='sender'?b.recipientName||'等待对方':b.name)} ↗</span></div></div>`; }
function render() {
  document.getElementById('back').style.visibility=route==='home'?'hidden':'visible';
  if(route==='home') {
    const next=bookings.filter(b=>b.status==='confirmed'&&b.startAt>Date.now()).sort((a,b)=>a.startAt-b.startAt)[0];
    screen.innerHTML=`<div class="s-brand"><b>见面日程簿 <span>●</span></b><small>让相见有期</small></div><div class="s-hero"><div class="s-kicker">MAKE TIME, MEET WELL</div><div class="s-title">把时间留给<br>值得的见面。</div><div class="s-sub">选个时间，发出邀请。<br>一起聊聊，也一起记得。</div><div class="s-art"><div class="orbit"></div><div class="orbit two"></div><div class="calendar"><div class="head">下一次见面</div><div class="symbol">约</div><small>期待与你相见</small></div><div class="leaf"></div><div class="leaf two"></div><div class="spark">✦</div></div></div>${button('＋ 发起一个预约','create')}${button('我的预约 ↗','list','secondary')}<div class="s-section">接下来的安排</div>${next?card(next):'<div class="s-card empty"><div class="sun">☀</div>还没有确认的见面<div class="s-muted">从一个邀请开始，安排下一次相见。</div></div>'}<div class="s-footer">双方确认 · 提前 1 天提醒 · 可随时取消</div>`;
  } else if(route==='create') {
    screen.innerHTML=`<div class="s-kicker">A LITTLE PLAN FOR US</div><div class="s-title">约一个好时间</div><div class="s-sub">把安排发给对方，确认后一起赴约。</div><form id="booking-form"><div class="s-label">想一起做什么？</div><div class="chips">${['私人会面','咨询交流','咖啡小聚','线上沟通','自定义'].map((s,i)=>`<button type="button" class="chip ${i===0?'active':''}" data-activity="${s}">${s}</button>`).join('')}</div><input id="custom-title" class="s-input" maxlength="20" placeholder="自定义活动内容，最多20字" hidden><div class="s-label">选择日期与时间</div><div class="s-row"><input aria-label="预约日期" id="date" class="s-input" type="date" min="${date(Date.now())}" max="${date(Date.now()+180*86400000)}" value="${date(Date.now()+2*86400000)}" required><input aria-label="预约时间" id="time" class="s-input" type="time" value="14:00" required></div><div class="s-label">预留多久？</div><select id="duration" aria-label="活动时长" class="s-input"><option value="30">30 分钟</option><option value="60" selected>60 分钟</option><option value="90">90 分钟</option><option value="120">120 分钟</option></select><div class="s-label">你的称呼</div><input id="name" class="s-input" maxlength="20" placeholder="让对方知道你是谁" required><div class="s-label">在哪里见？</div><input id="location" class="s-input" maxlength="80" placeholder="具体地点，或线上会议方式" required><div class="s-label">想提前说的话 <small>选填</small></div><textarea id="note" class="s-input textarea" maxlength="200" placeholder="聊什么、需要准备什么"></textarea><div class="s-note">双方可分别开启提前 1 天提醒。对方确认后才会安排发送。</div><div id="form-error"></div><button class="btn primary" type="submit">生成邀请</button><div class="s-footer">时间均为北京时间 · 对方确认后预约成功</div></form>`;
    document.getElementById('booking-form').onsubmit=e=>{e.preventDefault();create();};
  } else if(route==='detail' && current) {
    const b=current, status=visibleStatus(b), visitor=role==='guest'&&!b.recipientName, canAct=['pending','confirmed'].includes(status)&&b.startAt>Date.now();
    const my=b.reminders[role], other=b.reminders[role==='sender'?'guest':'sender'];
    screen.innerHTML=`<div class="detail-icon">${status==='confirmed'?'✓':status==='pending'?'↗':'—'}</div><div class="detail-title">${statuses[status]}</div><div class="s-sub center">${status==='pending'?(visitor?'有人想把一段时间留给你。':'分享给想见的人，等待对方确认。'):status==='confirmed'?'时间已留好，期待这次相见。':'可以重新发起一次新的邀请。'}</div><div class="s-card"><div class="b-title">${esc(b.title)}</div>${[['开始时间',format(b.startAt)],['结束时间',format(b.endAt)],['见面地点',b.location],['发起人',b.name],...(b.recipientName?[['受邀人',b.recipientName]]:[]),...(b.note?[['提前说的话',b.note]]:[])].map(([k,v])=>`<div class="b-row"><span class="b-key">${k}</span><span class="b-value">${esc(v)}</span></div>`).join('')}</div>${visitor?'<div class="s-label">对方怎么称呼你？</div><input id="guest-name" class="s-input" maxlength="20" placeholder="填写你的称呼">':`<div class="s-note"><div class="s-row"><span>我的提醒</span><b>${my?'已开启（模拟）':'尚未开启'}</b></div><div>${other?'对方已开启提醒':'对方尚未开启提醒'} · 提前 1 天</div>${status==='pending'?'<div>对方确认后才会安排发送。</div>':''}</div>`}${visitor&&canAct?button('确认预约','accept')+button('这次先不了','decline','secondary'):''}${!visitor&&canAct&&!my?button('开启我的提醒','reminder',status==='confirmed'?'primary':'secondary'):''}${role==='sender'&&status==='pending'&&canAct?button('模拟对方打开邀请 ↗','guest','primary'):''}${!visitor&&canAct?button('取消预约','cancel','danger'):''}${button(`切换身份：${role==='sender'?'体验受邀人':'体验发起人'}`,'switch','secondary')}<div class="s-footer">本机交互演示 · 不会真实分享或发送通知</div>`;
  } else if(route==='list') {
    const items=bookings.filter(b=>(role==='sender'||b.recipientName)&&(filter==='all'||(filter==='closed'?!['pending','confirmed'].includes(visibleStatus(b)):visibleStatus(b)===filter)));
    screen.innerHTML=`<div class="s-kicker">YOUR LITTLE PLANS</div><div class="s-row"><div class="s-title">我的预约</div><button class="quiet-button" data-action="create">＋ 新预约</button></div><div class="tabs">${[['all','全部'],['confirmed','已确认'],['pending','待确认'],['closed','已结束']].map(([id,label])=>`<button class="${filter===id?'active':''}" data-filter="${id}">${label}</button>`).join('')}</div>${items.map(card).join('')||'<div class="s-card empty">这里还没有预约<div class="s-muted">发起一个邀请，安排下一次见面。</div></div>'}`;
  }
}
function create() {
  const get=id=>document.getElementById(id).value.trim(), activity=document.querySelector('.chip.active').dataset.activity;
  const startAt=Date.parse(`${get('date')}T${get('time')}:00+08:00`), endAt=startAt+Number(get('duration'))*60000;
  const title=activity==='自定义'?get('custom-title'):activity, name=get('name'), location=get('location'), note=get('note');
  let error='';
  if(!title||!name||!location) error='请填写活动内容、你的称呼和见面地点。';
  else if(!Number.isFinite(startAt)||startAt<Date.now()+600000) error='开始时间至少在 10 分钟之后。';
  else if(startAt>Date.now()+180*86400000) error='请选择 180 天内的时间。';
  else if(bookings.some(b=>['pending','confirmed'].includes(b.status)&&b.startAt<endAt&&b.endAt>startAt)) error='这个时间已有预约，请换个时间。';
  if(error) {document.getElementById('form-error').innerHTML=`<div class="s-error">${error}</div>`;return;}
  role='sender';const b={id:`preview-${Date.now()}`,title,name,location,note,startAt,endAt,status:'pending',recipientName:'',reminders:{sender:false,guest:false}};bookings.unshift(b);save();go('detail',b.id);
}
screen.addEventListener('click',e=>{
  const chip=e.target.closest('[data-activity]');if(chip){document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));chip.classList.add('active');document.getElementById('custom-title').hidden=chip.dataset.activity!=='自定义';return;}
  const tab=e.target.closest('[data-filter]');if(tab){filter=tab.dataset.filter;render();return;}
  const card=e.target.closest('[data-id]');if(card){go('detail',card.dataset.id);return;}
  const target=e.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(action==='create'||action==='list'){if(action==='create')role='sender';go(action);return;}
  if(action==='switch'||action==='guest'){role=action==='guest'?'guest':role==='sender'?'guest':'sender';render();screen.scrollTop=0;return;}
  if(action==='reminder'){current.reminders[role]=true;save();render();toast('演示提醒已开启，正式版会请求微信授权');return;}
  if(action==='accept') {const name=document.getElementById('guest-name').value.trim();if(!name){toast('请填写你的称呼');return;}current.recipientName=name;current.status='confirmed';save();render();screen.scrollTop=0;toast('预约成功！双方可分别开启提醒');return;}
  if(action==='decline'||action==='cancel'){if(!window.confirm(action==='cancel'?'确定取消这次预约？':'确定婉拒这次邀请？'))return;current.status=action==='cancel'?'cancelled':'declined';save();render();screen.scrollTop=0;}
});
document.getElementById('back').onclick=()=>go(route==='detail'?'list':'home');
document.getElementById('start-demo').onclick=()=>{role='sender';go('create');document.querySelector('.phone').scrollIntoView({behavior:'smooth',block:'center'});};
document.getElementById('view-list').onclick=()=>go('list');
render();
