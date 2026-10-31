/* ================= Spray Chart & Heat Maps tab ================= */
const INPLAY_LOC = ['1B','2B','3B','HR','OUT','FC','E','DP','SAC','SACF'];
const FH={x:200,y:372};
function fpt(deg,r){ const t=deg*Math.PI/180; return {x:FH.x+r*Math.sin(t), y:FH.y-r*Math.cos(t)}; }
function ff(n){ return n.toFixed(1); }
function fsector(d1,d2,rIn,rOut){
  const steps=Math.max(2,Math.ceil(Math.abs(d2-d1)/4));
  const out=[],inn=[];
  for(let i=0;i<=steps;i++) out.push(fpt(d1+(d2-d1)*i/steps,rOut));
  for(let i=steps;i>=0;i--) inn.push(fpt(d1+(d2-d1)*i/steps,rIn));
  return 'M'+out.concat(inn).map(p=>ff(p.x)+','+ff(p.y)).join(' L')+' Z';
}
const FSECTIONS=[
  {pos:'LF',num:'7',d1:-45,d2:-15,rIn:150,rOut:232,cls:'fs-grass'},
  {pos:'CF',num:'8',d1:-15,d2:15,rIn:150,rOut:232,cls:'fs-grass'},
  {pos:'RF',num:'9',d1:15,d2:45,rIn:150,rOut:232,cls:'fs-grass'},
  {pos:'3B',num:'5',d1:-45,d2:-22.5,rIn:58,rOut:150,cls:'fs-dirt'},
  {pos:'SS',num:'6',d1:-22.5,d2:0,rIn:58,rOut:150,cls:'fs-dirt'},
  {pos:'2B',num:'4',d1:0,d2:22.5,rIn:58,rOut:150,cls:'fs-dirt'},
  {pos:'1B',num:'3',d1:22.5,d2:45,rIn:58,rOut:150,cls:'fs-dirt'}
];
const POS_CENT={
  '1':fpt(0,96),'2':fpt(0,30),'3':fpt(33.75,104),'4':fpt(11.25,104),
  '5':fpt(-33.75,104),'6':fpt(-11.25,104),'7':fpt(-30,191),'8':fpt(0,191),'9':fpt(30,191)
};
const SECT_BY_NUM={};
FSECTIONS.forEach(s=> SECT_BY_NUM[s.num]=s);
SECT_BY_NUM['1']={pos:'P',num:'1',d1:-12,d2:12,rIn:66,rOut:126};
SECT_BY_NUM['2']={pos:'C',num:'2',d1:-45,d2:45,rIn:0,rOut:58};

const RESULT_CATS=[
  {key:'out',label:'Out / E',color:'#2bb5a0',set:['OUT','E','FC','DP','SAC','SACF'],desc:'Outs, errors, fielder\u2019s choice, double plays & sacrifices'},
  {key:'1B',label:'Single',color:'#8fc2ff',set:['1B'],desc:'Base hit \u2014 reached first base'},
  {key:'2B',label:'Double',color:'#9b6bd6',set:['2B'],desc:'Extra-base hit \u2014 reached second base'},
  {key:'3B',label:'Triple',color:'#f0a44e',set:['3B'],desc:'Extra-base hit \u2014 reached third base'},
  {key:'HR',label:'Home Run',color:'#7b2d43',set:['HR'],desc:'Ball cleared the fence'}
];
const TRAJ_CATS=[
  {key:'GB',label:'Groundball',color:'#b5793c'},
  {key:'LD',label:'Linedrive',color:'#4f9dff'},
  {key:'FB',label:'Flyball',color:'#f0c828'},
  {key:'PU',label:'Popup',color:'#9b6bd6'}
];

let sprayMode='result';
let sprayPlayer='';

