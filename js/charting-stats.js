/* Standalone Hitter Stats page. Reads the same local data the recorder saves. */
const STORAGE_KEY = 'pitch_recorder_compact_v1';
const $ = id => document.getElementById(id);

const INPLAY_SET = ['1B','2B','3B','HR','OUT','FC','E','DP','SAC','SACF'];
const LOC_LABEL = {InZone:'In Zone', OutOfZone:'Out of Zone', NonComp:'Non-Competitive', IntBall:'Intentional Ball'};
const PITCH_GROUP_LABEL = {FB:'Fastball', BB:'Breaking Ball', OS:'OffSpeed'};
const TRAJ_LABEL = {GB:'Groundball', LD:'Linedrive', FB:'Flyball', PU:'Popup'};

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function evSwing(e){ return e && (e.swing==='InPlay'||e.swing==='Whiff'||e.swing==='Foul'); }
function evContact(e){ return e && (e.swing==='InPlay'||e.swing==='Foul'); }
function fmtPct(num, den){ if (!den) return '--'; return ((num/den)*100).toFixed(2)+'%'; }
function fmtDate(d){ if (!d) return 'Undated'; const p=String(d).split('-'); if (p.length!==3) return d; return p[1]+'/'+p[2]+'/'+p[0]; }
function locText(e){ return LOC_LABEL[e.location] || (e.inzone?'In Zone':'Out of Zone'); }

function loadState(){
  try { const r=localStorage.getItem(STORAGE_KEY); if(!r) return {sessions:[]}; const s=JSON.parse(r)||{}; if(!Array.isArray(s.sessions)) s.sessions=[]; return s; }
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
function rowHtml(id,label,r,cls){
  return '<tr class="'+cls+'" data-row="'+id+'">'
    +'<td><button class="arrow-btn" data-toggle="'+id+'" aria-label="expand">\u25B6</button></td>'
    +'<td class="left">'+esc(label)+'</td>'
    +'<td>'+r.events+'</td>'
    +'<td>'+r.swing+'</td><td>'+r.chase+'</td><td>'+r.izwhiff+'</td>'
    +'<td>'+r.gb+'</td><td>'+r.ld+'</td><td>'+r.fb+'</td><td>'+r.pu+'</td>'
    +'<td>'+r.hard+'</td>'
    +'<td>'+r.k+'</td><td>'+r.bb+'</td><td>'+r.hr+'</td></tr>';
}
function detailHtml(id,evs){
  let t='<table class="detail"><thead><tr>'
    +'<th>#</th><th>Pitch Group</th><th>Velo</th><th>Location</th><th>Swing</th><th>Contact</th><th>Contact Quality</th><th>Batted Ball</th><th>Batted to</th><th>PA Outcome</th></tr></thead><tbody>';
  evs.forEach((e,i)=>{
    t+='<tr><td>'+(i+1)+'</td>'
      +'<td>'+(e.pitch_group?esc(PITCH_GROUP_LABEL[e.pitch_group]||e.pitch_group):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.velo||'<span class="dim">--</span>')+'</td>'
      +'<td>'+esc(locText(e))+'</td>'
      +'<td>'+(evSwing(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td>'+(evContact(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.contact_quality||'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.batted_ball?esc(TRAJ_LABEL[e.batted_ball]||e.batted_ball):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.batted_to?esc(e.batted_to):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.pa_outcome||(Array.isArray(e.result)&&e.result.length?esc(e.result.join('/')):'')||'<span class="dim">--</span>')+'</td></tr>';
  });
  t+='</tbody></table>';
  return '<tr class="detail" id="det_'+id+'" style="display:none"><td colspan="14"><div class="detail-wrap">'+t+'</div></td></tr>';
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
    html+=rowHtml(sid,'Season',computeRow(info.all),'season');
    html+=detailHtml(sid,info.all);
    Object.keys(info.dates).sort((a,b)=> String(b).localeCompare(String(a))).forEach(d=>{
      const did='s'+(n++);
      html+=rowHtml(did,fmtDate(d),computeRow(info.dates[d]),'date');
      html+=detailHtml(did,info.dates[d]);
    });
    html+='</tbody></table></div></div>';
  });
  root.innerHTML=html;
}

