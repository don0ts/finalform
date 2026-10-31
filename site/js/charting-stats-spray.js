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
  {key:'out',label:'Out / E',color:'#f28b8b',set:['OUT','E','FC','DP','SAC','SACF']},
  {key:'1B',label:'Single',color:'#8fc2ff',set:['1B']},
  {key:'2B',label:'Double',color:'#5ec877',set:['2B']},
  {key:'3B',label:'Triple',color:'#f0a44e',set:['3B']},
  {key:'HR',label:'Home Run',color:'#7b2d43',set:['HR']}
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
    const rlbl = sprayMode==='result' ? (resultCat(b.pa)? resultCat(b.pa).label : b.pa) : ((TRAJ_CATS.find(c=>c.key===b.bb)||{}).label || 'Unspecified');
    const ttl = esc(rlbl+' \u2014 to '+(posFullName(b.pos)||('pos '+b.pos)));
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
    rows+='<div class="lg-item"><span class="lg-sw" style="background:'+c.color+'"></span>'
      +'<span class="lg-lbl">'+c.label+'</span><span class="lg-val">'+n+' \u00b7 '+pct+'</span></div>';
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
  const evs=map[sprayPlayer].all;
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
