/** WorkBuddy 成长计划 · Egern native ctx API · v1.1.0
 * 独立网页登录态；仅领取真实达标奖励。默认 preview，不提交任何业务写请求。
 * 官方静态协议及安装限制见 GROWTH-README.md。MIT，见 LICENSE。
 */
const VERSION = '1.1.0';
const ORIGIN = 'https://www.workbuddy.cn';
const PAGE = ORIGIN + '/profile/growth-center';
const PREFIX = '/activity/growth';
const PATH = {
  tasks: '/v2/activity/growth/tasks', subscribe: '/v2/activity/growth/subscribe-task/status',
  profile: '/v2/activity/growth/profile', accept: PREFIX + '/tasks/accept',
  travel: PREFIX + '/buddy/travel/status', travelConfig: PREFIX + '/buddy/travel/config',
  depart: PREFIX + '/buddy/travel/depart', travelClaim: PREFIX + '/buddy/travel/claim',
  streak: PREFIX + '/streak', redeemSummary: PREFIX + '/redeem/summary', redeem: PREFIX + '/redeem',
  agreement: PREFIX + '/buddy/agreement', buddyInfo: PREFIX + '/buddy/info', buddyList: PREFIX + '/buddy/list',
};
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' ? v.trim() : '';
const day = (n = Date.now()) => new Date(n + 8 * 3600000).toISOString().slice(0,10);
const enabled = (v, fallback=true) => v == null || v === '' ? fallback : String(v).toLowerCase() === 'true';
function count(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null; }
function tag(s) { let n=2166136261; for(let i=0;i<s.length;i++) n=Math.imul(n^s.charCodeAt(i),16777619); return (n>>>0).toString(16); }
function header(v) { if(v!=null && typeof v!=='string') throw new GrowthError('config','凭据请求头格式无效'); if(/[\r\n\x00]/.test(v || '')) throw new GrowthError('config','凭据请求头格式无效'); const s=text(v); if(s.length>16384) throw new GrowthError('config','凭据请求头格式无效'); return s; }
function xsrf(auth) {
  if(auth.xsrf) return header(auth.xsrf);
  const values=header(auth.cookie).split(';').map(s=>s.trim()).filter(s=>s.startsWith('XSRF-TOKEN='));
  if(values.length>1) throw new GrowthError('auth','存在多个 XSRF Cookie，请重新采集');
  if(!values.length) return '';
  try { return header(decodeURIComponent(values[0].slice('XSRF-TOKEN='.length))); }
  catch (_) { throw new GrowthError('auth','XSRF Cookie 格式无效，请重新采集'); }
}
function bearer(v) { const s=header(v).replace(/^Bearer\s+/i,''); if(s && /\s/.test(s)) throw new GrowthError('config','Bearer 格式无效'); return s; }
function save(ctx,key,value) { ctx.storage.setJSON(key,value); }
function notify(ctx,body) { try { ctx.notify({title:'WorkBuddy 成长计划',body,action:{type:'openUrl',url:PAGE}}); } catch (_) {} }
class GrowthError extends Error { constructor(type,message) { super(message); this.type=type; } }
function requireObject(value,label) { if(!object(value)) throw new GrowthError('schema',label+'结构异常，已停止该功能'); return value; }
function endpoint(path) {
  return Object.values(PATH).includes(path) || /^\/activity\/growth\/tasks\/[a-zA-Z0-9_-]{1,128}\/claim$/.test(path);
}
function readAuth(env,saved) {
  const cookie=header(env.WORKBUDDY_GROWTH_COOKIE), access=bearer(env.WORKBUDDY_GROWTH_BEARER);
  if(cookie && access) throw new GrowthError('config','Cookie 与小程序 Bearer 只能配置一种');
  const input=JSON.stringify([cookie,access,header(env.WORKBUDDY_GROWTH_XSRF_TOKEN),header(env.WORKBUDDY_GROWTH_ENTERPRISE_ID)]);
  if((cookie || access) && saved.inputTag!==tag(input)) {
    return {cookie,access,xsrf:header(env.WORKBUDDY_GROWTH_XSRF_TOKEN),enterprise:header(env.WORKBUDDY_GROWTH_ENTERPRISE_ID),
      platform:access?'miniprogram':'web',inputTag:tag(input),capturedAt:Date.now()};
  }
  return saved;
}
function capture(ctx,key) {
  const req=ctx.request;
  if(req.method==='OPTIONS' || !/^https:\/\/www\.workbuddy\.cn\/(?:v2\/)?activity\/growth\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\?[^#\r\n]*)?$/.test(req.url)) return;
  const get=name=>header(req.headers.get(name));
  const authorization=get('Authorization');
  const cookie=get('Cookie');
  const access=/^Bearer\s+\S+$/i.test(authorization)?bearer(authorization):'';
  if(!cookie && !access) return;
  const platform=get('X-Client-Platform') || 'web';
  if(!['web','workbuddy','miniprogram'].includes(platform) || (access && platform!=='miniprogram')) return;
  const old=ctx.storage.getJSON(key) || {};
  const incoming={cookie:access?'':cookie,access,xsrf:get('X-XSRF-TOKEN'),enterprise:get('X-Enterprise-Id'),platform,
    userAgent:get('User-Agent'),inputTag:old.inputTag};
  if(['cookie','access','xsrf','enterprise','platform','userAgent'].every(k=>incoming[k]===(old[k] || ''))) return;
  save(ctx,key,{...incoming,capturedAt:Date.now()});
  notify(ctx,'成长计划登录态已单独保存；先运行 preview 核验，确认后再切换 run。');
}
function transport(ctx,auth) {
  const deadline=Date.now()+140000; let requests=0;
  return async (method,path,body) => {
    if(!endpoint(path) || !['get','post'].includes(method)) throw new GrowthError('internal','请求不在功能白名单中');
    if(++requests>24 || Date.now()+8000>deadline) throw new GrowthError('budget','达到单次运行预算，剩余留待下次');
    const headers={'Accept':'application/json, text/plain, */*','Content-Type':'application/json',
      'Accept-Language':'zh-CN','X-Client-Platform':auth.platform || 'web','Referer':PAGE,'Origin':ORIGIN};
    if(auth.access) headers.Authorization='Bearer '+bearer(auth.access);
    else if(auth.cookie) headers.Cookie=header(auth.cookie);
    else throw new GrowthError('auth','缺少成长计划登录态，请在手机打开成长计划页面采集');
    const csrf=xsrf(auth);
    if(csrf) headers['X-XSRF-TOKEN']=csrf;
    if(auth.enterprise) headers['X-Enterprise-Id']=header(auth.enterprise);
    if(auth.userAgent) headers['User-Agent']=header(auth.userAgent);
    let response;
    try { response=await ctx.http[method](ORIGIN+path,{headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
      timeout:8000,redirect:'error',credentials:'omit'}); }
    catch (_) { throw new GrowthError('network','请求超时或网络异常，结果未确认'); }
    if(response.status===401 || response.status===403) throw new GrowthError('auth','成长登录态失效或被拒绝；请重新打开官网采集，不使用签到令牌续期');
    if(response.status<200 || response.status>=300) throw new GrowthError('http','成长接口 HTTP '+response.status+'，已停止该操作');
    let result;
    try { result=await response.json(); } catch (_) { throw new GrowthError('schema','接口未返回 JSON，可能需要重新登录'); }
    requireObject(result,'业务响应');
    if(own(result,'code') && result.code!==0 && result.code!==200) {
      if(result.code===401 || result.code===403) throw new GrowthError('auth','成长登录态已失效，请重新采集');
      throw new GrowthError('business','活动接口未确认成功'+(Number.isSafeInteger(result.code)?'（code='+result.code+'）':''));
    }
    if(own(result,'success') && result.success!==true) throw new GrowthError('business','接口明确未确认成功');
    if(method==='get' && !own(result,'data')) throw new GrowthError('schema','读取响应缺少 data');
    return result.data;
  };
}

export default async function(ctx) {
  const env=ctx.env || {};
  const slot=text(env.WORKBUDDY_ACCOUNT_KEY) || 'default';
  if(!/^[a-zA-Z0-9_-]{1,48}$/.test(slot)) { notify(ctx,'账号槽位格式无效'); return; }
  const root='workbuddy.growth.v1.'+slot, sessionKey=root+'.session';
  let lease, report={version:VERSION,updatedAt:Date.now(),mode:'preview',messages:[],confirmed:0,planned:0};
  const mode=text(env.WORKBUDDY_GROWTH_MODE) || 'preview';
  if(mode==='off') return;
  try {
    if(!['preview','run'].includes(mode)) throw new GrowthError('config','WORKBUDDY_GROWTH_MODE 仅支持 preview、run、off');
    report.mode=mode;
    if(ctx.request) { capture(ctx,sessionKey); return; }
    let auth=readAuth(env,requireObject(ctx.storage.getJSON(sessionKey) || {},'保存的登录态'));
    if(!auth.cookie && !auth.access) throw new GrowthError('auth','缺少成长计划独立登录态；请打开 '+PAGE+' 采集，旧签到令牌不适用');
    if(auth.cookie && auth.access) throw new GrowthError('config','保存的登录态混用了 Cookie 与 Bearer，请重新采集');
    if(!['web','workbuddy','miniprogram'].includes(auth.platform || 'web') || (auth.access && auth.platform!=='miniprogram')) throw new GrowthError('config','保存的登录态平台无效，请重新采集');
    save(ctx,sessionKey,auth);
    const oldLock=ctx.storage.getJSON(root+'.lock');
    if(oldLock && (!object(oldLock) || !Number.isFinite(oldLock.until))) throw new GrowthError('config','本地运行锁损坏，请换账号槽位');
    if(oldLock && oldLock.until>Date.now()) { report.messages.push('同槽位已有任务运行，本次跳过'); return; }
    lease=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    save(ctx,root+'.lock',{id:lease,until:Date.now()+175000});
    if(ctx.storage.getJSON(root+'.lock')?.id!==lease) throw new GrowthError('config','同槽位运行锁冲突，本次跳过');
    const state=requireObject(ctx.storage.getJSON(root+'.state') || {attempts:{}},'本地状态');
    requireObject(state.attempts,'操作记录');
    // Only keep a bounded recent journal. Records contain no authentication material.
    for(const [key,value] of Object.entries(state.attempts)) {
      if(!object(value) || !Number.isFinite(value.at)) throw new GrowthError('config','操作记录损坏，请换账号槽位');
      if(value.status==='confirmed' && value.at<Date.now()-35*86400000) delete state.attempts[key];
    }
    const api=transport(ctx,auth);
    const agreement=requireObject(await api('get',PATH.agreement),'活动协议状态');
    if(agreement.agreed!==true) { report.messages.push('请先在官网自行阅读并同意活动规则；脚本不会代为同意或领取首个 Buddy'); return; }
    const buddyInfo=requireObject(await api('get',PATH.buddyInfo),'Buddy 信息');
    if(!own(buddyInfo,'buddy') || (buddyInfo.buddy!==null && !validBuddy(buddyInfo.buddy))) throw new GrowthError('schema','Buddy 信息格式异常');
    let hasBuddy=validBuddy(buddyInfo.buddy);
    if(!hasBuddy) {
      const list=requireObject(await api('get',PATH.buddyList),'Buddy 列表');
      if(!Array.isArray(list.buddies) || list.buddies.some(b=>!validBuddy(b))) throw new GrowthError('schema','Buddy 列表格式异常');
      hasBuddy=list.buddies.length>0;
    }
    let writes=0;
    const rawLimit=text(env.WORKBUDDY_GROWTH_MAX_WRITES) || '6';
    if(!/^[1-8]$/.test(rawLimit)) throw new GrowthError('config','每次写请求上限只能是 1–8');
    const limit=Number(rawLimit);
    const context={env,mode,api,report,state,hasBuddy,platform:auth.platform || 'web',
      async mutate(key,label,path,body,verify,makeToken) {
        if(mode==='preview') { report.planned++; report.messages.push('可执行：'+label); return false; }
        if(writes>=limit) { report.messages.push('写请求达到上限，剩余留待下次'); return false; }
        const activeLock=ctx.storage.getJSON(root+'.lock');
        if(!activeLock || activeLock.id!==lease || activeLock.until<=Date.now()) throw new GrowthError('lock','运行锁已失效，停止后续写请求');
        const previous=state.attempts[key];
        if(previous && (previous.status==='pending' || key.startsWith('redeem:') || key.startsWith('travel-claim:') || previous.day===day())) {
          report.messages.push(label+'：已有提交记录，不重复发送；未确认结果请到官网核对'); return false;
        }
        const record={at:Date.now(),day:day(),status:'pending'};
        if(makeToken) record.clientToken=makeToken();
        state.attempts[key]=record;
        // Persist BEFORE the mutation. Failed storage must prevent the request.
        try { save(ctx,root+'.state',state); }
        catch (_) { if(previous) state.attempts[key]=previous; else delete state.attempts[key]; throw new GrowthError('storage','操作记录保存失败，未发送写请求'); }
        writes++;
        let checked=false, confirmed=false;
        try {
          await api('post',path,makeToken?{...body,client_token:record.clientToken}:body);
          checked=true; confirmed=await verify();
        } catch(error) {
          if(error.type==='auth' || error.type==='budget') {
            // An explicit pre-verification auth rejection or local pre-send budget stop is not an uncertain write.
            if(!checked) { if(previous) state.attempts[key]=previous; else delete state.attempts[key]; save(ctx,root+'.state',state); }
            throw error;
          }
          // One read-only reconciliation, including a timed-out/ambiguous POST.
          if(!checked) {
            try { confirmed=await verify(); }
            catch(checkError) { if(checkError.type==='auth' || checkError.type==='budget') throw checkError; }
          }
        }
        if(confirmed) {
          record.status='confirmed'; save(ctx,root+'.state',state);
          report.confirmed++; report.messages.push(label+'：已由服务端复核'); return true;
        }
        report.failed=true;
        report.messages.push(label+'：结果待核验，本日不重发');
        return false;
      },
    };
    for(const [flag,label,run] of [
      ['WORKBUDDY_GROWTH_TRAVEL','旅行',runTravel],
      ['WORKBUDDY_GROWTH_TASKS','任务',runTasks],
      ['WORKBUDDY_GROWTH_REDEEM','活跃兑换',runRedeem],
    ]) {
      if(!enabled(env[flag])) continue;
      try { await run(context); }
      catch(error) {
        if(error.type==='auth' || error.type==='budget' || error.type==='lock') throw error;
        report.failed=true;
        report.messages.push(label+'：'+(error instanceof GrowthError?error.message:'处理失败，已安全跳过'));
      }
    }
    if(!report.messages.length) report.messages.push('暂无可执行的已达标奖励');
  } catch(error) {
    if(ctx.request) notify(ctx,'成长计划凭据保存失败，请检查配置和本地存储；原请求未修改');
    report.failed=true;
    // Never echo network/server messages or arbitrary stored values.
    report.messages.push(error instanceof GrowthError?error.message:'本地处理失败，未继续提交');
  } finally {
    if(!ctx.request) {
      try { save(ctx,root+'.report',report); } catch (_) { report.failed=true; report.messages.push('运行结果保存失败'); }
      if(lease) { try { if(ctx.storage.getJSON(root+'.lock')?.id===lease) ctx.storage.delete(root+'.lock'); } catch (_) {} }
      const summary=(mode==='preview'?'[预览，不提交] ':'')+report.messages.join('\n');
      console.log('[WorkBuddy Growth '+VERSION+'] '+summary);
      if(report.failed || report.confirmed>0 || mode==='preview' || enabled(env.WORKBUDDY_GROWTH_NOTIFY_IDLE,false)) notify(ctx,summary);
    }
  }
}

function taskCode(task) { return object(task) && /^[a-zA-Z0-9_-]{1,128}$/.test(task.task_code || '')?task.task_code:null; }
function validBuddy(value) { return object(value) && ((typeof value.instance_id==='string' && value.instance_id.length>0) || (Number.isSafeInteger(value.instance_id) && value.instance_id>=0)); }
function taskOpen(task) { return (task.locked ?? false)===false; }
async function getTasks(api) {
  const data=requireObject(await api('get',PATH.tasks),'任务数据');
  if(!Array.isArray(data.tasks) || data.tasks.length>200 || data.tasks.some(t=>!object(t))) throw new GrowthError('schema','任务列表结构异常，未提交');
  const codes=data.tasks.map(taskCode).filter(Boolean);
  if(new Set(codes).size!==codes.length) throw new GrowthError('schema','任务代码重复，未提交');
  return data.tasks;
}
async function runTasks(c) {
  const selected=text(c.env.WORKBUDDY_GROWTH_ACCEPT_CODES);
  const codes=[...new Set(selected.split(',').map(s=>s.trim()).filter(Boolean))];
  if(codes.length>8 || codes.some(code=>!/^[a-zA-Z0-9_-]{1,128}$/.test(code))) throw new GrowthError('config','接取任务代码格式无效或超过 8 个');
  // This official GET refreshes subscription progress; preview deliberately omits it.
  if(c.mode==='run') {
    try { await c.api('get',PATH.subscribe); }
    catch(error) { if(error.type==='auth' || error.type==='budget') throw error; c.report.messages.push('公众号状态刷新失败，继续查询现有任务'); }
  }
  const tasks=await getTasks(c.api);
  for(const task of tasks) {
    const code=taskCode(task);
    if(!code || code==='first_buddy' || !taskOpen(task) || (!c.hasBuddy && code!=='RichMeow_Chat')) continue;
    if(task.accept_status!=='completed' || (task.has_reward ?? true)!==true) continue;
    await c.mutate('task-claim:'+code,'任务领奖 '+code,PREFIX+'/tasks/'+code+'/claim',undefined,
      async()=> (await getTasks(c.api)).some(t=>t.task_code===code && t.accept_status==='claimed'));
  }
  if(!selected || !c.hasBuddy) return;
  for(const code of codes) {
    const task=tasks.find(t=>t.task_code===code);
    if(!task || code==='first_buddy' || !taskOpen(task) || task.accept_status!=='not_accepted') continue;
    if(!text(task.task_type) || ['auto','beginner'].includes(task.task_type)) continue;
    await c.mutate('task-accept:'+code,'接取任务 '+code,PATH.accept,{task_codes:[code]},
      async()=> (await getTasks(c.api)).some(t=>t.task_code===code && ['accepted','in_progress','completed','claimed'].includes(t.accept_status)));
  }
}
function travelState(value) {
  const state=requireObject(value,'旅行状态');
  if(!['idle','traveling','arrived'].includes(state.state)) throw new GrowthError('schema','未知旅行状态，不派出也不领奖');
  return state;
}
async function runTravel(c) {
  if(!c.hasBuddy) { c.report.messages.push('尚无 Buddy，请先在官网完成新手流程'); return; }
  if(c.platform==='miniprogram') { c.report.messages.push('小程序模式官网未开放旅行入口，已跳过'); return; }
  let state=travelState(await c.api('get',PATH.travel));
  if(state.state==='traveling') { c.report.messages.push('Buddy 仍在旅行，等待服务端返回 arrived'); return; }
  if(state.state==='arrived') {
    if(!Number.isSafeInteger(state.depart_at) || state.depart_at<=0) throw new GrowthError('schema','缺少旅行批次标识，未领取');
    const claimed=await c.mutate('travel-claim:'+state.depart_at,'旅行领奖',PATH.travelClaim,{},async()=>{
      state=travelState(await c.api('get',PATH.travel)); return state.state==='idle';
    });
    if(!claimed) return; // Includes preview and any ambiguous request: never immediately depart.
  }
  if(state.state!=='idle' || state.daily_limit_reached!==false) {
    c.report.messages.push('今日已派出或每日额度未明确，不再派出'); return;
  }
  const config=requireObject(await c.api('get',PATH.travelConfig),'旅行配置');
  if(!Array.isArray(config.locations)) throw new GrowthError('schema','地点配置结构异常，未派出');
  const locations=config.locations.filter(item=>object(item) &&
    ((typeof item.id==='string' && item.id.length>0 && item.id.length<=128) || (Number.isSafeInteger(item.id) && item.id>=0)));
  if(!locations.length) { c.report.messages.push('当前没有可用旅行地点'); return; }
  const requested=text(c.env.WORKBUDDY_GROWTH_TRAVEL_LOCATION);
  const matches=requested?locations.filter(item=>String(item.id)===requested):[locations[0]];
  if(matches.length!==1) throw new GrowthError('config','指定旅行地点不在服务端配置中或不唯一');
  const location=matches[0];
  await c.mutate('travel-depart:'+day(),'派出旅行',PATH.depart,{location_id:location.id},async()=>{
    const after=travelState(await c.api('get',PATH.travel));
    return ['traveling','arrived'].includes(after.state) && object(after.location) && after.location.id===location.id;
  });
}
function redemption(value) {
  const data=requireObject(value,'活跃状态');
  return requireObject(data.redemption_status,'兑换状态');
}
function clientToken(tier) {
  const prefix='redeem-'+tier;
  if(typeof globalThis.crypto?.randomUUID==='function') return prefix+'-'+globalThis.crypto.randomUUID();
  return prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);
}
async function runRedeem(c) {
  let data=await c.api('get',PATH.streak);
  // No locally inferred days/thresholds. Only explicit server eligibility authorizes a write.
  for(const tier of ['7d','14d','28d']) {
    const status=redemption(data);
    if(status['tier_'+tier+'_status']!=='available') continue;
    const rewards=Array.isArray(status.tiers)?status.tiers.filter(t=>object(t) && t.tier===tier):[];
    if(rewards.length!==1 || count(rewards[0].cards)===null) {
      c.report.messages.push('活跃兑换 '+tier+'：奖励配置未明确，已跳过'); continue;
    }
    const cards=rewards[0].cards, wallet=data.makeup_cards;
    if(cards>0 && (!object(wallet) || count(wallet.balance)===null || count(wallet.max)===null || wallet.balance+cards>wallet.max)) {
      c.report.messages.push('活跃兑换 '+tier+'：可能溢出补登卡，留待手动处理'); continue;
    }
    const done=await c.mutate('redeem:'+day().slice(0,7)+':'+tier,'活跃兑换 '+tier,PATH.redeem,{tier},async()=>{
      data=await c.api('get',PATH.streak);
      return redemption(data)['tier_'+tier+'_status']==='claimed';
    },()=>clientToken(tier));
    // Never redeem more tiers against stale capacity after an ambiguous write.
    if(c.mode==='run' && !done) break;
  }
}
