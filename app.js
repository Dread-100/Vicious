
const STORAGE_KEY = "vicious.datasets.v1";
const MISSION_KEY = "vicious.mission.v1";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function pct(v, digits=1){
  if(v == null || !Number.isFinite(v)) return "—";
  return (v*100).toFixed(digits) + "%";
}
function fmt(v,d=0){
  if(v == null || !Number.isFinite(v)) return "—";
  return Number(v).toFixed(d);
}
function avg(arr){
  const a=arr.filter(Number.isFinite);
  return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
}
function ratio(arr,pred){
  if(!arr.length) return null;
  return arr.filter(pred).length/arr.length;
}
function tsFromMatch(m){
  if(Number.isFinite(m.matchTs)) return m.matchTs;
  if(m.matchId && /^\d+$/.test(String(m.matchId))) return Number(m.matchId);
  if(m.h){
    try{
      const u=new URL(m.h);
      const ts=Number(u.searchParams.get("ts"));
      if(Number.isFinite(ts)) return ts;
    }catch{}
  }
  return null;
}
function normalizeMatch(m, dataset){
  const matchTs=tsFromMatch(m);
  return {
    matchId: m.matchId || (matchTs ? String(matchTs) : `${dataset.day||""}-${m.time||""}-${Math.random()}`),
    matchTs,
    day: dataset.day || null,
    venue: dataset.venue || null,
    time: m.time || null,
    result: m.result || null,
    selfName: (m.selfName && !/^\d+WINS$/i.test(m.selfName)) ? m.selfName : null,
    self: m.self || null,
    deathsSec: Array.isArray(m.deathsSec)?m.deathsSec:[],
    burst: {
      count: Number.isFinite(m.burst?.count)?m.burst.count:0,
      types: Array.isArray(m.burst?.types)?m.burst.types:[],
      activationsSec: Array.isArray(m.burst?.activationsSec)?m.burst.activationsSec:[],
      firstBeforeDeath:
        typeof m.burst?.firstBeforeDeath==="boolean" ? m.burst.firstBeforeDeath :
        typeof m.burst?.firstBurstBeforeFirstDeath==="boolean" ? m.burst.firstBurstBeforeFirstDeath :
        null,
      heldDeathCount: Number.isFinite(m.burst?.heldDeathCount)?m.burst.heldDeathCount:0
    }
  };
}
function loadAll(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return []}
}
function saveAll(a){localStorage.setItem(STORAGE_KEY,JSON.stringify(a))}
function allMatches(){
  const ds=loadAll(), map=new Map();
  for(const d of ds){
    for(const m of d.matches||[]){
      const n=normalizeMatch(m,d);
      map.set(n.matchId,n);
    }
  }
  return [...map.values()].sort((a,b)=>{
    const ta=a.matchTs??0,tb=b.matchTs??0;
    if(ta!==tb)return ta-tb;
    return String(a.time||"").localeCompare(String(b.time||""));
  });
}
function importDataset(raw){
  let obj=JSON.parse(raw);
  if(Array.isArray(obj)){
    let added=0;
    obj.forEach(x=>{added+=mergeDataset(x)});
    return added;
  }
  return mergeDataset(obj);
}
function mergeDataset(obj){
  if(!obj || !Array.isArray(obj.matches)) throw new Error("matches配列が見つかりません");
  const clean={
    schemaVersion: obj.schemaVersion||1,
    source: obj.source||"EXVS2IB",
    day: obj.day||null,
    venue: obj.venue||null,
    importedAt: new Date().toISOString(),
    matches: obj.matches.filter(Boolean).map(m=>{
      const n=normalizeMatch(m,obj);
      return n; // h(URL)は保存しない
    })
  };
  const all=loadAll();
  const key=`${clean.day||""}|${clean.venue||""}`;
  const i=all.findIndex(d=>`${d.day||""}|${d.venue||""}`===key);
  if(i>=0){
    const existing=all[i];
    const map=new Map((existing.matches||[]).map(m=>[String(m.matchId),m]));
    let added=0;
    for(const m of clean.matches){
      const k=String(m.matchId);
      if(!map.has(k)){ added++; }
      map.set(k,{...(map.get(k)||{}),...m});
    }
    all[i]={...existing,...clean,matches:[...map.values()]};
    saveAll(all);
    return added;
  }
  all.push(clean);
  saveAll(all);
  return clean.matches.length;
}

