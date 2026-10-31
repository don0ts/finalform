/* =============================================================================
   Hitter Stats & Pitcher Stats tabs — traditional counting / rate stat tables.
   Reuses $, loadState, esc, evSwing from charting-stats.js.
   Each charted event is one pitch; a plate appearance (PA) is a pitch that
   ends the at-bat (an in-play result, K, BB, iBB or HBP).
   ============================================================================= */

/* Normalize a terminal plate-appearance code for an event, or null if the
   pitch did not end the at-bat. */
function paTerminalCode(e){
  if(!e) return null;
  let c = e.pa_outcome || e.play || '';
  if(!c && Array.isArray(e.result) && e.result.length){
    const r=e.result;
    if(r.indexOf('K')>=0||r.indexOf('KS')>=0||r.indexOf('KL')>=0) c='K';
    else if(r.indexOf('iBB')>=0) c='iBB';
    else if(r.indexOf('BB')>=0) c='BB';
    else if(r.indexOf('HBP')>=0) c='HBP';
  }
  if(c==='KS'||c==='KL') c='K';
  if(c==='SACB') c='SAC';
  const TERMINALS=['1B','2B','3B','HR','OUT','FC','E','DP','SAC','SACF','K','BB','iBB','HBP'];
  return TERMINALS.indexOf(c)>=0 ? c : null;
}
function isPaEvent(e){ return paTerminalCode(e)!=null; }

/* Count the terminal outcomes for a set of events. */
function tallyOutcomes(evs){
  const t={b1:0,b2:0,b3:0,hr:0,bb:0,so:0,hbp:0,sac:0,sacf:0,out:0,fc:0,err:0,dp:0,pa:0};
  evs.forEach(e=>{
    const c=paTerminalCode(e); if(!c) return; t.pa++;
    switch(c){
      case '1B': t.b1++; break;
      case '2B': t.b2++; break;
      case '3B': t.b3++; break;
      case 'HR': t.hr++; break;
      case 'BB': case 'iBB': t.bb++; break;
      case 'K': t.so++; break;
      case 'HBP': t.hbp++; break;
      case 'SAC': t.sac++; break;
      case 'SACF': t.sacf++; break;
      case 'OUT': t.out++; break;
      case 'FC': t.fc++; break;
      case 'E': t.err++; break;
      case 'DP': t.dp++; break;
    }
  });
  return t;
}

/* Group events by hitter ('player') or pitcher ('pitcher'); also count the
   number of distinct games (charting sessions) each name appears in. */
function gatherTable(state, key){
  const map={};
  (state.sessions||[]).forEach((sess,si)=>{
    (sess.events||[]).forEach(ev=>{
      const p=ev[key]||''; if(!p) return;
      if(!map[p]) map[p]={evs:[], games:0, _g:{}};
      map[p].evs.push(ev);
      if(!map[p]._g[si]){ map[p]._g[si]=1; map[p].games++; }
    });
  });
  return map;
}

/* ---- Hitter line ---- */
function computeHitterLine(evs){
  const t=tallyOutcomes(evs);
  const h=t.b1+t.b2+t.b3+t.hr;
  const ab=h + t.so + t.out + t.fc + t.err + t.dp;      // walks/HBP/sacrifices are not at-bats
  const tb=t.b1 + 2*t.b2 + 3*t.b3 + 4*t.hr;
  const avg = ab? h/ab : null;
  const obpDen = ab + t.bb + t.hbp + t.sacf;            // sac fly counts, sac bunt does not
  const obp = obpDen? (h + t.bb + t.hbp)/obpDen : null;
  const slg = ab? tb/ab : null;
  const ops = (obp!=null && slg!=null)? obp+slg : null;
  return { pa:t.pa, ab:ab, h:h, b2:t.b2, b3:t.b3, hr:t.hr, bb:t.bb, so:t.so,
           avg:avg, obp:obp, slg:slg, ops:ops, tb:tb };
}