function battedBalls(evs){
  return evs.filter(e=> INPLAY_LOC.indexOf(e.pa_outcome)>=0).map(e=>{
    let pos = e.batted_to!=null && e.batted_to!=='' ? String(e.batted_to) : (e.pa_outcome==='HR'?'8':'');
    return { pos, pa:e.pa_outcome, bb:e.batted_ball||'', e };
  }).filter(b=> b.pos && POS_CENT[b.pos]);
}
function resultCat(pa){ return RESULT_CATS.find(c=> c.set.indexOf(pa)>=0) || null; }
function catColor(b){
  if(sprayMode==='result'){ const c=resultCat(b.pa); return c?c.color:'#888'; }
  const c=TRAJ_CATS.find(c=> c.key===b.bb); return c?c.color:'#8a93a0';
}
const FIELDER_NOUN={'1':'Pitcher','2':'Catcher','3':'First Baseman','4':'Second Baseman','5':'Third Baseman','6':'Shortstop','7':'Left Fielder','8':'Center Fielder','9':'Right Fielder'};
const BB_HOVER={GB:'Ground Ball',LD:'Line Drive',FB:'Fly Ball',PU:'Pop Up'};
function playInfoText(e){
  const parts=[];
  const pg=e.pitch_group||'';
  if(pg && e.velo!=null && e.velo!=='') parts.push(pg+' '+e.velo);
  else if(pg) parts.push(pg);
  else if(e.velo!=null && e.velo!=='') parts.push(String(e.velo));
  const rc=resultCat(e.pa_outcome); parts.push(rc?rc.label:(e.pa_outcome||''));
  if(e.batted_ball) parts.push(BB_HOVER[e.batted_ball]||e.batted_ball);
  if(e.contact_quality) parts.push(e.contact_quality);
  let s=parts.filter(Boolean).join(' \u00b7 ');
  const pos = e.batted_to!=null&&e.batted_to!=='' ? String(e.batted_to) : (e.pa_outcome==='HR'?'8':'');
  const noun=FIELDER_NOUN[pos];
  if(noun) s+=' -- To '+noun;
  return s;
}

