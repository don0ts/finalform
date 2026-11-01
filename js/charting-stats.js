/* Standalone Hitter Stats page. Reads the same local data the recorder saves. */
const STORAGE_KEY = 'pitch_recorder_compact_v1';
const $ = id => document.getElementById(id);

const INPLAY_SET = ['1B','2B','3B','HR','OUT','FC','E','DP','SAC','SACF'];
const LOC_LABEL = {InZone:'In Zone', OutOfZone:'Out of Zone', NonComp:'Non-Competitive', IntBall:'Intentional Ball'};
const PITCH_GROUP_LABEL = {FB:'Fastball', BB:'Breaking Ball', OS:'OffSpeed'};
const TRAJ_LABEL = {GB:'Groundball', LD:'Linedrive', FB:'Flyball', PU:'Popup'};

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
/* Small R/L "Side" descriptor shown next to a faced hitter/pitcher name. */
function sideTag(s){ s=String(s==null?'':s).toUpperCase().charAt(0); if(s!=='R'&&s!=='L') return ''; return ' <span class="side-tag">'+s+'</span>'; }
function evSwing(e){ return e && (e.swing==='InPlay'||e.swing==='Whiff'||e.swing==='Foul'); }
function evContact(e){ return e && (e.swing==='InPlay'||e.swing==='Foul'); }
function fmtPct(num, den){ if (!den) return '--'; return ((num/den)*100).toFixed(2)+'%'; }
function fmtDate(d){ if (!d) return 'Undated'; const p=String(d).split('-'); if (p.length!==3) return d; return p[1]+'/'+p[2]+'/'+p[0]; }
/* Label for the top aggregate row: the distinct year(s) the player has data in
   (e.g. "2026"); falls back to "Season" when no dated events exist. */
function yearLabel(dates){
  const ys=Object.keys(dates||{}).map(d=>String(d).slice(0,4)).filter(y=>/^\d{4}$/.test(y));
  const uniq=ys.filter((y,i)=>ys.indexOf(y)===i).sort();
  return uniq.length ? uniq.join(' / ') : 'Season';
}
function locText(e){ return LOC_LABEL[e.location] || (e.inzone?'In Zone':'Out of Zone'); }

function loadState(){
  try {
    if(window._dbReady && Array.isArray(window._dbSessions)) return { sessions: window._dbSessions };
    const r=localStorage.getItem(STORAGE_KEY); if(!r) return {sessions:[]}; const s=JSON.parse(r)||{}; if(!Array.isArray(s.sessions)) s.sessions=[]; return s;
  }
  catch(e){ return {sessions:[]}; }
}

/* hitter -> { all:[events], dates:{ 'yyyy-mm-dd':[events] } } */
function gather(state){
  const map={};
  (state.sessions||[]).forEach(sess=>{
    const date=sess.date||'';
    (sess.events||[]).forEach(ev=>{
      const p=ev.player||''; if(!p) return;
      if(!map[p]) map[p]={all:[],dates:{}};
      map[p].all.push(ev);
      if(!map[p].dates[date]) map[p].dates[date]=[];
      map[p].dates[date].push(ev);
    });
  });
  return map;
}

