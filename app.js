const APP_VERSION = "0.5.0";
const STORAGE_KEY = "vicious.matches.v2";
const BACKUP_KEY = "vicious.matches.backup.v2";
const LEGACY_KEY = "vicious.datasets.v1";
const MISSION_KEY = "vicious.mission.v2";
let modeFilter = "all";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pct=(v,d=1)=>v==null||!Number.isFinite(v)?"—":(v*100).toFixed(d)+"%";
const fmt=(v,d=0)=>v==null||!Number.isFinite(v)?"—":Number(v).toFixed(d);
const avg=a=>{a=a.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
const ratio=(a,p)=>a.length?a.filter(p).length/a.length:null;

function tsFromMatch(m){
  if(Number.isFinite(m.matchTs)) return m.matchTs;
  if(m.matchId&&/^\d+$/.test(String(m.matchId))) return Number(m.matchId);
  return null;
}
function normalizeMode(v){
  const s=String(v||"").toLowerCase();
  if(["shuffle","solo","ソロ","シャッフル"].includes(s)) return "shuffle";
  if(["fixed","team","チーム","固定"].includes(s)) return "fixed";
  return "unknown";
}
function normalizeMatch(m,dataset={}){
  const matchTs=tsFromMatch(m);
  const route=m.route||{};
  const burst=m.burst||{};
  const mode=normalizeMode(m.mode||dataset.mode);
  return {
    matchId:String(m.matchId||(matchTs||`${dataset.day||m.day||""}-${m.time||""}-${Math.random()}`)),
    matchTs,
    day:m.day||dataset.day||null,
    venue:m.venue||dataset.venue||null,
    mode,
    modeConfidence:m.modeConfidence||dataset.modeConfidence||null,
    time:m.time||null,
    result:m.result||null,
    selfName:(m.selfName&&!/^\d+WINS$/i.test(m.selfName))?m.selfName:null,
    self:m.self||m.selfStats||null,
    deathsSec:Array.isArray(m.deathsSec)?m.deathsSec:Array.isArray(m.timeline?.deathTimes)?m.timeline.deathTimes:[],
    allyDeathsSec:Array.isArray(m.allyDeathsSec)?m.allyDeathsSec:[],
    enemyDeathsSec:Array.isArray(m.enemyDeathsSec)?m.enemyDeathsSec:[],
    machineKeys:Array.isArray(m.machineKeys)?m.machineKeys:[],
    selfIndex:Number.isInteger(m.selfIndex)?m.selfIndex:null,
    burst:{
      count:Number.isFinite(burst.count)?burst.count:Number.isFinite(m.timeline?.burstCount)?m.timeline.burstCount:0,
      types:Array.isArray(burst.types)?burst.types:Array.isArray(m.timeline?.burstTypes)?m.timeline.burstTypes:[],
      activationsSec:Array.isArray(burst.activationsSec)?burst.activationsSec:Array.isArray(m.timeline?.burstTimes)?m.timeline.burstTimes:[],
      firstBeforeDeath:typeof burst.firstBeforeDeath==="boolean"?burst.firstBeforeDeath:(typeof m.timeline?.firstLifeBurst==="boolean"?m.timeline.firstLifeBurst:null),
      heldDeathCount:Number.isFinite(burst.heldDeathCount)?burst.heldDeathCount:(Number.isFinite(m.timeline?.burstHoldDeathCount)?m.timeline.burstHoldDeathCount:0)
    },
    route:{
      known:typeof route.known==="boolean"?route.known:Array.isArray(m.allyDeathsSec),
      allyDeathsBeforeFirstSelfDeath:Number.isFinite(route.allyDeathsBeforeFirstSelfDeath)?route.allyDeathsBeforeFirstSelfDeath:null,
      lateRoute:typeof route.lateRoute==="boolean"?route.lateRoute:null,
      postDeathBurst:typeof route.postDeathBurst==="boolean"?route.postDeathBurst:null
    }
  };
}

function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}}
function loadMatches(){return readJSON(STORAGE_KEY,[]).map(x=>normalizeMatch(x,x))}
function saveMatches(matches){
  const previous=localStorage.getItem(STORAGE_KEY);
  if(previous) localStorage.setItem(BACKUP_KEY,previous);
  localStorage.setItem(STORAGE_KEY,JSON.stringify(matches));
}
function migrateLegacy(force=false){
  const legacy=readJSON(LEGACY_KEY,[]);
  if(!Array.isArray(legacy)||!legacy.length) return 0;
  const current=force?loadMatches():loadMatches();
  const map=new Map(current.map(m=>[String(m.matchId),m]));
  let added=0;
  for(const d of legacy){
    for(const raw of d.matches||[]){
      const n=normalizeMatch(raw,d),k=String(n.matchId);
      if(!map.has(k)){map.set(k,n);added++}
      else map.set(k,{...map.get(k),...n,route:{...map.get(k).route,...n.route},burst:{...map.get(k).burst,...n.burst}});
    }
  }
  if(added||force) saveMatches([...map.values()]);
  return added;
}
function allMatches(){
  return loadMatches().sort((a,b)=>(a.matchTs??0)-(b.matchTs??0)||String(a.time||"").localeCompare(String(b.time||"")));
}
function mergePayload(obj){
  if(!obj) throw new Error("データが空です");
  if(obj.exportType==="vicious-backup"&&Array.isArray(obj.matches)) obj={schemaVersion:obj.schemaVersion||7,matches:obj.matches};
  if(!Array.isArray(obj.matches)) throw new Error("matches配列が見つかりません");
  const map=new Map(allMatches().map(m=>[String(m.matchId),m]));
  let added=0,updated=0;
  for(const raw of obj.matches.filter(Boolean)){
    const n=normalizeMatch(raw,obj),k=String(n.matchId),old=map.get(k);
    if(!old){map.set(k,n);added++;continue}
    const merged={...old,...n,
      day:n.day||old.day,venue:n.venue||old.venue,
      mode:n.mode!=="unknown"?n.mode:old.mode,
      modeConfidence:n.modeConfidence||old.modeConfidence,
      self:{...(old.self||{}),...(n.self||{})},
      burst:{...(old.burst||{}),...(n.burst||{})},
      route:{...(old.route||{}),...(n.route||{})},
      machineKeys:n.machineKeys?.length?n.machineKeys:old.machineKeys,
      allyDeathsSec:n.allyDeathsSec?.length?n.allyDeathsSec:old.allyDeathsSec,
      enemyDeathsSec:n.enemyDeathsSec?.length?n.enemyDeathsSec:old.enemyDeathsSec
    };
    map.set(k,merged);updated++;
  }
  saveMatches([...map.values()]);
  return {added,updated,total:map.size};
}
function importDataset(raw){
  const obj=JSON.parse(raw);
  if(Array.isArray(obj)){
    let r={added:0,updated:0,total:allMatches().length};
    for(const x of obj){const q=mergePayload(x);r.added+=q.added;r.updated+=q.updated;r.total=q.total}
    return r;
  }
  return mergePayload(obj);
}
function exportBackup(){return JSON.stringify({schemaVersion:7,exportType:"vicious-backup",exportedAt:new Date().toISOString(),matches:allMatches()})}