/* ---- Pitcher line ---- */
/* Innings pitched uses baseball notation: each out = 1/3 inning, shown as .1/.2
   (one/two outs) and whole innings as .0 — 1 out = 0.1, 2 = 0.2, 3 = 1.0,
   4 = 1.1 ... Outs = K, OUT, E, FC, SAC, SACF and DP; a double play records
   2 outs. */
function outsToIP(outs){ const whole=Math.floor(outs/3), rem=outs%3; return whole + rem/10; }
function computePitcherLine(evs, games){
  const t=tallyOutcomes(evs);
  const h=t.b1+t.b2+t.b3+t.hr;
  const walks=t.bb;
  const outs = t.so + t.out + t.err + t.fc + t.sac + t.sacf + t.dp*2;
  const trueIP = outs/3;
  const ab = h + t.so + t.out + t.fc + t.err + t.dp;
  const whip = trueIP? (walks + h)/trueIP : null;
  const baa = ab? h/ab : null;
  const k9 = trueIP? t.so/trueIP*9 : null;
  const bb9 = trueIP? walks/trueIP*9 : null;
  const kbb = walks? t.so/walks : (t.so>0? t.so : null);
  const pitches = evs.length;
  const swings = evs.filter(evSwing).length;
  const whiffs = evs.filter(e=> e.swing==='Whiff').length;
  const sw = pitches? swings/pitches : null;
  const whiff = swings? whiffs/swings : null;
  return { g:games, ip:outsToIP(outs), trueIP:trueIP, h:h, bb:walks, hbp:t.hbp, so:t.so,
           whip:whip, baa:baa, k9:k9, bb9:bb9, kbb:kbb, sw:sw, whiff:whiff, bf:t.pa };
}

/* ---- formatters ---- */
function fmtAvg(v){ if(v==null||isNaN(v)) return '--'; let s=v.toFixed(3); if(v>=0 && v<1) s=s.replace(/^0/,''); return s; }
function fmtRate2(v){ if(v==null||isNaN(v)) return '--'; if(v===Infinity) return '\u221e'; return v.toFixed(2); }
function fmtIP(v){ if(v==null||isNaN(v)) return '0.0'; return v.toFixed(1); }
function fmtPctStat(v){ if(v==null||isNaN(v)) return '--'; return (v*100).toFixed(1)+'%'; }