function posFullName(num){
  const map={'1':'Pitcher','2':'Catcher','3':'First Base','4':'Second Base','5':'Third Base','6':'Shortstop','7':'Left Field','8':'Center Field','9':'Right Field'};
  return map[num]||'';
}
function sectTitle(num,counts,total){
  const s=SECT_BY_NUM[num]; if(!s) return '';
  const cnt=counts[num]||0; const pct= total? Math.round(cnt/total*100):0;
  return esc(posFullName(num)+' ('+s.pos+') \u2014 '+cnt+' ball'+(cnt!==1?'s':'')+(total?' \u00b7 '+pct+'%':''));
}
function buildSprayField(balls){
  const counts={}; let total=balls.length;
  balls.forEach(b=>{ counts[b.pos]=(counts[b.pos]||0)+1; });
  let maxC=0; Object.keys(counts).forEach(k=>{ if(counts[k]>maxC) maxC=counts[k]; });
  let svg='<svg viewBox="0 0 400 400" class="spray-svg" preserveAspectRatio="xMidYMid meet">';
  svg+='<defs><linearGradient id="spGrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#53a96c"/><stop offset="100%" stop-color="#2f8049"/></linearGradient>'
    +'<linearGradient id="spDirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d8ab74"/><stop offset="100%" stop-color="#bd8a53"/></linearGradient></defs>';
  svg+='<rect x="0" y="0" width="400" height="400" fill="#15243a"/>';
  svg+='<path d="'+fsector(-45,45,0,232)+'" fill="url(#spGrass)" pointer-events="none"/>';
  for(let k=0;k<6;k++){ if(k%2===0){ const a1=-45+k*15; svg+='<path d="'+fsector(a1,a1+15,0,232)+'" fill="rgba(255,255,255,0.035)" pointer-events="none"/>'; } }
  svg+='<path d="'+fsector(-45,45,224,232)+'" fill="rgba(168,120,72,0.5)" pointer-events="none"/>';
  svg+='<path d="'+fsector(-45,45,0,150)+'" fill="url(#spDirt)" pointer-events="none"/>';
  FSECTIONS.forEach(s=>{ svg+='<path class="fs-sect '+(s.cls==='fs-grass'?'fs-grass':'fs-dirt')+'" d="'+fsector(s.d1,s.d2,s.rIn,s.rOut)+'"><title>'+sectTitle(s.num,counts,total)+'</title></path>'; });
  svg+='<path class="fs-sect fs-home" d="'+fsector(-45,45,0,58)+'"><title>'+sectTitle('2',counts,total)+'</title></path>';
  const gh=fpt(0,24),gg1=fpt(45,72),gg2=fpt(0,108),gg3=fpt(-45,72);
  svg+='<polygon points="'+ff(gh.x)+','+ff(gh.y)+' '+ff(gg1.x)+','+ff(gg1.y)+' '+ff(gg2.x)+','+ff(gg2.y)+' '+ff(gg3.x)+','+ff(gg3.y)+'" fill="url(#spGrass)" pointer-events="none"/>';
  const m=fpt(0,96); svg+='<circle class="fs-sect fs-mound" cx="'+ff(m.x)+'" cy="'+ff(m.y)+'" r="18"><title>'+sectTitle('1',counts,total)+'</title></circle>';
  const lfp=fpt(-45,232), rfp=fpt(45,232);
  svg+='<line x1="'+ff(FH.x)+'" y1="'+ff(FH.y)+'" x2="'+ff(lfp.x)+'" y2="'+ff(lfp.y)+'" class="fs-foul"/>';
  svg+='<line x1="'+ff(FH.x)+'" y1="'+ff(FH.y)+'" x2="'+ff(rfp.x)+'" y2="'+ff(rfp.y)+'" class="fs-foul"/>';
  let fence=[]; for(let d=-45;d<=45;d+=3) fence.push(fpt(d,232));
  svg+='<polyline points="'+fence.map(p=>ff(p.x)+','+ff(p.y)).join(' ')+'" class="fs-fence"/>';
  const b1=fpt(45,92),b2=fpt(0,130),b3=fpt(-45,92);
  svg+='<polygon points="'+ff(FH.x)+','+ff(FH.y)+' '+ff(b1.x)+','+ff(b1.y)+' '+ff(b2.x)+','+ff(b2.y)+' '+ff(b3.x)+','+ff(b3.y)+'" class="fs-diamond"/>';
  const sbase=(b)=>'<polygon points="'+ff(b.x)+','+ff(b.y-4.5)+' '+ff(b.x+4.5)+','+ff(b.y)+' '+ff(b.x)+','+ff(b.y+4.5)+' '+ff(b.x-4.5)+','+ff(b.y)+'" class="fs-basemk"/>';
  svg+=sbase(b1)+sbase(b2)+sbase(b3);
  svg+='<polygon points="'+ff(FH.x)+','+ff(FH.y-5)+' '+ff(FH.x+5)+','+ff(FH.y-1)+' '+ff(FH.x+3.5)+','+ff(FH.y+5)+' '+ff(FH.x-3.5)+','+ff(FH.y+5)+' '+ff(FH.x-5)+','+ff(FH.y-1)+'" class="fs-basemk"/>';
  const perPos={};
  balls.forEach(b=>{
    let cx, cy; const e=b.e;
    if(e && typeof e.hit_x==='number' && typeof e.hit_y==='number'){
      // Map the actual landing point from the charting field (viewBox 424x460,
      // home at 212,418, fence r=300) into this spray chart (home 200,372, fence r=232).
      const fx=e.hit_x*424, fy=e.hit_y*460; const dx=fx-212, up=418-fy;
      const ang2=Math.atan2(dx,up); const rad2=Math.hypot(dx,up)/300*232;
      cx=200+rad2*Math.sin(ang2); cy=372-rad2*Math.cos(ang2);
    } else {
      const c=POS_CENT[b.pos]; const i=(perPos[b.pos]=(perPos[b.pos]||0)+1)-1;
      const ring=Math.floor(i/6); const ang=(i%6)*(Math.PI/3)+ring*0.5;
      const rad=ring? (10+ring*9):(i? 9:0);
      cx=c.x+Math.cos(ang)*rad; cy=c.y+Math.sin(ang)*rad;
    }
    const ttl = esc(playInfoText(b.e));
    svg+='<circle class="fs-dot" cx="'+ff(cx)+'" cy="'+ff(cy)+'" r="6" fill="'+catColor(b)+'" stroke="rgba(0,0,0,0.5)" stroke-width="1"><title>'+ttl+'</title></circle>';
  });
  FSECTIONS.concat([SECT_BY_NUM['1'],SECT_BY_NUM['2']]).forEach(s=>{
    const c = s.num==='1'?fpt(0,96):(s.num==='2'?fpt(0,30):fpt((s.d1+s.d2)/2,(s.rIn+s.rOut)/2));
    const cnt=counts[s.num]||0; const pct= total? Math.round(cnt/total*100):0;
    svg+='<text x="'+ff(c.x)+'" y="'+ff(c.y-7)+'" class="fs-lbl">'+s.pos+'</text>';
    if(cnt) svg+='<text x="'+ff(c.x)+'" y="'+ff(c.y+9)+'" class="fs-pct">'+pct+'%</text>';
  });
  svg+='</svg>';
  return svg;
}