function toast(m){ const t=$('toast'); t.textContent=m; t.className='toast show'; setTimeout(()=> t.className='toast',1600); }

document.addEventListener('click',(e)=>{
  const b=e.target.closest('[data-toggle]'); if(!b) return;
  const det=document.getElementById('det_'+b.getAttribute('data-toggle')); if(!det) return;
  const open=det.style.display==='none'; det.style.display=open?'':'none'; b.classList.toggle('open',open);
});
$('search').addEventListener('input',(e)=>{ filterText=e.target.value.trim(); render(); });
$('expand-all').addEventListener('click',()=>{ document.querySelectorAll('tr.detail').forEach(d=> d.style.display=''); document.querySelectorAll('.arrow-btn').forEach(a=> a.classList.add('open')); });
$('collapse-all').addEventListener('click',()=>{ document.querySelectorAll('tr.detail').forEach(d=> d.style.display='none'); document.querySelectorAll('.arrow-btn').forEach(a=> a.classList.remove('open')); });
$('refresh').addEventListener('click',()=>{ render(); toast('Refreshed'); });
window.addEventListener('storage',(e)=>{ if(e.key===STORAGE_KEY) render(); });
window.addEventListener('focus', render);
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
  const fb=grouped.filter(e=>e.pitch_group==='FB').length;
  const bbU=grouped.filter(e=>e.pitch_group==='BB').length;
  const os=grouped.filter(e=>e.pitch_group==='OS').length;
  const inzoneN=evs.filter(e=>e.inzone).length;
  const fbZ=grouped.filter(e=>e.pitch_group==='FB'&&e.inzone).length;
  const bbZ=grouped.filter(e=>e.pitch_group==='BB'&&e.inzone).length;
  const osZ=grouped.filter(e=>e.pitch_group==='OS'&&e.inzone).length;
  const ooz=evs.filter(e=>!e.inzone);
  const oozSw=ooz.filter(evSwing).length;
  const swings=evs.filter(evSwing).length;
  const whiff=evs.filter(e=>e.swing==='Whiff').length;
  const izSw=evs.filter(e=>e.inzone&&evSwing(e));
  const izWhiff=izSw.filter(e=>e.swing==='Whiff').length;
  const pa=evs.filter(e=> e.pa_outcome || (Array.isArray(e.result)&&e.result.length));
  const paN=pa.length;
  const hasRes=(e,f)=> Array.isArray(e.result)&&e.result.indexOf(f)>=0;
  const k=pa.filter(e=> hasRes(e,'K')||e.pa_outcome==='K').length;
  const bbOut=pa.filter(e=> hasRes(e,'BB')||hasRes(e,'iBB')||e.pa_outcome==='BB'||e.pa_outcome==='iBB').length;
  const hr=pa.filter(e=>e.pa_outcome==='HR').length;
  return { events:thrown,
    fb:fmtPct(fb,gN), bb:fmtPct(bbU,gN), os:fmtPct(os,gN),
    zone:fmtPct(inzoneN,thrown), fbz:fmtPct(fbZ,fb), bbz:fmtPct(bbZ,bbU), osz:fmtPct(osZ,os),
    chase:fmtPct(oozSw,ooz.length), whiff:fmtPct(whiff,swings), izwhiff:fmtPct(izWhiff,izSw.length),
    k:fmtPct(k,paN), bbp:fmtPct(bbOut,paN), hr:fmtPct(hr,paN) };
}
function pheadHtml(){
  return '<thead>'
    +'<tr class="grp"><th class="left" colspan="3"></th>'
    +'<th class="grp-usage" colspan="3">Pitch Usage</th>'
    +'<th class="grp-zone" colspan="4">Strike-Zone%</th>'
    +'<th class="grp-sm" colspan="3">Swing / Miss</th>'
    +'<th class="grp-pa" colspan="3">Trends</th></tr>'
    +'<tr><th></th><th class="left">Season / Date</th><th>Pitches</th>'
    +'<th>FB%</th><th>BB%</th><th>OS%</th>'
    +'<th>Zone%</th><th>FB Zone%</th><th>BB Zone%</th><th>OS Zone%</th>'
    +'<th>Chase%</th><th>Whiff%</th><th>IZ Whiff%</th>'
    +'<th>K%</th><th>BB%</th><th>HR%</th></tr></thead>';
}
function prowHtml(id,label,r,cls){
  return '<tr class="'+cls+'" data-row="'+id+'">'
    +'<td><button class="arrow-btn" data-toggle="'+id+'" aria-label="expand">\u25B6</button></td>'
    +'<td class="left">'+esc(label)+'</td>'
    +'<td>'+r.events+'</td>'
    +'<td>'+r.fb+'</td><td>'+r.bb+'</td><td>'+r.os+'</td>'
    +'<td>'+r.zone+'</td><td>'+r.fbz+'</td><td>'+r.bbz+'</td><td>'+r.osz+'</td>'
    +'<td>'+r.chase+'</td><td>'+r.whiff+'</td><td>'+r.izwhiff+'</td>'
    +'<td>'+r.k+'</td><td>'+r.bbp+'</td><td>'+r.hr+'</td></tr>';
}
function pdetailHtml(id,evs){
  let t='<table class="detail"><thead><tr>'
    +'<th>#</th><th>Pitch Group</th><th>Velo</th><th>Location</th><th>Swing</th><th>Ball/Strike</th><th>Batter</th><th>PA Outcome</th></tr></thead><tbody>';
  evs.forEach((e,i)=>{
    t+='<tr><td>'+(i+1)+'</td>'
      +'<td>'+(e.pitch_group?esc(PITCH_GROUP_LABEL[e.pitch_group]||e.pitch_group):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.velo||'<span class="dim">--</span>')+'</td>'
      +'<td>'+esc(locText(e))+'</td>'
      +'<td>'+(evSwing(e)?'<span class="chk">\u2713</span>':'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.ball_strike?esc(e.ball_strike):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.player?esc(e.player):'<span class="dim">--</span>')+'</td>'
      +'<td>'+(e.pa_outcome||(Array.isArray(e.result)&&e.result.length?esc(e.result.join('/')):'')||'<span class="dim">--</span>')+'</td></tr>';
  });
  t+='</tbody></table>';
  return '<tr class="detail" id="det_'+id+'" style="display:none"><td colspan="16"><div class="detail-wrap">'+t+'</div></td></tr>';
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
    html+=prowHtml(sid,'Season',computePitcherRow(info.all),'season');
    html+=pdetailHtml(sid,info.all);
    Object.keys(info.dates).sort((a,b)=>String(b).localeCompare(String(a))).forEach(d=>{
      const did='p'+(n++);
      html+=prowHtml(did,fmtDate(d),computePitcherRow(info.dates[d]),'date');
      html+=pdetailHtml(did,info.dates[d]);
    });
    html+='</tbody></table></div></div>';
  });
  root.innerHTML=html;
}
if($('psearch')) $('psearch').addEventListener('input',(e)=>{ pfilterText=e.target.value.trim(); renderPitcherStats(); });
if($('pexpand-all')) $('pexpand-all').addEventListener('click',()=>{ $('pstats-root').querySelectorAll('tr.detail').forEach(d=>d.style.display=''); $('pstats-root').querySelectorAll('.arrow-btn').forEach(a=>a.classList.add('open')); });
if($('pcollapse-all')) $('pcollapse-all').addEventListener('click',()=>{ $('pstats-root').querySelectorAll('tr.detail').forEach(d=>d.style.display='none'); $('pstats-root').querySelectorAll('.arrow-btn').forEach(a=>a.classList.remove('open')); });
if($('prefresh')) $('prefresh').addEventListener('click',()=>{ renderPitcherStats(); toast('Refreshed'); });