function splitRecent(matches,n=20){
  if(matches.length<=n) return {recent:matches,older:[]};
  return {recent:matches.slice(-n), older:matches.slice(0,-n)};
}
function stats(ms){
  const wins=ms.filter(m=>m.result==="win");
  const losses=ms.filter(m=>m.result==="lose");
  const firstEligible=ms.filter(m=>m.deathsSec.length>0 && typeof m.burst.firstBeforeDeath==="boolean");
  const deathMatches=ms.filter(m=>m.deathsSec.length>0);
  return {
    n:ms.length,
    wins:wins.length,
    losses:losses.length,
    winRate:ms.length?wins.length/ms.length:null,
    avgDealt:avg(ms.map(m=>m.self?.damageDealt)),
    avgTaken:avg(ms.map(m=>m.self?.damageTaken)),
    avgBurst:avg(ms.map(m=>m.burst.count)),
    zeroBurst:ratio(ms,m=>m.burst.count===0),
    twoPlus:ratio(ms,m=>m.burst.count>=2),
    firstBefore:firstEligible.length?ratio(firstEligible,m=>m.burst.firstBeforeDeath):null,
    heldDeath:deathMatches.length?ratio(deathMatches,m=>m.burst.heldDeathCount>0):null,
    avgKills:avg(ms.map(m=>m.self?.kills)),
    avgDeaths:avg(ms.map(m=>m.self?.deaths)),
    avgBurstDamage:avg(ms.map(m=>m.self?.burstDamage))
  };
}

function deltaText(now,old,mode="num",goodDirection=1){
  if(now==null || old==null) return {text:"比較データ不足",cls:"neutral"};
  const d=now-old;
  let text;
  if(mode==="pct") text=(d>=0?"+":"")+(d*100).toFixed(1)+"pt";
  else text=(d>=0?"+":"")+d.toFixed(2);
  const score=d*goodDirection;
  return {text,cls:Math.abs(d)<1e-9?"neutral":score>0?"up":"down"};
}
function makeTrend(label,now,old,mode="num",goodDirection=1,format=x=>fmt(x,2)){
  const d=deltaText(now,old,mode,goodDirection);
  return `<div class="trend"><div><strong>${label}</strong><div class="muted">直近 ${format(now)} / 以前 ${format(old)}</div></div><div class="delta ${d.cls}">${d.text}</div></div>`;
}

function missionCandidates(ms){
  const s=stats(ms);
  const c=[];
  if(s.firstBefore!=null){
    c.push({
      id:"firstBefore",
      title:"1落ち前に覚醒する",
      desc:`現在の1落ち前覚醒率は ${pct(s.firstBefore)}。次の10戦では「最初の被撃墜より前に覚醒」を8戦以上狙う。`,
      target:8,
      eval:m=>m.deathsSec.length>0 && m.burst.firstBeforeDeath===true,
      priority:(1-s.firstBefore)*1.25
    });
  }
  c.push({
    id:"zeroBurst",
    title:"0覚醒の試合をなくす",
    desc:`0覚醒試合は ${pct(s.zeroBurst)}。次の10戦では全試合で最低1回覚醒を使う。`,
    target:10,
    eval:m=>m.burst.count>=1,
    priority:(s.zeroBurst||0)*1.15
  });
  c.push({
    id:"twoPlus",
    title:"2覚醒を増やす",
    desc:`2覚醒以上は ${pct(s.twoPlus)}。次の10戦では2回以上覚醒できた試合を6戦以上狙う。`,
    target:6,
    eval:m=>m.burst.count>=2,
    priority:(1-(s.twoPlus||0))*0.55
  });
  if(s.heldDeath!=null){
    c.push({
      id:"heldDeath",
      title:"覚醒抱え落ちを減らす",
      desc:`被撃墜のある試合のうち ${pct(s.heldDeath)} で覚醒を抱えたまま落ちています。次の10戦では抱え落ち2戦以下を狙う。`,
      target:8,
      eval:m=>m.deathsSec.length===0 || m.burst.heldDeathCount===0,
      priority:(s.heldDeath||0)*1.2
    });
  }
  return c.sort((a,b)=>b.priority-a.priority);
}
function loadMission(){try{return JSON.parse(localStorage.getItem(MISSION_KEY)||"null")}catch{return null}}
function saveMission(m){localStorage.setItem(MISSION_KEY,JSON.stringify(m))}
function clearMission(){localStorage.removeItem(MISSION_KEY)}