function computeRow(evs){
  const all=evs.length;
  const swings=evs.filter(evSwing).length;
  const ooz=evs.filter(e=> !e.inzone);
  const oozSw=ooz.filter(evSwing).length;
  const izSw=evs.filter(e=> e.inzone && evSwing(e));
  const izWhiff=izSw.filter(e=> e.swing==='Whiff').length;
  const bip=evs.filter(e=> INPLAY_SET.indexOf(e.pa_outcome)>=0);
  const bN=bip.length;
  const gb=bip.filter(e=> e.batted_ball==='GB').length;
  const ld=bip.filter(e=> e.batted_ball==='LD').length;
  const fb=bip.filter(e=> e.batted_ball==='FB').length;
  const pu=bip.filter(e=> e.batted_ball==='PU').length;
  const hard=bip.filter(e=> e.contact_quality==='Hard').length;
  const cqN=bip.filter(e=> e.contact_quality).length;
  const pa=evs.filter(e=> e.pa_outcome || (Array.isArray(e.result)&&e.result.length));
  const paN=pa.length;
  const hasRes=(e,f)=> Array.isArray(e.result)&&e.result.indexOf(f)>=0;
  const k=pa.filter(e=> hasRes(e,'K')||e.pa_outcome==='K').length;
  const bb=pa.filter(e=> hasRes(e,'BB')||hasRes(e,'iBB')||e.pa_outcome==='BB'||e.pa_outcome==='iBB').length;
  const hr=pa.filter(e=> e.pa_outcome==='HR').length;
  return { events:all,
    swing:fmtPct(swings,all), chase:fmtPct(oozSw,ooz.length), izwhiff:fmtPct(izWhiff,izSw.length),
    gb:fmtPct(gb,bN), ld:fmtPct(ld,bN), fb:fmtPct(fb,bN), pu:fmtPct(pu,bN), hard:fmtPct(hard,cqN),
    k:fmtPct(k,paN), bb:fmtPct(bb,paN), hr:fmtPct(hr,paN) };
}