function buildSprayLegend(balls){
  const total=balls.length;
  const cats = sprayMode==='result'? RESULT_CATS : TRAJ_CATS;
  let rows='';
  cats.forEach(c=>{
    let n;
    if(sprayMode==='result') n=balls.filter(b=> c.set.indexOf(b.pa)>=0).length;
    else n=balls.filter(b=> b.bb===c.key).length;
    const pct= total? ((n/total*100).toFixed(1)+'%') : '0%';
    const desc = c.desc? '<span class="lg-desc">'+esc(c.desc)+'</span>' : '';
    rows+='<div class="lg-item"><span class="lg-sw" style="background:'+c.color+'"></span>'
      +'<span class="lg-lbl">'+c.label+desc+'</span><span class="lg-val">'+n+' \u00b7 '+pct+'</span></div>';
  });
  if(sprayMode==='traj'){ const unk=balls.filter(b=> TRAJ_CATS.every(c=>c.key!==b.bb)).length; if(unk) rows+='<div class="lg-item"><span class="lg-sw" style="background:#8a93a0"></span><span class="lg-lbl">Unspecified</span><span class="lg-val">'+unk+'</span></div>'; }
  return rows + '<div class="lg-total">'+total+' batted ball'+(total!==1?'s':'')+'</div>';
}

const QVAL={Weak:0,Bunt:0,Avg:0.5,Hard:1};
function mix(a,b,t){ return [Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t)]; }
function qColor(q){ if(q<=0.5){ return mix([46,110,230],[240,210,60],q/0.5); } return mix([240,210,60],[225,45,45],(q-0.5)/0.5); }
let _heatGrid=null;
function drawHeat(evs){
  const cv=$('heat-canvas'); if(!cv) return; let ctx; try{ ctx=cv.getContext('2d'); }catch(e){ ctx=null; } if(!ctx) return; const W=cv.width,H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#07121b'; ctx.fillRect(0,0,W,H);
  _heatGrid=null;
  const pts=evs.filter(e=> INPLAY_LOC.indexOf(e.pa_outcome)>=0 && e.pitch_x!=null && e.pitch_y!=null && (e.contact_quality in QVAL))
    .map(e=>({x:e.pitch_x/100*W, y:e.pitch_y/100*H, q:QVAL[e.contact_quality]}));
  if(pts.length){
    const GW=60, GH=72, sig=4.2;
    const wsum=new Float32Array(GW*GH), qsum=new Float32Array(GW*GH);
    pts.forEach(p=>{
      const gx=p.x/W*GW, gy=p.y/H*GH;
      const x0=Math.max(0,Math.floor(gx-sig*3)), x1=Math.min(GW-1,Math.ceil(gx+sig*3));
      const y0=Math.max(0,Math.floor(gy-sig*3)), y1=Math.min(GH-1,Math.ceil(gy+sig*3));
      for(let yy=y0;yy<=y1;yy++) for(let xx=x0;xx<=x1;xx++){
        const d2=(xx+0.5-gx)*(xx+0.5-gx)+(yy+0.5-gy)*(yy+0.5-gy);
        const w=Math.exp(-d2/(2*sig*sig)); const idx=yy*GW+xx;
        wsum[idx]+=w; qsum[idx]+=w*p.q;
      }
    });
    let peak=0; for(let i=0;i<wsum.length;i++) if(wsum[i]>peak) peak=wsum[i];
    const small=document.createElement('canvas'); small.width=GW; small.height=GH;
    const sctx=small.getContext('2d'); const img=sctx.createImageData(GW,GH);
    for(let i=0;i<wsum.length;i++){
      const w=wsum[i]; const o=i*4;
      if(w<0.04){ img.data[o+3]=0; continue; }
      const q=qsum[i]/w; const col=qColor(q);
      const a=Math.min(0.9, 0.18+0.82*(w/(peak||1)));
      img.data[o]=col[0]; img.data[o+1]=col[1]; img.data[o+2]=col[2]; img.data[o+3]=Math.round(a*255);
    }
    sctx.putImageData(img,0,0);
    ctx.imageSmoothingEnabled=true; ctx.drawImage(small,0,0,GW,GH,0,0,W,H);
    _heatGrid={GW,GH,wsum,qsum,peak,n:pts.length};
  }
  const zx=0.28*W, zy=0.22*H, zw=0.44*W, zh=0.50*H;
  ctx.strokeStyle='rgba(230,240,255,0.85)'; ctx.lineWidth=2; ctx.strokeRect(zx,zy,zw,zh);
  ctx.strokeStyle='rgba(230,240,255,0.35)'; ctx.lineWidth=1;
  for(let i=1;i<3;i++){ ctx.beginPath(); ctx.moveTo(zx+zw*i/3,zy); ctx.lineTo(zx+zw*i/3,zy+zh); ctx.stroke(); ctx.beginPath(); ctx.moveTo(zx,zy+zh*i/3); ctx.lineTo(zx+zw,zy+zh*i/3); ctx.stroke(); }
}
function buildHeatLegend(evs){
  const pts=evs.filter(e=> INPLAY_LOC.indexOf(e.pa_outcome)>=0 && (e.contact_quality in QVAL));
  const total=pts.length;
  const cats=[{k:'Weak',c:'rgb(46,110,230)'},{k:'Avg',c:'rgb(240,210,60)'},{k:'Hard',c:'rgb(225,45,45)'}];
  let rows='';
  cats.forEach(c=>{ let n= c.k==='Weak'? pts.filter(e=> e.contact_quality==='Weak'||e.contact_quality==='Bunt').length : pts.filter(e=> e.contact_quality===c.k).length;
    const pct= total? ((n/total*100).toFixed(1)+'%'):'0%';
    rows+='<div class="lg-item"><span class="lg-sw" style="background:'+c.c+'"></span><span class="lg-lbl">'+c.k+(c.k==='Weak'?' / Bunt':'')+'</span><span class="lg-val">'+n+' \u00b7 '+pct+'</span></div>'; });
  return rows+'<div class="lg-total">'+total+' batted ball'+(total!==1?'s':'')+' with contact quality</div>';
}