function renderMission(ms){
  const box=$("#missionBody"), badge=$("#missionStatus");
  const active=loadMission();
  if(active){
    const after=ms.filter(m=>{
      const t=m.matchTs;
      return t!=null && t>active.baselineTs;
    }).slice(0,10);
    const cand=missionCandidates(ms).find(x=>x.id===active.id);
    const evalFn=cand?.eval || (()=>false);
    const achieved=after.filter(evalFn).length;
    const complete=after.length>=10;
    badge.textContent=complete?"10戦完了":"進行中";
    box.innerHTML=`
      <div class="mission-main">
        <h3>${active.title}</h3>
        <p>${active.desc}</p>
        <div class="progress"><div style="width:${Math.min(100,after.length*10)}%"></div></div>
        <div class="mission-meta"><span>${after.length}/10戦</span><span>達成 ${achieved}/${after.length||0}</span></div>
        ${complete?`<p style="margin-top:10px">結果：${achieved}/10。次の候補へ切り替えられます。</p>`:""}
        <div class="mission-actions">
          ${complete?`<button class="primary" id="nextMission">次のミッションへ</button>`:""}
          <button class="secondary" id="cancelMission">終了</button>
        </div>
      </div>`;
    $("#cancelMission").onclick=()=>{clearMission();renderAll()};
    if($("#nextMission")) $("#nextMission").onclick=()=>{clearMission();renderAll()};
    return;
  }
  const c=missionCandidates(ms)[0];
  if(!c){
    badge.textContent="候補";
    box.innerHTML=`<p class="muted">分析できる戦績がまだありません。</p>`;
    return;
  }
  badge.textContent="候補";
  box.innerHTML=`
    <div class="mission-main">
      <h3>${c.title}</h3>
      <p>${c.desc}</p>
      <div class="mission-actions"><button class="primary" id="startMission">このミッションに挑戦</button></div>
    </div>`;
  $("#startMission").onclick=()=>{
    const baselineTs=Math.max(...ms.map(m=>m.matchTs||0));
    saveMission({id:c.id,title:c.title,desc:c.desc,target:c.target,baselineTs,startedAt:new Date().toISOString()});
    renderAll();
  };
}