/* ---- column definitions ---- */
const HCOLS=[
  {key:'name',label:'Hitter',left:true,desc:false,sort:r=>r.name,fmt:r=>esc(r.name)},
  {key:'pa',label:'PA',desc:true,sort:r=>r.pa,fmt:r=>r.pa},
  {key:'ab',label:'AB',desc:true,sort:r=>r.ab,fmt:r=>r.ab},
  {key:'h',label:'H',desc:true,sort:r=>r.h,fmt:r=>r.h},
  {key:'b2',label:'2B',desc:true,sort:r=>r.b2,fmt:r=>r.b2},
  {key:'b3',label:'3B',desc:true,sort:r=>r.b3,fmt:r=>r.b3},
  {key:'hr',label:'HR',desc:true,sort:r=>r.hr,fmt:r=>r.hr},
  {key:'bb',label:'BB',desc:true,sort:r=>r.bb,fmt:r=>r.bb},
  {key:'so',label:'SO',desc:true,sort:r=>r.so,fmt:r=>r.so},
  {key:'avg',label:'AVG',desc:true,sort:r=>r.avg,fmt:r=>fmtAvg(r.avg)},
  {key:'obp',label:'OBP',desc:true,sort:r=>r.obp,fmt:r=>fmtAvg(r.obp)},
  {key:'slg',label:'SLG',desc:true,sort:r=>r.slg,fmt:r=>fmtAvg(r.slg)},
  {key:'ops',label:'OPS',desc:true,sort:r=>r.ops,fmt:r=>fmtAvg(r.ops)},
  {key:'tb',label:'TB',desc:true,sort:r=>r.tb,fmt:r=>r.tb}
];
const PCOLS=[
  {key:'name',label:'Pitcher',left:true,desc:false,sort:r=>r.name,fmt:r=>esc(r.name)},
  {key:'g',label:'G',desc:true,sort:r=>r.g,fmt:r=>r.g},
  {key:'ip',label:'IP',desc:true,sort:r=>r.trueIP,fmt:r=>fmtIP(r.ip)},
  {key:'h',label:'H',desc:true,sort:r=>r.h,fmt:r=>r.h},
  {key:'bb',label:'BB',desc:true,sort:r=>r.bb,fmt:r=>r.bb},
  {key:'hbp',label:'HBP',desc:true,sort:r=>r.hbp,fmt:r=>r.hbp},
  {key:'so',label:'SO',desc:true,sort:r=>r.so,fmt:r=>r.so},
  {key:'whip',label:'WHIP',desc:false,sort:r=>r.whip,fmt:r=>fmtRate2(r.whip)},
  {key:'baa',label:'BAA',desc:false,sort:r=>r.baa,fmt:r=>fmtAvg(r.baa)},
  {key:'k9',label:'K/9',desc:true,sort:r=>r.k9,fmt:r=>fmtRate2(r.k9)},
  {key:'bb9',label:'BB/9',desc:false,sort:r=>r.bb9,fmt:r=>fmtRate2(r.bb9)},
  {key:'kbb',label:'K/BB',desc:true,sort:r=>r.kbb,fmt:r=> r.bb===0 ? (r.so>0? String(r.so) : '--') : fmtRate2(r.kbb)},
  {key:'sw',label:'SW%',desc:true,sort:r=>r.sw,fmt:r=>fmtPctStat(r.sw)},
  {key:'whiff',label:'WHIFF%',desc:true,sort:r=>r.whiff,fmt:r=>fmtPctStat(r.whiff)},
  {key:'bf',label:'BF',desc:true,sort:r=>r.bf,fmt:r=>r.bf}
];

/* ---- generic sortable table renderer ---- */
function buildSortTable(rootId, rows, cols, st){
  const col=cols.find(c=>c.key===st.key)||cols[0];
  const dir=st.dir;
  rows.sort((a,b)=>{
    let av=col.sort(a), bv=col.sort(b);
    const an=(av==null||(typeof av==='number'&&isNaN(av)));
    const bn=(bv==null||(typeof bv==='number'&&isNaN(bv)));
    if(an&&bn) return a.name.localeCompare(b.name);
    if(an) return 1; if(bn) return -1;
    let cmp = (typeof av==='string')? av.localeCompare(bv) : (av-bv);
    if(cmp===0) cmp=a.name.localeCompare(b.name);
    return dir==='asc'? cmp : -cmp;
  });
  let html='<div class="player-block"><div class="tablewrap"><table class="stats basic-stats"><thead><tr>';
  cols.forEach(c=>{
    const on=c.key===st.key;
    const arrow= on? (dir==='asc'?' \u25B2':' \u25BC') : '';
    html+='<th class="sortable'+(on?' sorted':'')+(c.left?' left':'')+'" data-sort="'+c.key+'">'+esc(c.label)+arrow+'</th>';
  });
  html+='</tr></thead><tbody>';
  rows.forEach(r=>{ html+='<tr>'; cols.forEach(c=>{ html+='<td'+(c.left?' class="left"':'')+'>'+c.fmt(r)+'</td>'; }); html+='</tr>'; });
  html+='</tbody></table></div></div>';
  $(rootId).innerHTML=html;
}