function populateSprayPlayers(map){
  const seldom=$('spray-player'); if(!seldom) return;
  const names=Object.keys(map).sort((a,b)=> a.localeCompare(b));
  const prev=sprayPlayer && names.indexOf(sprayPlayer)>=0 ? sprayPlayer : (names[0]||'');
  sprayPlayer=prev;
  seldom.innerHTML = names.length? names.map(n=>'<option value="'+esc(n)+'"'+(n===prev?' selected':'')+'>'+esc(n)+'</option>').join('') : '<option value="">No hitters yet</option>';
}
function renderSpray(){
  const state=loadState(); const map=gather(state);
  populateSprayPlayers(map);
  const field=$('spray-field'); const note=$('spray-note');
  if(!sprayPlayer || !map[sprayPlayer]){
    if(field) field.innerHTML='<div class="status">No batted-ball data yet. Log In-Play pitches and record them on the field.</div>';
    $('spray-legend').innerHTML=''; $('heat-legend').innerHTML='';
    const cv=$('heat-canvas'); if(cv){ let ctx; try{ ctx=cv.getContext('2d'); }catch(e){ ctx=null; } if(ctx){ ctx.clearRect(0,0,cv.width,cv.height); ctx.fillStyle='#07121b'; ctx.fillRect(0,0,cv.width,cv.height); } }
    if(note) note.textContent=''; return;
  }
  let evs=map[sprayPlayer].all;
  populateSprayVs(evs);
  if(sprayVs) evs=evs.filter(e=> e.pitcher===sprayVs);
  const balls=battedBalls(evs);
  if(note) note.textContent = balls.length+' batted ball'+(balls.length!==1?'s':'');
  field.innerHTML = buildSprayField(balls);
  $('spray-legend').innerHTML = buildSprayLegend(balls);
  drawHeat(evs);
  $('heat-legend').innerHTML = buildHeatLegend(evs);
}