function visibleMatches(){const ms=allMatches();return modeFilter==="all"?ms:ms.filter(m=>m.mode===modeFilter)}
function splitRecent(ms,n=20){return ms.length<=n?{recent:ms,older:[]}:{recent:ms.slice(-n),older:ms.slice(0,-n)}}
function isNormalEligible(m){return m.route?.known===true&&m.deathsSec.length>0&&m.route.lateRoute===false&&typeof m.burst.firstBeforeDeath==="boolean"}
function isLateEligible(m){return m.route?.known===true&&m.deathsSec.length>0&&m.route.lateRoute===true&&typeof m.route.postDeathBurst==="boolean"}
function stats(ms){
  const wins=ms.filter(m=>m.result==="win"),losses=ms.filter(m=>m.result==="lose");
  const normal=ms.filter(isNormalEligible),late=ms.filter(isLateEligible),death=ms.filter(m=>m.deathsSec.length>0);
  return {n:ms.length,wins:wins.length,losses:losses.length,winRate:ms.length?wins.length/ms.length:null,
    avgDealt:avg(ms.map(m=>m.self?.damageDealt)),avgTaken:avg(ms.map(m=>m.self?.damageTaken)),avgBurst:avg(ms.map(m=>m.burst.count)),
    zeroBurst:ratio(ms,m=>m.burst.count===0),twoPlus:ratio(ms,m=>m.burst.count>=2),
    normalFirstBefore:normal.length?ratio(normal,m=>m.burst.firstBeforeDeath===true):null,normalEligible:normal.length,
    latePostBurst:late.length?ratio(late,m=>m.route.postDeathBurst===true):null,lateEligible:late.length,
    heldDeath:death.length?ratio(death,m=>m.burst.heldDeathCount>0):null,
    avgKills:avg(ms.map(m=>m.self?.kills)),avgDeaths:avg(ms.map(m=>m.self?.deaths)),avgBurstDamage:avg(ms.map(m=>m.self?.burstDamage))};
}
function deltaText(now,old,mode="num",good=1){
  if(now==null||old==null)return{text:"比較データ不足",cls:"neutral"};
  const d=now-old,text=mode==="pct"?(d>=0?"+":"")+(d*100).toFixed(1)+"pt":(d>=0?"+":"")+d.toFixed(2),s=d*good;
  return{text,cls:Math.abs(d)<1e-9?"neutral":s>0?"up":"down"};
}
function makeTrend(label,now,old,mode="num",good=1,format=x=>fmt(x,2)){
  const d=deltaText(now,old,mode,good);return `<div class="trend"><div><strong>${label}</strong><div class="muted">直近 ${format(now)} / 以前 ${format(old)}</div></div><div class="delta ${d.cls}">${d.text}</div></div>`;
}