function renderCompare(ms){
  const win=stats(ms.filter(m=>m.result==="win")), lose=stats(ms.filter(m=>m.result==="lose"));
  const rows=[
    ["平均与ダメ",win.avgDealt,lose.avgDealt,x=>fmt(x,0)],
    ["平均被ダメ",win.avgTaken,lose.avgTaken,x=>fmt(x,0)],
    ["平均覚醒回数",win.avgBurst,lose.avgBurst,x=>fmt(x,2)],
    ["1落ち前覚醒率",win.firstBefore,lose.firstBefore,x=>pct(x)],
    ["2覚醒以上",win.twoPlus,lose.twoPlus,x=>pct(x)],
    ["覚醒抱え落ち",win.heldDeath,lose.heldDeath,x=>pct(x)]
  ];
  $("#compareTable").innerHTML=`
    <div class="stat-row"><div></div><div class="sub">勝ち</div><div class="sub">負け</div></div>
    ${rows.map(([l,a,b,f])=>`<div class="stat-row"><div class="label">${l}</div><div class="v">${f(a)}</div><div class="v">${f(b)}</div></div>`).join("")}`;
}
function renderPlay(ms){
  const s=stats(ms), w=stats(ms.filter(m=>m.result==="win")), l=stats(ms.filter(m=>m.result==="lose"));
  $("#playStats").innerHTML=`
    <div class="stat-row"><div class="label">平均与ダメ</div><div class="v">${fmt(s.avgDealt,0)}</div><div class="sub">全試合</div></div>
    <div class="stat-row"><div class="label">平均被ダメ</div><div class="v">${fmt(s.avgTaken,0)}</div><div class="sub">全試合</div></div>
    <div class="stat-row"><div class="label">平均撃墜</div><div class="v">${fmt(s.avgKills,2)}</div><div class="sub">全試合</div></div>
    <div class="stat-row"><div class="label">平均被撃墜</div><div class="v">${fmt(s.avgDeaths,2)}</div><div class="sub">全試合</div></div>
    <div class="stat-row"><div class="label">与ダメ（勝/負）</div><div class="v">${fmt(w.avgDealt,0)}</div><div class="v">${fmt(l.avgDealt,0)}</div></div>
    <div class="stat-row"><div class="label">被ダメ（勝/負）</div><div class="v">${fmt(w.avgTaken,0)}</div><div class="v">${fmt(l.avgTaken,0)}</div></div>`;
}
function renderBurst(ms){
  const s=stats(ms);
  const bars=[
    ["1落ち前覚醒",s.firstBefore],
    ["2覚醒以上",s.twoPlus],
    ["0覚醒を回避",s.zeroBurst==null?null:1-s.zeroBurst],
    ["抱え落ちを回避",s.heldDeath==null?null:1-s.heldDeath]
  ];
  $("#burstStats").innerHTML=`
    <div class="stat-row"><div class="label">平均覚醒回数</div><div class="v">${fmt(s.avgBurst,2)}</div><div></div></div>
    <div class="stat-row"><div class="label">平均覚醒中与ダメ</div><div class="v">${fmt(s.avgBurstDamage,0)}</div><div></div></div>
    <div style="margin-top:16px">${bars.map(([l,v])=>`
      <div class="bar-row">
        <div class="bar-head"><span>${l}</span><strong>${pct(v)}</strong></div>
        <div class="bar"><div style="width:${v==null?0:Math.max(0,Math.min(100,v*100))}%"></div></div>
      </div>`).join("")}</div>`;
}
function renderTime(ms){
  const buckets=new Map();
  for(const m of ms){
    const h=Number(String(m.time||"").split(":")[0]);
    if(!Number.isFinite(h)) continue;
    const label=h<12?"午前":h<17?"12–16時":h<20?"17–19時":h<22?"20–21時":"22時以降";
    if(!buckets.has(label)) buckets.set(label,[]);
    buckets.get(label).push(m);
  }
  $("#timeStats").innerHTML=[...buckets.entries()].map(([k,a])=>{
    const s=stats(a);
    return `<div class="stat-row"><div class="label">${k}<div class="muted">${s.n}戦</div></div><div class="v">${pct(s.winRate)}</div><div class="sub">勝率</div></div>`;
  }).join("") || `<p class="muted">時刻データがありません。</p>`;
}