document.querySelectorAll('.stab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const which=btn.getAttribute('data-stab');
    document.querySelectorAll('.stab').forEach(b=> b.classList.toggle('active', b===btn));
    document.querySelectorAll('.stab-panel').forEach(p=> p.classList.remove('active'));
    const panel=$('stab-'+which); if(panel) panel.classList.add('active');
    if(which==='spray') renderSpray();
    else if(which==='pstats'){ if(typeof renderPitcherStats==='function') renderPitcherStats(); }
    else if(which==='pviz') renderPitcherViz();
  });
});
const spm=$('spray-mode');
if(spm) spm.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{
  sprayMode=b.getAttribute('data-mode');
  spm.querySelectorAll('button').forEach(x=> x.classList.toggle('active', x===b));
  renderSpray();
}));
const spp=$('spray-player');
if(spp) spp.addEventListener('change', ()=>{ sprayPlayer=spp.value; renderSpray(); });

/* ---- heat-map hover tooltip ---- */
function qLabel(q){ if(q<0.34) return 'Weak contact'; if(q<0.67) return 'Average contact'; return 'Hard contact'; }
(function initHeatTip(){
  const cv=$('heat-canvas'); if(!cv) return;
  let tip=null;
  function ensureTip(){ if(tip) return tip; tip=document.createElement('div'); tip.className='heat-tip'; (cv.parentNode||document.body).appendChild(tip); return tip; }
  cv.addEventListener('mousemove', (ev)=>{
    if(!_heatGrid){ if(tip) tip.style.display='none'; return; }
    const r=cv.getBoundingClientRect();
    const px=(ev.clientX-r.left)/r.width, py=(ev.clientY-r.top)/r.height;
    const gx=Math.min(_heatGrid.GW-1,Math.max(0,Math.floor(px*_heatGrid.GW)));
    const gy=Math.min(_heatGrid.GH-1,Math.max(0,Math.floor(py*_heatGrid.GH)));
    const idx=gy*_heatGrid.GW+gx; const w=_heatGrid.wsum[idx];
    const t=ensureTip();
    if(w<0.04){ t.style.display='none'; return; }
    const q=_heatGrid.qsum[idx]/w; const dens=Math.round(w/(_heatGrid.peak||1)*100);
    t.innerHTML='<b>'+qLabel(q)+'</b><br>Density '+dens+'%';
    t.style.display='block';
    t.style.left=(ev.clientX-r.left+12)+'px';
    t.style.top=(ev.clientY-r.top+12)+'px';
  });
  cv.addEventListener('mouseleave', ()=>{ if(tip) tip.style.display='none'; });
})();