function headHtml(){
  return '<thead>'
    +'<tr class="grp"><th class="left" colspan="3"></th>'
    +'<th class="grp-swing" colspan="3">Swing Outcomes</th>'
    +'<th class="grp-traj" colspan="4">Hit Trajectory</th>'
    +'<th class="grp-contact" colspan="1">Contact</th>'
    +'<th class="grp-pa" colspan="3">PA Outcome</th></tr>'
    +'<tr><th></th><th class="left">Season / Date</th><th>Events</th>'
    +'<th>Swing%</th><th>Chase%</th><th>IZ Whiff%</th>'
    +'<th>GB%</th><th>LD%</th><th>FB%</th><th>PU%</th>'
    +'<th>Hard Hit%</th>'
    +'<th>K%</th><th>BB%</th><th>HR%</th></tr></thead>';
}
function rowHtml(id,label,r,cls,isYear,ygroup){
  const tog = isYear ? 'data-toggle-year="'+id+'"' : 'data-toggle="'+id+'"';
  const grp = ygroup ? ' data-ygroup="'+ygroup+'" style="display:none"' : '';
  return '<tr class="'+cls+'" data-row="'+id+'"'+grp+'>'
    +'<td><button class="arrow-btn" '+tog+' aria-label="expand">\u25B6</button></td>'
    +'<td class="left">'+esc(label)+'</td>'
    +'<td>'+r.events+'</td>'
    +'<td>'+r.swing+'</td><td>'+r.chase+'</td><td>'+r.izwhiff+'</td>'
    +'<td>'+r.gb+'</td><td>'+r.ld+'</td><td>'+r.fb+'</td><td>'+r.pu+'</td>'
    +'<td>'+r.hard+'</td>'
    +'<td>'+r.k+'</td><td>'+r.bb+'</td><td>'+r.hr+'</td></tr>';
}
function detailHtml(id,evs,ygroup){
  const grp = ygroup ? ' data-ygdet="'+ygroup+'"' : '';
  let t='<table class="detail"><thead><tr>'
    +'<th class="c">#</th><th>Pitcher</th><th>Pitch Group</th><th class="c">Velo</th><th>Location</th><th class="c">Swing</th><th class="c">Contact</th><th>Contact Quality</th><th>Batted Ball</th><th class="c">Batted to</th><th class="c">PA Outcome</th></tr></thead><tbody>';
  evs.forEach((e,i)=>{
    t+='<tr><td class="c">'+(i+1)+'</td>'
      +'<td>'+(e.pitcher?esc(e.pitcher)+sideTag(e.throw_side):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.pitch_group?esc(PITCH_GROUP_LABEL[e.pitch_group]||e.pitch_group):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(e.velo||'<span class="dim">--</span>')+'</td>'
      +'<td>'+esc(locText(e))+'</td>'
      +'<td class="c">'+(evSwing(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(evContact(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.contact_quality||'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.batted_ball?esc(TRAJ_LABEL[e.batted_ball]||e.batted_ball):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(e.batted_to?esc(e.batted_to):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(e.pa_outcome||(Array.isArray(e.result)&&e.result.length?esc(e.result.join('/')):'')||'<span class="dim">--</span>')+'</td></tr>';
  });
  t+='</tbody></table>';
  return '<tr class="detail" id="det_'+id+'"'+grp+' style="display:none"><td colspan="14"><div class="detail-wrap">'+t+'</div></td></tr>';
}

let filterText='';
function render(){
  const state=loadState();
  const map=gather(state);
  let pitchers=Object.keys(map).sort((a,b)=> a.localeCompare(b));
  const total=pitchers.length;
  if(filterText){ const q=filterText.toLowerCase(); pitchers=pitchers.filter(p=> p.toLowerCase().indexOf(q)>=0); }
  const root=$('stats-root');
  const evTotal=(state.sessions||[]).reduce((n,s)=> n+((s.events||[]).length),0);
  $('event-note').textContent = total? (total+' hitter'+(total!==1?'s':'')+' \u2022 '+evTotal+' pitches logged') : '';
  $('count-note').textContent = total? (pitchers.length+' of '+total+' shown') : '';
  if(!total){ root.innerHTML='<div class="status">No pitches logged yet. Open the recorder, log pitches on the strike zone, then come back here.</div>'; return; }
  if(!pitchers.length){ root.innerHTML='<div class="status">No hitters match \u201c'+esc(filterText)+'\u201d.</div>'; return; }
  let html=''; let n=0;
  pitchers.forEach(p=>{
    const info=map[p];
    html+='<div class="player-block"><div class="player-head"><span class="badge">B</span><span class="nm">'+esc(p)+'</span>'
      +'<span class="meta">'+info.all.length+' pitches</span></div><div class="tablewrap"><table class="stats">'+headHtml()+'<tbody>';
    const sid='s'+(n++);
    html+=rowHtml(sid,yearLabel(info.dates),computeRow(info.all),'season',true);
    Object.keys(info.dates).sort((a,b)=> String(b).localeCompare(String(a))).forEach(d=>{
      const did='s'+(n++);
      html+=rowHtml(did,fmtDate(d),computeRow(info.dates[d]),'date',false,sid);
      html+=detailHtml(did,info.dates[d],sid);
    });
    html+='</tbody></table></div></div>';
  });
  root.innerHTML=html;
}

function toast(m){ const t=$('toast'); t.textContent=m; t.className='toast show'; setTimeout(()=> t.className='toast',1600); }

document.addEventListener('click',(e)=>{
  // Year row: uncollapse / collapse all of that player's date rows.
  const yb=e.target.closest('[data-toggle-year]');
  if(yb){
    const g=yb.getAttribute('data-toggle-year');
    const sumRows=document.querySelectorAll('[data-ygroup="'+g+'"]');
    if(!sumRows.length) return;
    let anyHidden=false; sumRows.forEach(r=>{ if(r.style.display==='none') anyHidden=true; });
    sumRows.forEach(r=>{ r.style.display = anyHidden?'':'none'; });
    if(!anyHidden){ // collapsing year -> also hide each date's pitch detail + reset its arrow
      document.querySelectorAll('[data-ygdet="'+g+'"]').forEach(r=> r.style.display='none');
      sumRows.forEach(r=>{ const a=r.querySelector('.arrow-btn'); if(a) a.classList.remove('open'); });
    }
    yb.classList.toggle('open', anyHidden);
    return;
  }
  const b=e.target.closest('[data-toggle]'); if(!b) return;
  const det=document.getElementById('det_'+b.getAttribute('data-toggle')); if(!det) return;
  const open=det.style.display==='none'; det.style.display=open?'':'none'; b.classList.toggle('open',open);
});
$('search').addEventListener('input',(e)=>{ filterText=e.target.value.trim(); render(); });
$('expand-all').addEventListener('click',()=>{ const r=$('stats-root'); if(!r) return; r.querySelectorAll('[data-ygroup]').forEach(d=> d.style.display=''); r.querySelectorAll('tr.detail').forEach(d=> d.style.display=''); r.querySelectorAll('.arrow-btn').forEach(a=> a.classList.add('open')); });
$('collapse-all').addEventListener('click',()=>{ const r=$('stats-root'); if(!r) return; r.querySelectorAll('[data-ygroup]').forEach(d=> d.style.display='none'); r.querySelectorAll('tr.detail').forEach(d=> d.style.display='none'); r.querySelectorAll('.arrow-btn').forEach(a=> a.classList.remove('open')); });
$('refresh').addEventListener('click',()=>{ render(); toast('Refreshed'); });
window.addEventListener('storage',(e)=>{ if(e.key===STORAGE_KEY) render(); });
render();

/* ================= Pitcher Stats tab ================= */
/* Same page, grouped by ev.pitcher instead of ev.player. */
function gatherPitchers(state){
  const map={};
  (state.sessions||[]).forEach(sess=>{
    const date=sess.date||'';
    (sess.events||[]).forEach(ev=>{
      const p=ev.pitcher||''; if(!p) return;
      if(!map[p]) map[p]={all:[],dates:{}};
      map[p].all.push(ev);
      if(!map[p].dates[date]) map[p].dates[date]=[];
      map[p].dates[date].push(ev);
    });
  });
  return map;
}
function computePitcherRow(evs){
  const thrown=evs.length;
  const grouped=evs.filter(e=> e.pitch_group);
  const gN=grouped.length;
  const byG=g=> evs.filter(e=> e.pitch_group===g);
  const fb=byG('FB'), bb=byG('BB'), os=byG('OS');
  const inzoneN=evs.filter(e=>e.inzone).length;
  // usage = share of grouped pitches
  const usage=arr=> fmtPct(arr.length, gN);
  // zone% = in-zone pitches / pitches thrown (of that group)
  const zoneAll=fmtPct(inzoneN, thrown);
  const zoneG=arr=> fmtPct(arr.filter(e=>e.inzone).length, arr.length);
  // chase% = swings on out-of-zone pitches / out-of-zone pitches thrown
  const chase=arr=>{ const ooz=arr.filter(e=>!e.inzone); return fmtPct(ooz.filter(evSwing).length, ooz.length); };
  // whiff% = whiffs / pitches swung at
  const whiff=arr=>{ const sw=arr.filter(evSwing); return fmtPct(sw.filter(e=>e.swing==='Whiff').length, sw.length); };
  // iz whiff% = in-zone whiffs / in-zone pitches swung at
  const izw=arr=>{ const izsw=arr.filter(e=>e.inzone&&evSwing(e)); return fmtPct(izsw.filter(e=>e.swing==='Whiff').length, izsw.length); };
  // trends = K / BB / HR share of plays (plate appearances)
  const pa=evs.filter(e=> e.pa_outcome || (Array.isArray(e.result)&&e.result.length));
  const paN=pa.length;
  const hasRes=(e,f)=> Array.isArray(e.result)&&e.result.indexOf(f)>=0;
  const k=pa.filter(e=> hasRes(e,'K')||e.pa_outcome==='K').length;
  const bbOut=pa.filter(e=> hasRes(e,'BB')||hasRes(e,'iBB')||e.pa_outcome==='BB'||e.pa_outcome==='iBB').length;
  const hr=pa.filter(e=>e.pa_outcome==='HR').length;
  return { events:thrown,
    u_fb:usage(fb), u_bb:usage(bb), u_os:usage(os),
    z_all:zoneAll, z_fb:zoneG(fb), z_bb:zoneG(bb), z_os:zoneG(os),
    c_all:chase(evs), c_fb:chase(fb), c_bb:chase(bb), c_os:chase(os),
    w_all:whiff(evs), w_fb:whiff(fb), w_bb:whiff(bb), w_os:whiff(os),
    iz_all:izw(evs), iz_fb:izw(fb), iz_bb:izw(bb), iz_os:izw(os),
    k:fmtPct(k,paN), bbp:fmtPct(bbOut,paN), hr:fmtPct(hr,paN) };
}
function pheadHtml(){
  return '<thead>'
    +'<tr class="grp"><th class="left" colspan="3"></th>'
    +'<th class="grp-usage" colspan="3">Pitch Usage</th>'
    +'<th class="grp-zone" colspan="4">Strike-Zone%</th>'
    +'<th class="grp-chase" colspan="4">Chase%</th>'
    +'<th class="grp-whiff" colspan="4">Whiff%</th>'
    +'<th class="grp-izw" colspan="4">IZ Whiff%</th>'
    +'<th class="grp-pa" colspan="3">Trends</th></tr>'
    +'<tr><th></th><th class="left">Season / Date</th><th>Pitches</th>'
    +'<th>FB%</th><th>BB%</th><th>OS%</th>'
    +'<th>Zone%</th><th>FB Zone%</th><th>BB Zone%</th><th>OS Zone%</th>'
    +'<th>Overall</th><th>Fastball</th><th>Breaking Ball</th><th>Offspeed</th>'
    +'<th>Overall</th><th>Fastball</th><th>Breaking Ball</th><th>Offspeed</th>'
    +'<th>Overall</th><th>Fastball</th><th>Breaking Ball</th><th>Offspeed</th>'
    +'<th>K%</th><th>BB%</th><th>HR%</th></tr></thead>';
}
function prowHtml(id,label,r,cls,isYear,ygroup){
  const tog = isYear ? 'data-toggle-year="'+id+'"' : 'data-toggle="'+id+'"';
  const grp = ygroup ? ' data-ygroup="'+ygroup+'" style="display:none"' : '';
  return '<tr class="'+cls+'" data-row="'+id+'"'+grp+'>'
    +'<td><button class="arrow-btn" '+tog+' aria-label="expand">\u25B6</button></td>'
    +'<td class="left">'+esc(label)+'</td>'
    +'<td>'+r.events+'</td>'
    +'<td>'+r.u_fb+'</td><td>'+r.u_bb+'</td><td>'+r.u_os+'</td>'
    +'<td>'+r.z_all+'</td><td>'+r.z_fb+'</td><td>'+r.z_bb+'</td><td>'+r.z_os+'</td>'
    +'<td>'+r.c_all+'</td><td>'+r.c_fb+'</td><td>'+r.c_bb+'</td><td>'+r.c_os+'</td>'
    +'<td>'+r.w_all+'</td><td>'+r.w_fb+'</td><td>'+r.w_bb+'</td><td>'+r.w_os+'</td>'
    +'<td>'+r.iz_all+'</td><td>'+r.iz_fb+'</td><td>'+r.iz_bb+'</td><td>'+r.iz_os+'</td>'
    +'<td>'+r.k+'</td><td>'+r.bbp+'</td><td>'+r.hr+'</td></tr>';
}
function pdetailHtml(id,evs,ygroup){
  const grp = ygroup ? ' data-ygdet="'+ygroup+'"' : '';
  let t='<table class="detail"><thead><tr>'
    +'<th class="c">#</th><th>Hitter</th><th>Pitch Group</th><th class="c">Velo</th><th>Location</th><th>Ball/Strike</th><th class="c">Swing</th><th class="c">Contact</th><th>Contact Quality</th><th>Batted Ball</th><th class="c">Batted to</th><th class="c">PA Outcome</th></tr></thead><tbody>';
  evs.forEach((e,i)=>{
    t+='<tr><td class="c">'+(i+1)+'</td>'
      +'<td>'+(e.player?esc(e.player)+sideTag(e.bat_side):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.pitch_group?esc(PITCH_GROUP_LABEL[e.pitch_group]||e.pitch_group):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(e.velo||'<span class="dim">--</span>')+'</td>'
      +'<td>'+esc(locText(e))+'</td>'
      +'<td>'+(e.ball_strike?esc(e.ball_strike):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(evSwing(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(evContact(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.contact_quality||'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.batted_ball?esc(TRAJ_LABEL[e.batted_ball]||e.batted_ball):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(e.batted_to?esc(e.batted_to):'<span class="dim">--</span>')+'</td>'
      +'<td class="c">'+(e.pa_outcome||(Array.isArray(e.result)&&e.result.length?esc(e.result.join('/')):'')||'<span class="dim">--</span>')+'</td></tr>';
  });
  t+='</tbody></table>';
  return '<tr class="detail" id="det_'+id+'"'+grp+' style="display:none"><td colspan="25"><div class="detail-wrap">'+t+'</div></td></tr>';
}
let pfilterText='';
function renderPitcherStats(){
  const state=loadState();
  const map=gatherPitchers(state);
  let names=Object.keys(map).sort((a,b)=>a.localeCompare(b));
  const total=names.length;
  if(pfilterText){ const q=pfilterText.toLowerCase(); names=names.filter(p=>p.toLowerCase().indexOf(q)>=0); }
  const root=$('pstats-root');
  $('pcount-note').textContent= total? (names.length+' of '+total+' shown'):'';
  if(!total){ root.innerHTML='<div class="status">No pitches logged yet. Open the recorder, log pitches on the strike zone, then come back here.</div>'; return; }
  if(!names.length){ root.innerHTML='<div class="status">No pitchers match \u201c'+esc(pfilterText)+'\u201d.</div>'; return; }
  let html=''; let n=0;
  names.forEach(p=>{
    const info=map[p];
    html+='<div class="player-block"><div class="player-head"><span class="badge pbadge">P</span><span class="nm">'+esc(p)+'</span>'
      +'<span class="meta">'+info.all.length+' pitches</span></div><div class="tablewrap"><table class="stats pstats">'+pheadHtml()+'<tbody>';
    const sid='p'+(n++);
    html+=prowHtml(sid,yearLabel(info.dates),computePitcherRow(info.all),'season',true);
    Object.keys(info.dates).sort((a,b)=>String(b).localeCompare(String(a))).forEach(d=>{
      const did='p'+(n++);
      html+=prowHtml(did,fmtDate(d),computePitcherRow(info.dates[d]),'date',false,sid);
      html+=pdetailHtml(did,info.dates[d],sid);
    });
    html+='</tbody></table></div></div>';
  });
  root.innerHTML=html;
}
if($('psearch')) $('psearch').addEventListener('input',(e)=>{ pfilterText=e.target.value.trim(); renderPitcherStats(); });
if($('pexpand-all')) $('pexpand-all').addEventListener('click',()=>{ $('pstats-root').querySelectorAll('[data-ygroup]').forEach(d=>d.style.display=''); $('pstats-root').querySelectorAll('tr.detail').forEach(d=>d.style.display=''); $('pstats-root').querySelectorAll('.arrow-btn').forEach(a=>a.classList.add('open')); });
if($('pcollapse-all')) $('pcollapse-all').addEventListener('click',()=>{ $('pstats-root').querySelectorAll('[data-ygroup]').forEach(d=>d.style.display='none'); $('pstats-root').querySelectorAll('tr.detail').forEach(d=>d.style.display='none'); $('pstats-root').querySelectorAll('.arrow-btn').forEach(a=>a.classList.remove('open')); });
if($('prefresh')) $('prefresh').addEventListener('click',()=>{ renderPitcherStats(); toast('Refreshed'); });
