import {AppError,ensure} from './core.mjs';
const encoder=new TextEncoder();
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function unb64(s){ensure(/^[A-Za-z0-9_-]+$/.test(s),'登录已失效','UNAUTHORIZED',401);return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function key(secret){ensure(typeof secret==='string'&&secret.length>=32,'后台登录密钥未配置','CONFIG',503);return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signSession(uid,secret,now=Date.now()){
  const expiresAt=now+12*3600000,payload=b64(encoder.encode(JSON.stringify({uid,expiresAt})));
  const signature=await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload));
  return {token:`${payload}.${b64(new Uint8Array(signature))}`,expiresAt};
}
export async function verifySession(token,secret,now=Date.now()){
  try{
    ensure(typeof token==='string'&&token.length<=1024,'请重新登录','UNAUTHORIZED',401);
    const parts=token.split('.');ensure(parts.length===2,'请重新登录','UNAUTHORIZED',401);
    const valid=await crypto.subtle.verify('HMAC',await key(secret),unb64(parts[1]),encoder.encode(parts[0]));
    ensure(valid,'请重新登录','UNAUTHORIZED',401);
    const p=JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    ensure(typeof p.uid==='string'&&p.uid.length>0&&p.uid.length<=128&&Number.isSafeInteger(p.expiresAt)&&p.expiresAt>now,'请重新登录','UNAUTHORIZED',401);return p.uid;
  }catch(error){if(error instanceof AppError&&error.code==='CONFIG')throw error;throw new AppError('登录已失效，请重新登录','UNAUTHORIZED',401);}
}
export async function jsonFetch(url,options={},fetcher=fetch){
  const response=await fetcher(url,{...options,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('UPSTREAM_HTTP_ERROR');return response.json();
}
export async function login(code,env,{fetcher=fetch,now=Date.now}={}){
  ensure(typeof code==='string'&&code.length>0&&code.length<=256,'微信登录凭证无效');
  ensure(env.WX_APPID&&env.WX_APP_SECRET,'后台微信登录尚未配置','CONFIG',503);
  const query=new URLSearchParams({appid:env.WX_APPID,secret:env.WX_APP_SECRET,js_code:code,grant_type:'authorization_code'});
  const response=await jsonFetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`,{},fetcher);
  ensure(!response.errcode&&typeof response.openid==='string'&&response.openid.length>0,'微信登录失败，请稍后重试','LOGIN_FAILED',401);
  // session_key 与 AppSecret 只在后台使用，不返回客户端。
  return signSession(response.openid,env.SESSION_SECRET,now());
}