/* ================= matchup filter: Spray vs Pitcher ================= */
let sprayVs='';
function populateSprayVs(evs){
  const sel=$('spray-vs'); if(!sel) return;
  const pitchers=Array.from(new Set(evs.map(e=>e.pitcher).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  if(sprayVs && pitchers.indexOf(sprayVs)<0) sprayVs='';
  sel.innerHTML='<option value="">All pitchers</option>'+pitchers.map(p=>'<option value="'+esc(p)+'"'+(p===sprayVs?' selected':'')+'>'+esc(p)+'</option>').join('');
}
const spv=$('spray-vs');
if(spv) spv.addEventListener('change', ()=>{ sprayVs=spv.value; renderSpray(); });

/* ================= Pitcher Visualization tab ================= */
let pvizMode='result', pvizPlayer='', pvizVs='';
const PTYPE_COLOR={FB:'#e11919',BB:'#f0c828',OS:'#4ade80'};
const PRES_COLOR={Whiff:'#e11919',CalledStrike:'#f28b8b',Ball:'#4ade80',Foul:'#f0c828',Other:'#8a93a0'};
function pitchResult(e){
  if(e.swing==='Whiff') return 'Whiff';
  if(e.swing==='Foul') return 'Foul';
  if(e.swing==='InPlay') return 'InPlay';
  if(e.ball_strike==='Ball') return 'Ball';
  if(e.ball_strike==='Strike') return 'CalledStrike';
  return 'Other';
}
function pvizColor(e){
  if(pvizMode==='type') return PTYPE_COLOR[e.pitch_group]||'#8a93a0';
  const r=pitchResult(e);
  if(r==='InPlay'){ const c=resultCat(e.pa_outcome); return c?c.color:'#8a93a0'; }
  return PRES_COLOR[r]||'#8a93a0';
}
function pvizResultLabel(e){
  const r=pitchResult(e);
  if(r==='InPlay'){ const c=resultCat(e.pa_outcome); return c?c.label:(e.pa_outcome||'In Play'); }
  return ({Whiff:'Whiff',CalledStrike:'Called Strike',Ball:'Ball',Foul:'Foul'})[r]||'\u2014';
}
function pvizHover(e){
  const parts=[];
  const pg=e.pitch_group||'';
  if(pg && e.velo!=null && e.velo!=='') parts.push(pg+' '+e.velo);
  else if(pg) parts.push(pg);
  else if(e.velo!=null && e.velo!=='') parts.push(String(e.velo));
  parts.push(pvizResultLabel(e));
  if(e.batted_ball) parts.push(BB_HOVER[e.batted_ball]||e.batted_ball);
  if(e.contact_quality) parts.push(e.contact_quality);
  let s=parts.filter(Boolean).join(' \u00b7 ');
  if(e.swing==='InPlay'){
    const pos=e.batted_to!=null&&e.batted_to!==''?String(e.batted_to):(e.pa_outcome==='HR'?'8':'');
    const noun=FIELDER_NOUN[pos]; if(noun) s+=' -- To '+noun;
  }
  if(e.player) s+=' (vs '+e.player+')';
  return s;
}
function buildPvizZone(evs){
  const W=300,H=360;
  const pts=evs.filter(e=> e.pitch_x!=null && e.pitch_y!=null);
  let svg='<svg viewBox="0 0 '+W+' '+H+'" class="pviz-svg" preserveAspectRatio="xMidYMid meet">';
  svg+='<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="#07121b"/>';
  // Strike-zone box drawn at the SAME ratios the charting tool uses to place
  // pitches: a 130x164 zone inside a 500x460 area, centered at 50%/47%.
  // (Previously the box was wider/taller than the real zone, which made pitches
  // look closer to the zone than they actually were.)
  const zw=0.26*W, zh=(164/460)*H, zx=(0.50-0.13)*W, zy=(0.47-(164/460)/2)*H;
  svg+='<rect x="'+zx+'" y="'+zy+'" width="'+zw+'" height="'+zh+'" fill="rgba(56,189,248,0.04)" stroke="rgba(230,240,255,0.85)" stroke-width="2"/>';
  for(let i=1;i<3;i++){
    svg+='<line x1="'+ff(zx+zw*i/3)+'" y1="'+ff(zy)+'" x2="'+ff(zx+zw*i/3)+'" y2="'+ff(zy+zh)+'" stroke="rgba(230,240,255,0.3)" stroke-width="1"/>';
    svg+='<line x1="'+ff(zx)+'" y1="'+ff(zy+zh*i/3)+'" x2="'+ff(zx+zw)+'" y2="'+ff(zy+zh*i/3)+'" stroke="rgba(230,240,255,0.3)" stroke-width="1"/>';
  }
  pts.forEach(e=>{
    const cx=e.pitch_x/100*W, cy=e.pitch_y/100*H;
    const ttl=esc(pvizHover(e));
    svg+='<circle cx="'+ff(cx)+'" cy="'+ff(cy)+'" r="6.5" fill="'+pvizColor(e)+'" stroke="rgba(0,0,0,0.5)" stroke-width="1" class="fs-dot"><title>'+ttl+'</title></circle>';
    if(e.swing==='Whiff'){
      svg+='<path d="M'+ff(cx-3)+','+ff(cy-3)+' L'+ff(cx+3)+','+ff(cy+3)+' M'+ff(cx+3)+','+ff(cy-3)+' L'+ff(cx-3)+','+ff(cy+3)+'" stroke="#fff" stroke-width="1.7" stroke-linecap="round" pointer-events="none"/>';
    }
  });
  svg+='</svg>';
  return svg;
}
function buildPvizLegend(evs){
  const total=evs.length; let rows='';
  if(pvizMode==='type'){
    [['FB','Fastball'],['BB','Breaking Ball'],['OS','OffSpeed']].forEach(function(d){
      const n=evs.filter(e=>e.pitch_group===d[0]).length; const pct= total?((n/total*100).toFixed(1)+'%'):'0%';
      rows+='<div class="lg-item"><span class="lg-sw" style="background:'+PTYPE_COLOR[d[0]]+'"></span><span class="lg-lbl">'+d[1]+'</span><span class="lg-val">'+n+' \u00b7 '+pct+'</span></div>';
    });
  } else {
    [['Whiff','Whiff','#e11919'],['CalledStrike','Called Strike','#f28b8b'],['Ball','Ball','#4ade80'],['Foul','Foul','#f0c828'],['out','Out / E / FC / DP / SAC / SACF','#2bb5a0'],['1B','Single','#8fc2ff'],['2B','Double','#9b6bd6'],['3B','Triple','#f0a44e'],['HR','Home Run','#7b2d43']].forEach(function(d){
      let n;
      if(d[0]==='out') n=evs.filter(e=>e.swing==='InPlay' && RESULT_CATS[0].set.indexOf(e.pa_outcome)>=0).length;
      else if(d[0]==='1B'||d[0]==='2B'||d[0]==='3B'||d[0]==='HR') n=evs.filter(e=>e.swing==='InPlay' && e.pa_outcome===d[0]).length;
      else n=evs.filter(e=>pitchResult(e)===d[0]).length;
      const pct= total?((n/total*100).toFixed(1)+'%'):'0%';
      rows+='<div class="lg-item"><span class="lg-sw" style="background:'+d[2]+'"></span><span class="lg-lbl">'+d[1]+'</span><span class="lg-val">'+n+' \u00b7 '+pct+'</span></div>';
    });
  }
  return rows+'<div class="lg-total">'+total+' pitch'+(total!==1?'es':'')+'</div>';
}
function populatePvizPlayers(map){
  const sel=$('pviz-player'); if(!sel) return;
  const names=Object.keys(map).sort((a,b)=>a.localeCompare(b));
  if(!(pvizPlayer && names.indexOf(pvizPlayer)>=0)) pvizPlayer=names[0]||'';
  sel.innerHTML= names.length? names.map(n=>'<option value="'+esc(n)+'"'+(n===pvizPlayer?' selected':'')+'>'+esc(n)+'</option>').join('') : '<option value="">No pitchers yet</option>';
}
function populatePvizVs(evs){
  const sel=$('pviz-vs'); if(!sel) return;
  const hitters=Array.from(new Set(evs.map(e=>e.player).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  if(pvizVs && hitters.indexOf(pvizVs)<0) pvizVs='';
  sel.innerHTML='<option value="">All hitters</option>'+hitters.map(h=>'<option value="'+esc(h)+'"'+(h===pvizVs?' selected':'')+'>'+esc(h)+'</option>').join('');
}
function renderPitcherViz(){
  const state=loadState(); const map= (typeof gatherPitchers==='function')? gatherPitchers(state) : {};
  populatePvizPlayers(map);
  const zone=$('pviz-zone'), note=$('pviz-note');
  if(!pvizPlayer || !map[pvizPlayer]){
    if(zone) zone.innerHTML='<div class="status">No pitches logged yet. Log pitches on the strike zone, then come back here.</div>';
    if($('pviz-legend')) $('pviz-legend').innerHTML=''; if(note) note.textContent='';
    const vs=$('pviz-vs'); if(vs) vs.innerHTML='<option value="">All hitters</option>';
    return;
  }
  let evs=map[pvizPlayer].all;
  populatePvizVs(evs);
  if(pvizVs) evs=evs.filter(e=> e.player===pvizVs);
  if(note) note.textContent= evs.length+' pitch'+(evs.length!==1?'es':'')+(pvizVs?(' vs '+pvizVs):'');
  if(zone) zone.innerHTML=buildPvizZone(evs);
  if($('pviz-legend')) $('pviz-legend').innerHTML=buildPvizLegend(evs);
}
const pvm=$('pviz-mode');
if(pvm) pvm.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{ pvizMode=b.getAttribute('data-mode'); pvm.querySelectorAll('button').forEach(x=> x.classList.toggle('active', x===b)); renderPitcherViz(); }));
const pvp=$('pviz-player'); if(pvp) pvp.addEventListener('change', ()=>{ pvizPlayer=pvp.value; pvizVs=''; renderPitcherViz(); });
const pvv=$('pviz-vs'); if(pvv) pvv.addEventListener('change', ()=>{ pvizVs=pvv.value; renderPitcherViz(); });