/* ---- Hitter Stats tab ---- */
let hboxState={key:'avg',dir:'desc'};
let hboxFilter='';
function renderHitterBox(){
  const state=loadState();
  const map=gatherTable(state,'player');
  let names=Object.keys(map);
  const total=names.length;
  if(hboxFilter){ const q=hboxFilter.toLowerCase(); names=names.filter(n=>n.toLowerCase().indexOf(q)>=0); }
  if($('hbox-count')) $('hbox-count').textContent = total? (names.length+' of '+total+' shown') : '';
  const root=$('hbox-root'); if(!root) return;
  if(!total){ root.innerHTML='<div class="status">No pitches logged yet. Open the recorder, log pitches on the strike zone, then come back here.</div>'; return; }
  if(!names.length){ root.innerHTML='<div class="status">No hitters match \u201c'+esc(hboxFilter)+'\u201d.</div>'; return; }
  const rows=names.map(n=>{ const r=computeHitterLine(map[n].evs); r.name=n; return r; });
  buildSortTable('hbox-root', rows, HCOLS, hboxState);
}

/* ---- Pitcher Stats tab ---- */
let pboxState={key:'whip',dir:'asc'};
let pboxFilter='';
function renderPitcherBox(){
  const state=loadState();
  const map=gatherTable(state,'pitcher');
  let names=Object.keys(map);
  const total=names.length;
  if(pboxFilter){ const q=pboxFilter.toLowerCase(); names=names.filter(n=>n.toLowerCase().indexOf(q)>=0); }
  if($('pbox-count')) $('pbox-count').textContent = total? (names.length+' of '+total+' shown') : '';
  const root=$('pbox-root'); if(!root) return;
  if(!total){ root.innerHTML='<div class="status">No pitches logged yet. Open the recorder, log pitches on the strike zone, then come back here.</div>'; return; }
  if(!names.length){ root.innerHTML='<div class="status">No pitchers match \u201c'+esc(pboxFilter)+'\u201d.</div>'; return; }
  const rows=names.map(n=>{ const r=computePitcherLine(map[n].evs, map[n].games); r.name=n; return r; });
  buildSortTable('pbox-root', rows, PCOLS, pboxState);
}

/* ---- wiring ---- */
function wireSort(rootId, cols, st, rerender){
  const root=$(rootId); if(!root) return;
  root.addEventListener('click',(e)=>{
    const th=e.target.closest('th[data-sort]'); if(!th) return;
    const key=th.getAttribute('data-sort');
    if(st.key===key){ st.dir = st.dir==='asc'?'desc':'asc'; }
    else { st.key=key; const col=cols.find(c=>c.key===key); st.dir = (col&&col.desc)?'desc':'asc'; }
    rerender();
  });
}
wireSort('hbox-root', HCOLS, hboxState, renderHitterBox);
wireSort('pbox-root', PCOLS, pboxState, renderPitcherBox);

document.querySelectorAll('.stab').forEach(btn=> btn.addEventListener('click', ()=>{
  const which=btn.getAttribute('data-stab');
  if(which==='hbox') renderHitterBox();
  else if(which==='pbox') renderPitcherBox();
}));

if($('hbox-search')) $('hbox-search').addEventListener('input',(e)=>{ hboxFilter=e.target.value.trim(); renderHitterBox(); });
if($('pbox-search')) $('pbox-search').addEventListener('input',(e)=>{ pboxFilter=e.target.value.trim(); renderPitcherBox(); });
if($('hbox-refresh')) $('hbox-refresh').addEventListener('click',()=>{ renderHitterBox(); if(typeof toast==='function') toast('Refreshed'); });
if($('pbox-refresh')) $('pbox-refresh').addEventListener('click',()=>{ renderPitcherBox(); if(typeof toast==='function') toast('Refreshed'); });
window.addEventListener('storage',(e)=>{
  if(e.key!==STORAGE_KEY) return;
  const hp=$('stab-hbox'), pp=$('stab-pbox');
  if(hp && hp.classList.contains('active')) renderHitterBox();
  if(pp && pp.classList.contains('active')) renderPitcherBox();
});

/* Hitter Stats is the default-active tab, so render it on load. */
renderHitterBox();
