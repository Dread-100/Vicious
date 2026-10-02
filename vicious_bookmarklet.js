(async()=>{
  'use strict';
  const EXPECTED='/exvs2ib/results/classmatch/fight/daily_detail';
  const APP='https://dread-100.github.io/Vicious/';
  const KNOWN_KEY='vicious.bookmarklet.known.v1';
  const LAST_KEY='vicious.bookmarklet.last.v1';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
  const num=s=>{const m=String(s||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
  const machineKey=s=>{const m=String(s||'').match(/\/images\/([0-9a-f]{24,})\.(?:png|jpe?g|webp)/i);return m?m[1]:null};
  const sec=(a,b,c)=>Number(a)*60+Number(b)+Number(c)/100;
  const load=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f))}catch{return f}};
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
  const b64url=s=>{
    const bytes=new TextEncoder().encode(s); let bin='';
    for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  };
  const copy=async s=>{
    try{await navigator.clipboard.writeText(s);return true}catch{}
    try{const ta=document.createElement('textarea');ta.value=s;ta.style='position:fixed;left:-9999px;top:0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok}catch{return false}
  };

  if(!location.pathname.includes(EXPECTED)){
    alert('VSモバイルの「日別戦績一覧」でVicious同期を実行してください。');
    return;
  }
  if(document.getElementById('vicious-sync-overlay')) return;

  const overlay=document.createElement('div');
  overlay.id='vicious-sync-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(7,10,15,.97);color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:22px;box-sizing:border-box;overflow:auto';
  overlay.innerHTML=`<div style="max-width:560px;margin:7vh auto 0"><div style="font-size:12px;letter-spacing:.16em;color:#8ea0b5">VICIOUS SYNC</div><div style="font-size:28px;font-weight:850;margin:5px 0 12px">戦績を同期</div><div id="vs-status" style="font-size:15px;line-height:1.65;color:#d7dee8">準備中…</div><div style="height:9px;background:#202733;border-radius:99px;overflow:hidden;margin-top:18px"><div id="vs-bar" style="height:100%;width:2%;background:#fff;transition:width .18s"></div></div><div id="vs-result" style="margin-top:22px"></div><div id="vs-actions" style="display:flex;gap:10px;margin-top:18px"></div></div>`;
  document.body.appendChild(overlay);
  const status=overlay.querySelector('#vs-status'),bar=overlay.querySelector('#vs-bar'),result=overlay.querySelector('#vs-result'),actions=overlay.querySelector('#vs-actions');
  const setStatus=(s,p)=>{status.textContent=s;if(p!=null)bar.style.width=Math.max(2,Math.min(100,p))+'%'};
  const button=(label,primary,fn)=>{const b=document.createElement('button');b.textContent=label;b.style.cssText=`flex:1;padding:14px 12px;border-radius:12px;border:${primary?'0':'1px solid #536070'};font-size:16px;font-weight:750;background:${primary?'#fff':'transparent'};color:${primary?'#0a0e14':'#fff'}`;b.onclick=fn;actions.appendChild(b);return b};

  const fetchDoc=async u=>{
    const r=await fetch(u,{credentials:'include',cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const h=await r.text();
    const d=new DOMParser().parseFromString(h,'text/html');
    if(/login/i.test(r.url)) throw new Error('ログイン状態を確認してください');
    return [h,d];
  };
  const daily=(d,u)=>{
    const box=[...d.querySelectorAll('.content > .box')][0]||d;
    const day=text(box.querySelector('h3 .datetime'))||text(d.querySelector('h3 .datetime'));
    const venue=text(box.querySelector('h3 .col-stand'))||text(d.querySelector('h3 .col-stand'));
    const rows=[];
    for(const a of d.querySelectorAll('a.vs-detail[href*="match_detail"]')){
      const href=new URL(a.getAttribute('href'),u).href, x=new URL(href), ts=x.searchParams.get('ts');
      if(!ts) continue;
      let n=text(a.querySelector('p.fz-xs.fw-b'));
      if(/^\d+WINS$/i.test(n))n='';
      rows.push({href,ts,time:text(a.querySelector('.datetime')),result:a.classList.contains('win')?'win':a.classList.contains('lose')?'lose':null,name:n});
    }
    const pages=[...d.querySelectorAll('.page-send a[href*="daily_detail"]')].map(a=>new URL(a.getAttribute('href'),u).href);
    return {day,venue,rows,pages};
  };
  const score=li=>{
    const o={};
    for(const dl of li.querySelectorAll('dl')){
      const k=text(dl.querySelector('dt')).replace(/\s+/g,''),v=num(text(dl.querySelector('dd')));
      if(k.includes('スコア'))o.score=v;
      else if(k==='撃墜')o.kills=v;
      else if(k==='被撃墜')o.deaths=v;
      else if(k.includes('EXバーストダメージ'))o.burstDamage=v;
      else if(k.includes('与ダメージ'))o.damageDealt=v;
      else if(k.includes('被ダメージ'))o.damageTaken=v;
    }
    const c=[...li.classList].find(x=>/^rank-band\d+$/.test(x));o.rank=c?Number(c.replace('rank-band','')):null;
    return o;
  };
  const timeline=h=>{
    const d=new DOMParser().parseFromString(h,'text/html');
    const s=[...d.scripts].map(x=>x.textContent||'').find(x=>x.includes('var dataset')&&x.includes('vis.DataSet'))||'';
    const out=[];
    const re=/var start_time = new Date\(0,\s*0,\s*0,\s*(\d+),\s*(\d+),\s*(\d+)\);\s*(?:var end_time = new Date\(0,\s*0,\s*0,\s*(\d+),\s*(\d+),\s*(\d+)\);\s*)?dataset\.push\(\{\s*id:\s*\d+,\s*group:\s*["']([^"']+)["'],\s*start:\s*start_time(?:,\s*end:\s*end_time)?(?:,\s*className:\s*["']([^"']+)["'])?(?:,\s*type:\s*["']([^"']+)["'])?\s*\}\);/g;
    let m;while((m=re.exec(s)))out.push({g:m[7],a:sec(m[1],m[2],m[3]),b:m[4]!=null?sec(m[4],m[5],m[6]):null,c:m[8]||null,t:m[9]||null});
    return out;
  };
  const parseDetail=(h,d,meta)=>{
    const names=[...d.querySelectorAll('#panel1 .name')].map(text).filter(Boolean);
    let i=meta.name?names.indexOf(meta.name):-1;if(i<0)i=0;
    const machineImgs=[...d.querySelectorAll('#panel1 img.item-icon-img')].map(img=>img.getAttribute('data-original')||img.getAttribute('src')||'');
    const keys=machineImgs.map(machineKey);
    const rows=[...d.querySelectorAll('#panel3 li.item')].map(score);
    const self={...(rows[i]||{}),machineKey:keys[i]||null};
    const g=['team1-1','team1-2','team2-1','team2-2'][i];
    const ev=timeline(h).filter(x=>x.g===g),de=ev.filter(x=>x.t==='point').map(x=>x.a),bu=ev.filter(x=>/^exbst-(f|s|e)$/.test(x.c||'')),rd=ev.filter(x=>x.c==='ex');
    const fd=de[0]??null,fb=bu[0]?.a??null;
    const held=de.filter(x=>rd.some(y=>y.a<=x&&(y.b==null||x<=y.b+.001)));
    return {selfName:meta.name||names[i]||null,self,deathsSec:de,machineKeys:keys,selfIndex:i,burst:{count:bu.length,types:bu.map(x=>x.c.slice(-1).toUpperCase()),activationsSec:bu.map(x=>x.a),firstBeforeDeath:fb!=null&&(fd==null||fb<fd),heldDeathCount:held.length}};
  };

  try{
    const here=new URL(location.href);here.searchParams.set('page','1');
    const queue=[here.href,location.href],seen=new Set(),byId=new Map();
    let day='',venue='';
    while(queue.length){
      const u=queue.shift();if(seen.has(u))continue;seen.add(u);
      setStatus(`戦績一覧を確認中… ${seen.size}ページ`,6);
      const d=(u===location.href)?document:(await fetchDoc(u))[1];
      const p=daily(d,u);day=day||p.day;venue=venue||p.venue;
      p.rows.forEach(r=>byId.set(r.ts,r));p.pages.forEach(x=>{if(!seen.has(x))queue.push(x)});
      if(u!==location.href)await sleep(120);
    }
    if(!byId.size)throw new Error('試合が見つかりませんでした');
    const key=(here.searchParams.get('ts')||day)+'|'+venue;
    const known=load(KNOWN_KEY,{}),done=new Set(known[key]||[]);
    const fresh=[...byId.values()].filter(x=>!done.has(String(x.ts)));
    if(!fresh.length){
      setStatus('同期済みです',100);
      result.innerHTML=`<div style="font-size:25px;font-weight:850">新規試合なし</div><div style="margin-top:7px;color:#b9c4d1">${day}　${venue}<br>取得済み ${byId.size}試合</div>`;
      button('閉じる',false,()=>overlay.remove());button('Viciousを開く',true,()=>window.open(APP,'_blank')||location.assign(APP));
      return;
    }

    const matches=[],failed=[];
    for(let i=0;i<fresh.length;i++){
      const m=fresh[i];setStatus(`新規試合を取得中… ${i+1}/${fresh.length}`,12+78*(i+1)/fresh.length);
      try{
        const [h,d]=await fetchDoc(m.href),detail=parseDetail(h,d,m);
        matches.push({matchId:String(m.ts),matchTs:Number(m.ts),time:m.time,result:m.result,...detail});
        done.add(String(m.ts));
      }catch(e){failed.push({ts:m.ts,error:String(e.message||e)})}
      await sleep(180);
    }
    known[key]=[...done].slice(-1500);save(KNOWN_KEY,known);
    if(!matches.length)throw new Error('新規試合の詳細取得に失敗しました');
    const wins=matches.filter(x=>x.result==='win').length,avg=a=>{a=a.filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null};
    const payload={schemaVersion:6,source:'GUNDAM VS. MOBILE / EXVS2IB',incremental:true,day,venue,summary:{matches:matches.length,wins,losses:matches.length-wins,winRate:matches.length?wins/matches.length:null,avgDamageDealt:avg(matches.map(x=>x.self?.damageDealt)),avgDamageTaken:avg(matches.map(x=>x.self?.damageTaken)),avgBurstCount:avg(matches.map(x=>x.burst?.count))},matches};
    const json=JSON.stringify(payload);save(LAST_KEY,payload);
    setStatus('同期完了',100);
    result.innerHTML=`<div style="font-size:28px;font-weight:850">+${matches.length}試合</div><div style="margin-top:7px;color:#b9c4d1">${wins}勝 ${matches.length-wins}敗 ・ ${day}<br>${failed.length?`取得失敗 ${failed.length}試合（次回再試行）`:'全件取得完了'}</div>`;
    button('閉じる',false,()=>overlay.remove());
    button('Viciousへ送る',true,async()=>{
      try{
        const enc=b64url(json);
        if(enc.length<28000){const u=APP+'#import='+enc;window.open(u,'_blank')||location.assign(u)}
        else{await copy(json);const u=APP+'#sync';window.open(u,'_blank')||location.assign(u)}
      }catch{await copy(json);const u=APP+'#sync';window.open(u,'_blank')||location.assign(u)}
    });
  }catch(e){
    setStatus('エラー',100);result.innerHTML=`<div style="font-size:18px;font-weight:750;color:#ffb7b7">${String(e.message||e)}</div><div style="margin-top:8px;color:#b9c4d1">日別戦績一覧を再読み込みして、もう一度実行してください。</div>`;button('閉じる',true,()=>overlay.remove());
  }
})();