function missionCandidates(ms){
  const s=stats(ms),c=[];
  if(s.normalEligible>=3&&s.normalFirstBefore!=null)c.push({id:"normalFirst",title:"通常展開で1落ち前覚醒",desc:`後落ちルートを除いた対象${s.normalEligible}戦で ${pct(s.normalFirstBefore)}。次の10戦では対象試合で取りこぼしを減らす。`,target:7,eval:m=>!isNormalEligible(m)||m.burst.firstBeforeDeath===true,priority:(1-s.normalFirstBefore)*.9});
  if(s.lateEligible>=2&&s.latePostBurst!=null)c.push({id:"lateBurst",title:"後落ちルートの覚醒を通す",desc:`相方が先に2落ちしてから自分が落ちる展開のうち、1落ち後に覚醒できた率は ${pct(s.latePostBurst)}。`,target:8,eval:m=>!isLateEligible(m)||m.route.postDeathBurst===true,priority:(1-s.latePostBurst)*.95});
  c.push({id:"zeroBurst",title:"0覚醒の試合をなくす",desc:`0覚醒試合は ${pct(s.zeroBurst)}。次の10戦では全試合で最低1回覚醒を使う。`,target:10,eval:m=>m.burst.count>=1,priority:(s.zeroBurst||0)*1.15});
  c.push({id:"twoPlus",title:"2覚醒を増やす",desc:`2覚醒以上は ${pct(s.twoPlus)}。次の10戦では2回以上覚醒できた試合を6戦以上狙う。`,target:6,eval:m=>m.burst.count>=2,priority:(1-(s.twoPlus||0))*.5});
  if(s.heldDeath!=null)c.push({id:"heldDeath",title:"覚醒抱え落ちを減らす",desc:`被撃墜のある試合のうち ${pct(s.heldDeath)} で覚醒可能状態を抱えて落ちています。`,target:8,eval:m=>m.deathsSec.length===0||m.burst.heldDeathCount===0,priority:(s.heldDeath||0)*1.25});
  return c.sort((a,b)=>b.priority-a.priority);
}
const loadMission=()=>readJSON(MISSION_KEY,null),saveMission=m=>localStorage.setItem(MISSION_KEY,JSON.stringify(m)),clearMission=()=>localStorage.removeItem(MISSION_KEY);
function renderMission(ms){
  const box=$("#missionBody"),badge=$("#missionStatus"),active=loadMission();
  if(active){
    const after=ms.filter(m=>m.matchTs!=null&&m.matchTs>active.baselineTs).slice(0,10),cand=missionCandidates(ms).find(x=>x.id===active.id),fn=cand?.eval||(()=>false),ach=after.filter(fn).length,complete=after.length>=10;
    badge.textContent=complete?"10戦完了":"進行中";
    box.innerHTML=`<div class="mission-main"><h3>${active.title}</h3><p>${active.desc}</p><div class="progress"><div style="width:${Math.min(100,after.length*10)}%"></div></div><div class="mission-meta"><span>${after.length}/10戦</span><span>達成 ${ach}/${after.length||0}</span></div><div class="mission-actions">${complete?'<button class="primary" id="nextMission">次のミッションへ</button>':''}<button class="secondary" id="cancelMission">終了</button></div></div>`;
    $("#cancelMission").onclick=()=>{clearMission();renderAll()};if($("#nextMission"))$("#nextMission").onclick=()=>{clearMission();renderAll()};return;
  }
  const c=missionCandidates(ms)[0];badge.textContent="候補";
  if(!c){box.innerHTML='<p class="muted">分析できる戦績がまだありません。</p>';return}
  box.innerHTML=`<div class="mission-main"><h3>${c.title}</h3><p>${c.desc}</p><div class="mission-actions"><button class="primary" id="startMission">このミッションに挑戦</button></div></div>`;
  $("#startMission").onclick=()=>{saveMission({id:c.id,title:c.title,desc:c.desc,target:c.target,baselineTs:Math.max(0,...ms.map(m=>m.matchTs||0)),startedAt:new Date().toISOString()});renderAll()};
}
function renderCompare(ms){
  const w=stats(ms.filter(m=>m.result==="win")),l=stats(ms.filter(m=>m.result==="lose"));
  const rows=[["平均与ダメ",w.avgDealt,l.avgDealt,x=>fmt(x,0)],["平均被ダメ",w.avgTaken,l.avgTaken,x=>fmt(x,0)],["平均覚醒回数",w.avgBurst,l.avgBurst,x=>fmt(x,2)],["通常展開1落ち前",w.normalFirstBefore,l.normalFirstBefore,x=>pct(x)],["後落ち後覚醒",w.latePostBurst,l.latePostBurst,x=>pct(x)],["覚醒抱え落ち",w.heldDeath,l.heldDeath,x=>pct(x)]];
  $("#compareTable").innerHTML=`<div class="stat-row"><div></div><div class="sub">勝ち</div><div class="sub">負け</div></div>${rows.map(([a,b,c,f])=>`<div class="stat-row"><div class="label">${a}</div><div class="v">${f(b)}</div><div class="v">${f(c)}</div></div>`).join("")}`;
}
function renderPlay(ms){
  const s=stats(ms),w=stats(ms.filter(m=>m.result==="win")),l=stats(ms.filter(m=>m.result==="lose"));
  $("#playStats").innerHTML=`<div class="stat-row"><div class="label">平均与ダメ</div><div class="v">${fmt(s.avgDealt,0)}</div><div class="sub">全試合</div></div><div class="stat-row"><div class="label">平均被ダメ</div><div class="v">${fmt(s.avgTaken,0)}</div><div class="sub">全試合</div></div><div class="stat-row"><div class="label">平均撃墜</div><div class="v">${fmt(s.avgKills,2)}</div><div class="sub">全試合</div></div><div class="stat-row"><div class="label">平均被撃墜</div><div class="v">${fmt(s.avgDeaths,2)}</div><div class="sub">全試合</div></div><div class="stat-row"><div class="label">与ダメ（勝/負）</div><div class="v">${fmt(w.avgDealt,0)}</div><div class="v">${fmt(l.avgDealt,0)}</div></div><div class="stat-row"><div class="label">被ダメ（勝/負）</div><div class="v">${fmt(w.avgTaken,0)}</div><div class="v">${fmt(l.avgTaken,0)}</div></div>`;
}
function renderBurst(ms){
  const s=stats(ms),bars=[[`通常展開の1落ち前覚醒 (${s.normalEligible}戦)`,s.normalFirstBefore],[`後落ちルートの1落ち後覚醒 (${s.lateEligible}戦)`,s.latePostBurst],["2覚醒以上",s.twoPlus],["0覚醒を回避",s.zeroBurst==null?null:1-s.zeroBurst],["抱え落ちを回避",s.heldDeath==null?null:1-s.heldDeath]];
  $("#burstStats").innerHTML=`<div class="stat-row"><div class="label">平均覚醒回数</div><div class="v">${fmt(s.avgBurst,2)}</div><div></div></div><div class="stat-row"><div class="label">平均覚醒中与ダメ</div><div class="v">${fmt(s.avgBurstDamage,0)}</div><div></div></div><div style="margin-top:16px">${bars.map(([l,v])=>`<div class="bar-row"><div class="bar-head"><span>${l}</span><strong>${pct(v)}</strong></div><div class="bar"><div style="width:${v==null?0:Math.max(0,Math.min(100,v*100))}%"></div></div></div>`).join("")}</div><div class="hint">「通常展開の1落ち前覚醒」は、相方が先に2落ちして自分が後落ちする展開を対象外にしています。後落ち展開は別項目で評価します。旧同期データは展開判定情報がないため、この2項目の母数には入りません。</div>`;
}
function renderTime(ms){
  const b=new Map();for(const m of ms){const h=Number(String(m.time||"").split(":")[0]);if(!Number.isFinite(h))continue;const k=h<12?"午前":h<17?"12–16時":h<20?"17–19時":h<22?"20–21時":"22時以降";if(!b.has(k))b.set(k,[]);b.get(k).push(m)}
  $("#timeStats").innerHTML=[...b.entries()].map(([k,a])=>{const s=stats(a);return `<div class="stat-row"><div class="label">${k}<div class="muted">${s.n}戦</div></div><div class="v">${pct(s.winRate)}</div><div class="sub">勝率</div></div>`}).join("")||'<p class="muted">時刻データがありません。</p>';
}
function shortKey(k){return k?`…${String(k).slice(-8)}`:"不明"}
function renderMatchup(ms){
  const rows=[];
  for(const m of ms){if(!Array.isArray(m.machineKeys)||m.machineKeys.length<4||!Number.isInteger(m.selfIndex))continue;const si=m.selfIndex,ally=si<2?(si===0?1:0):(si===2?3:2),enemies=si<2?[2,3]:[0,1];rows.push({result:m.result,ally:m.machineKeys[ally],enemies:enemies.map(i=>m.machineKeys[i]).filter(Boolean)})}
  if(!rows.length){$("#matchupStats").innerHTML='<p class="muted">v0.5同期データがまだありません。次回同期から機体IDを保持します。</p>';return}
  const map=new Map();for(const r of rows){const k=r.ally||"unknown";if(!map.has(k))map.set(k,[]);map.get(k).push(r)}
  const top=[...map.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,8);
  $("#matchupStats").innerHTML=top.map(([k,a])=>{const w=a.filter(x=>x.result==="win").length;return `<div class="stat-row"><div class="label">相方 ${shortKey(k)}<div class="muted">${a.length}戦</div></div><div class="v">${pct(a.length?w/a.length:null)}</div><div class="sub">勝率</div></div>`}).join("")+`<div class="hint">今は機体画像IDで集計しています。機体名マッピングは次段階で追加できます。</div>`;
}
function modeCounts(ms){return {all:ms.length,shuffle:ms.filter(m=>m.mode==="shuffle").length,fixed:ms.filter(m=>m.mode==="fixed").length,unknown:ms.filter(m=>m.mode==="unknown").length}}
function renderModeStrip(){
  const all=allMatches(),c=modeCounts(all);for(const k of Object.keys(c)){const e=$("#count-"+k);if(e)e.textContent=c[k]}
  $$(".mode-chip").forEach(b=>b.classList.toggle("active",b.dataset.mode===modeFilter));
  $("#unknownNotice").classList.toggle("hidden",c.unknown===0);
}
function periodLabel(ms){
  if(!ms.length)return "—";const days=[...new Set(ms.map(m=>m.day).filter(Boolean))];const mode=modeFilter==="all"?"全モード":modeFilter==="shuffle"?"シャッフル":modeFilter==="fixed"?"固定":"未判定";
  if(days.length===1)return `${days[0]} ・ ${mode}`;return `${days[0]||"開始"} 〜 ${days.at(-1)||"現在"} ・ ${mode}`;
}
function renderAll(){
  renderModeStrip();const all=allMatches(),ms=visibleMatches(),empty=all.length===0;
  $("#emptyState").classList.toggle("hidden",!empty);if(empty){$("#dashboard").classList.add("hidden");return}
  const tab=$(".nav.active")?.dataset.tab||"dashboard";$("#dashboard").classList.toggle("hidden",tab!=="dashboard");
  const s=stats(ms);$("#periodLabel").textContent=periodLabel(ms);$("#matchCount").textContent=s.n;$("#wins").textContent=s.wins;$("#winRate").textContent=pct(s.winRate);$("#avgDealt").textContent=fmt(s.avgDealt,0);$("#avgTaken").textContent=fmt(s.avgTaken,0);$("#avgBurst").textContent=fmt(s.avgBurst,2);
  renderMission(ms);const{recent,older}=splitRecent(ms,20),r=stats(recent),o=stats(older);$("#trendCards").innerHTML=[makeTrend("勝率",r.winRate,o.winRate,"pct",1,x=>pct(x)),makeTrend("平均与ダメ",r.avgDealt,o.avgDealt,"num",1,x=>fmt(x,0)),makeTrend("平均被ダメ",r.avgTaken,o.avgTaken,"num",-1,x=>fmt(x,0)),makeTrend("平均覚醒回数",r.avgBurst,o.avgBurst,"num",1,x=>fmt(x,2)),makeTrend("通常展開1落ち前",r.normalFirstBefore,o.normalFirstBefore,"pct",1,x=>pct(x)),makeTrend("覚醒抱え落ち率",r.heldDeath,o.heldDeath,"pct",-1,x=>pct(x))].join("");
  renderCompare(ms);renderPlay(ms);renderBurst(ms);renderMatchup(ms);renderTime(ms);
}
function switchTab(tab){$$(".nav").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));$("#dashboard").classList.toggle("hidden",tab!=="dashboard");["play","burst","matchup","time"].forEach(x=>$("#panel-"+x).classList.toggle("hidden",tab!==x));renderAll()}