function renderAll(){
  const ms=allMatches();
  const empty=ms.length===0;
  $("#emptyState").classList.toggle("hidden",!empty);
  $("#dashboard").classList.toggle("hidden",empty || !$(".nav.active")?.dataset.tab?.includes("dashboard"));
  if(empty) return;

  const s=stats(ms);
  const datasets=loadAll().sort((a,b)=>String(a.day||"").localeCompare(String(b.day||"")));
  $("#periodLabel").textContent=datasets.length===1 ? `${datasets[0].day||""}  ${datasets[0].venue||""}` : `${datasets[0]?.day||"開始"} 〜 ${datasets.at(-1)?.day||"現在"}`;
  $("#matchCount").textContent=s.n;
  $("#wins").textContent=s.wins;
  $("#winRate").textContent=pct(s.winRate);
  $("#avgDealt").textContent=fmt(s.avgDealt,0);
  $("#avgTaken").textContent=fmt(s.avgTaken,0);
  $("#avgBurst").textContent=fmt(s.avgBurst,2);

  renderMission(ms);
  const {recent,older}=splitRecent(ms,20);
  const r=stats(recent),o=stats(older);
  $("#trendCards").innerHTML=[
    makeTrend("勝率",r.winRate,o.winRate,"pct",1,x=>pct(x)),
    makeTrend("平均与ダメ",r.avgDealt,o.avgDealt,"num",1,x=>fmt(x,0)),
    makeTrend("平均被ダメ",r.avgTaken,o.avgTaken,"num",-1,x=>fmt(x,0)),
    makeTrend("平均覚醒回数",r.avgBurst,o.avgBurst,"num",1,x=>fmt(x,2)),
    makeTrend("1落ち前覚醒率",r.firstBefore,o.firstBefore,"pct",1,x=>pct(x)),
    makeTrend("覚醒抱え落ち率",r.heldDeath,o.heldDeath,"pct",-1,x=>pct(x))
  ].join("");
  renderCompare(ms);
  renderPlay(ms);
  renderBurst(ms);
  renderTime(ms);
}

function switchTab(tab){
  $$(".nav").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  $("#dashboard").classList.toggle("hidden",tab!=="dashboard");
  ["play","burst","matchup","time"].forEach(x=>$("#panel-"+x).classList.toggle("hidden",tab!==x));
  renderAll();
}
$$(".nav").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));

const dlg=$("#importDialog");
function openImport(){dlg.showModal()}
$("#importOpen").onclick=openImport;
$("#emptyImport").onclick=openImport;
$("#pasteBtn").onclick=async()=>{
  try{$("#jsonInput").value=await navigator.clipboard.readText();$("#importMessage").textContent="貼り付けました。"}
  catch{$("#importMessage").textContent="自動貼り付けできません。入力欄を長押しして貼り付けてください。"}
};
$("#importBtn").onclick=()=>{
  try{
    const n=importDataset($("#jsonInput").value.trim());
    $("#importMessage").textContent=n===0?"新しい試合はありません。":`${n}試合を追加しました。`;
    $("#jsonInput").value="";
    setTimeout(()=>{dlg.close();switchTab("dashboard")},450);
  }catch(e){
    $("#importMessage").textContent="読み込み失敗: "+e.message;
  }
};

if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
switchTab("dashboard");

// Bookmarklet handoff: #import=<base64url(JSON)> or #sync
(function handleBookmarkletHandoff(){
  const h=location.hash||'';
  if(h.startsWith('#import=')){
    try{
      const s=h.slice(8).replace(/-/g,'+').replace(/_/g,'/');
      const padded=s+'='.repeat((4-s.length%4)%4);
      const bin=atob(padded),bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      const raw=new TextDecoder().decode(bytes);
      const n=importDataset(raw);
      history.replaceState(null,'',location.pathname+location.search);
      switchTab('dashboard');
      setTimeout(()=>alert(n===0?'Vicious: 新しい試合はありません。':`Vicious: ${n}試合を追加しました。`),80);
      return;
    }catch(e){
      history.replaceState(null,'',location.pathname+location.search);
      openImport();
      $('#importMessage').textContent='直接取り込みに失敗しました。JSONを貼り付けてください。';
      return;
    }
  }
  if(h==='#sync'){
    history.replaceState(null,'',location.pathname+location.search);
    openImport();
    $('#importMessage').textContent='同期JSONをクリップボードから貼り付けてください。';
  }
})();