$$(".nav").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$$(".mode-chip").forEach(b=>b.onclick=()=>{modeFilter=b.dataset.mode;renderAll()});
$("#fixUnknownBtn").onclick=()=>{
  const groups=new Map();for(const m of allMatches().filter(x=>x.mode==="unknown")){const k=`${m.day||"日付不明"}|${m.venue||"店舗不明"}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(m)}
  const last=[...groups.entries()].sort((a,b)=>Math.max(...a[1].map(x=>x.matchTs||0))-Math.max(...b[1].map(x=>x.matchTs||0))).at(-1);if(!last)return;
  const ans=prompt(`${last[0]} の ${last[1].length}戦\n「s」= シャッフル / 「f」= 固定 / 空欄=中止`,'');if(!ans)return;const mode=/^s/i.test(ans)?"shuffle":/^f/i.test(ans)?"fixed":null;if(!mode)return alert("s か f を入力してください。");
  const ids=new Set(last[1].map(x=>x.matchId)),all=allMatches().map(m=>ids.has(m.matchId)?{...m,mode,modeConfidence:"manual"}:m);saveMatches(all);renderAll();
};

const dlg=$("#importDialog");const openImport=()=>dlg.showModal();$("#importOpen").onclick=openImport;$("#emptyImport").onclick=openImport;
$("#pasteBtn").onclick=async()=>{try{$("#jsonInput").value=await navigator.clipboard.readText();$("#importMessage").textContent="貼り付けました。"}catch{$("#importMessage").textContent="入力欄を長押しして貼り付けてください。"}};
$("#importBtn").onclick=()=>{try{const r=importDataset($("#jsonInput").value.trim());$("#importMessage").textContent=`追加 ${r.added}戦・更新 ${r.updated}戦・累計 ${r.total}戦`;$("#jsonInput").value="";setTimeout(()=>{dlg.close();modeFilter="all";switchTab("dashboard")},450)}catch(e){$("#importMessage").textContent="読み込み失敗: "+e.message}};
$("#exportBtn").onclick=async()=>{const s=exportBackup();try{await navigator.clipboard.writeText(s);$("#importMessage").textContent=`全${allMatches().length}戦をクリップボードにコピーしました。`}catch{$("#jsonInput").value=s;$("#importMessage").textContent="自動コピーできないため入力欄に出しました。"}};
$("#restoreBtn").onclick=()=>{const n=migrateLegacy(true);$("#importMessage").textContent=`旧形式を再確認しました。新規復旧 ${n}戦。`;renderAll()};

async function decodeBase64Url(s){const p=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4),bin=atob(p),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a}
async function decodeGzip(s){const bytes=await decodeBase64Url(s),stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));return await new Response(stream).text()}
async function handleHandoff(){
  const h=location.hash||"";if(!h)return;
  try{
    let raw=null;if(h.startsWith("#import=")){const a=await decodeBase64Url(h.slice(8));raw=new TextDecoder().decode(a)}else if(h.startsWith("#gz=")){raw=await decodeGzip(h.slice(4))}
    if(raw!=null){const r=importDataset(raw);history.replaceState(null,"",location.pathname+location.search);modeFilter="all";switchTab("dashboard");setTimeout(()=>alert(`Vicious: ${r.added}試合追加・${r.updated}試合更新 / 累計${r.total}戦`),80);return}
    if(h==="#sync"){history.replaceState(null,"",location.pathname+location.search);openImport();$("#importMessage").textContent="同期JSONをクリップボードから貼り付けてください。"}
  }catch(e){history.replaceState(null,"",location.pathname+location.search);openImport();$("#importMessage").textContent="直接取り込みに失敗しました: "+e.message}
}
async function checkUpdate(){
  try{const r=await fetch(`./version.json?t=${Date.now()}`,{cache:"no-store"});if(!r.ok)return;const v=await r.json();if(v.version&&v.version!==APP_VERSION){$("#updateText").textContent=`${APP_VERSION} → ${v.version}`;$("#updateBanner").classList.remove("hidden")}}
  catch{}
}
$("#updateBtn").onclick=async()=>{try{if("serviceWorker" in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.update()))}}catch{}location.replace(location.pathname+`?v=${Date.now()}`)};

migrateLegacy(false);
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js?v=0.5.0").then(r=>r.update()).catch(()=>{});
switchTab("dashboard");
handleHandoff();
checkUpdate();
