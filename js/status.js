function $(id){return document.getElementById(id);}
function el(tag,props,style){var e=document.createElement(tag);if(props)Object.keys(props).forEach(function(k){e[k]=props[k];});if(style)e.style.cssText=style;return e;}
function showToast(m,bad){var t=$('toast');t.textContent=m;t.className='toast show'+(bad?' bad':'');setTimeout(function(){t.className='toast'+(bad?' bad':'');},2000);}
var CLASS_OPTS=(function(){var a=[];for(var y=2016;y<=2037;y++)a.push(String(y));return a;})();
var POSITIONS=['','P','C','1B','2B','3B','SS','IF','LF','CF','RF','OF','DH','UTIL'];

// per-column date sort state: {group:null|name, dir:'newer'|'older'}
var sortState={key:'name',dir:'asc'};
var SORT_COLS=[
  {key:'name',label:'Player Name',get:function(r){return String(r.player_name||'').toLowerCase();}},
  {key:'pid',label:'Player ID',get:function(r){return String(r.player_id||r._id||'').toLowerCase();}},
  {key:'position',label:'Position',get:function(r){return String(r.position||'').toLowerCase();}}
];
function colByKey(k){for(var i=0;i<SORT_COLS.length;i++){if(SORT_COLS[i].key===k)return SORT_COLS[i];}return null;}

// Group columns – MUST match the names the data-entry tool writes into status{}
var GROUPS=['Timing Gates','60 Yard','Arm Strength','Measurables','Scale','Trackman','Blast','ForcePlates'];
// Columns that never apply to pitchers: shown as N/A (grayed) exactly like Blast.
var PITCHER_NA_GROUPS=['Timing Gates','60 Yard','Arm Strength','Blast'];
function isNaForPitcher(g,isPitcher){ return isPitcher && PITCHER_NA_GROUPS.indexOf(g)>=0; }

var DB=null, rows=[], filterText='';

// parse mm/dd/yyyy -> Date (or null)
function parseMDY(s){
  if(!s) return null;
  var m=String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return null;
  var d=new Date(+m[3], +m[1]-1, +m[2]);
  return isNaN(d.getTime())?null:d;
}
// green if within the last 2 months, yellow if 2–6 months, red if 6+ months old
function ageClass(dateStr){
  var d=parseMDY(dateStr); if(!d) return 'none';
  var now=new Date();
  var t2=new Date(now); t2.setMonth(t2.getMonth()-2);
  var t6=new Date(now); t6.setMonth(t6.getMonth()-6);
  if(d>=t2) return 'g';
  if(d>=t6) return 'y';
  return 'r';
}

function matches(r){
  if(!filterText) return true;
  var q=filterText.toLowerCase();
  return String(r.player_name||'').toLowerCase().indexOf(q)>=0
      || String(r.player_id||r._id||'').toLowerCase().indexOf(q)>=0;
}

function buildHead(){
  var hr=$('headRow'); hr.innerHTML='';
  SORT_COLS.forEach(function(col){
    var th=el('th',{className:'sortable'});
    th.appendChild(document.createTextNode(col.label));
    if(sortState.key===col.key){
      th.appendChild(el('span',{className:'arrow',textContent:sortState.dir==='asc'?'▲':'▼'}));
    }
    th.addEventListener('click',function(){
      if(sortState.key===col.key){ sortState.dir=(sortState.dir==='asc')?'desc':'asc'; }
      else { sortState.key=col.key; sortState.dir='asc'; }
      render();
    });
    hr.appendChild(th);
  });
  GROUPS.forEach(function(g){
    var th=el('th',{className:'sortable'});
    th.appendChild(document.createTextNode(g));
    if(sortState.key===g){
      th.appendChild(el('span',{className:'arrow',textContent:sortState.dir==='asc'?'▲':'▼'}));
    }
    th.addEventListener('click',function(){
      if(sortState.key===g){ sortState.dir=(sortState.dir==='asc')?'desc':'asc'; }
      else { sortState.key=g; sortState.dir='asc'; }
      render();
    });
    hr.appendChild(th);
  });
  hr.appendChild(el('th',{textContent:'Actions'},'text-align:right'));
}

function sortList(list){
  // Check if sorting by a named column (name/pid/position)
  var col=colByKey(sortState.key);
  if(col){
    return list.sort(function(a,b){
      var va=col.get(a), vb=col.get(b);
      var c=va.localeCompare(vb);
      return sortState.dir==='asc'?c:-c;
    });
  }
  // Sorting by a GROUP date column
  var g=sortState.key;
  return list.sort(function(a,b){
    var da=parseMDY((a.status||{})[g]), db2=parseMDY((b.status||{})[g]);
    if(!da && !db2) return String(a.player_name||'').localeCompare(String(b.player_name||''));
    if(!da) return 1;
    if(!db2) return -1;
    // asc = oldest first (▲), desc = newest first (▼)
    return sortState.dir==='asc' ? (da-db2) : (db2-da);
  });
}

function render(){
  if(!DB) return;
  buildHead();
  var status=$('statusBox'), tw=$('tableWrap');
  var list=rows.filter(matches);
  list=sortList(list);
  $('countNote').textContent=rows.length?(list.length+' of '+rows.length+' player'+(rows.length!==1?'s':'')):'';
  if(!rows.length){ tw.style.display='none'; status.style.display=''; status.className='status'; status.textContent='No players yet. Use \u201cSave to Status\u201d in the data-entry tool to record capture dates here.'; return; }
  if(!list.length){ tw.style.display='none'; status.style.display=''; status.className='status'; status.textContent='No players match \u201c'+filterText+'\u201d.'; return; }
  status.style.display='none'; tw.style.display='';
  var tb=$('tbody'); tb.innerHTML='';
  list.forEach(function(r){
    var tr=el('tr');
    tr.appendChild(el('td')).appendChild(el('span',{className:'nm',textContent:r.player_name||'(no name)'}));
    tr.appendChild(el('td',{textContent:r.player_id||r._id||''}));
    // Position column (with pitcher badge)
    var posTd=el('td');
    var pos=(r.position||'');
    if(pos==='P') posTd.appendChild(el('span',{className:'badge pitcher',textContent:'P'}));
    else if(pos) posTd.appendChild(el('span',{className:'badge',textContent:pos}));
    else posTd.appendChild(el('span',{className:'mut',textContent:'\u2014'}));
    tr.appendChild(posTd);
    var isPitcher=(r.position||'')==='P';
    var st=r.status||{};
    GROUPS.forEach(function(g){
      var td=el('td');
      // Gray out columns that don't apply to pitchers (Blast, Timing Gates, 60 Yard, Arm Strength)
      if(isNaForPitcher(g,isPitcher)){
        td.appendChild(el('span',{className:'dcell grayed',textContent:'N/A'}));
        tr.appendChild(td); return;
      }
      var v=st[g]||'';
      var cls=v?ageClass(v):'none';
      var span=el('span',{className:'dcell '+cls,textContent:v||'\u2014'});
      if(v){ span.addEventListener('click',function(ev){ ev.stopPropagation(); openDateMenu(ev,r,g,v); }); }
      td.appendChild(span); tr.appendChild(td);
    });
    var tdA=el('td');var wrap=el('div',{className:'rowacts'});
    var eb=el('button',{className:'ghost',textContent:'Edit'});eb.addEventListener('click',function(){openEdit(r);});
    wrap.appendChild(eb);tdA.appendChild(wrap);tr.appendChild(tdA);
    tb.appendChild(tr);
  });
}

// ---- edit modal (same profile modal as the Profile Manager) ----
function closeModal(){$('overlay').classList.remove('show');$('modal').innerHTML='';}
function openModalNode(node){var md=$('modal');md.innerHTML='';md.appendChild(node);$('overlay').classList.add('show');}
function fieldText(label,val,placeholder){
  var f=el('div',{className:'field'});f.appendChild(el('label',{textContent:label}));
  var i=el('input');i.type='text';i.value=val||'';if(placeholder)i.placeholder=placeholder;
  f.appendChild(i);f._input=i;return f;
}
function fieldSelect(label,val,opts){
  var f=el('div',{className:'field'});f.appendChild(el('label',{textContent:label}));
  var s=el('select');var have=false;
  opts.forEach(function(o){var op=el('option');op.value=o;op.textContent=(o===''?'\u2014':o);if(String(o)===String(val||'')){op.selected=true;have=true;}s.appendChild(op);});
  if(!have&&val){var op=el('option');op.value=val;op.textContent=val;op.selected=true;s.appendChild(op);}
  f.appendChild(s);f._input=s;return f;
}
function fieldSeg(label,val,opts){
  var f=el('div',{className:'field'});f.appendChild(el('label',{textContent:label}));
  var seg=el('div',{className:'seg'});var state={v:val||''};
  opts.forEach(function(o){
    var b=el('div',{className:'opt'+(state.v===o?' active':''),textContent:o});
    b.addEventListener('click',function(){state.v=(state.v===o)?'':o;seg.querySelectorAll('.opt').forEach(function(x){x.classList.toggle('active',x.textContent===state.v);});});
    seg.appendChild(b);
  });
  f.appendChild(seg);f._state=state;return f;
}
function openEdit(r){ profileForm(r); }
function profileForm(r){
  var isNew=!r;
  var root=el('div');
  root.appendChild(el('h3',{textContent:isNew?'New profile':'Edit profile'}));
  root.appendChild(el('p',{className:'sub2',textContent:isNew?'Create a new player profile.':'Update this player\u2019s details.'}));
  var fName=fieldText('Name',r?r.player_name:'','Full name');
  var fId=fieldText('ID (Player ID Cubs)',r?(r.player_id||r._id):'','e.g. 129393');
  var idWarn=el('div',{className:'warn',textContent:'Changing the ID creates a new profile and removes the old one.'});
  fId.appendChild(idWarn);
  var oldId=r?String(r.player_id||r._id||''):'';
  fId._input.addEventListener('input',function(){idWarn.style.display=(!isNew&&fId._input.value.trim()!==oldId)?'block':'none';});
  var fPos=fieldSelect('Position',r?r.position:'',POSITIONS);
  var fClass=fieldSelect('Class',r?r.class:'',[''].concat(CLASS_OPTS));
  var fBats=fieldSeg('Bats',r?r.bats:'',['R','L']);
  var fThrows=fieldSeg('Throws',r?r.throws:'',['R','L']);
  root.appendChild(fName);root.appendChild(fId);root.appendChild(fPos);root.appendChild(fClass);root.appendChild(fBats);root.appendChild(fThrows);
  var acts=el('div',{className:'acts'});
  var cancel=el('button',{className:'ghost',textContent:'Cancel'});cancel.addEventListener('click',closeModal);
  var save=el('button',{className:'primary',textContent:isNew?'Create':'Save changes'});
  acts.appendChild(cancel);acts.appendChild(save);root.appendChild(acts);
  save.addEventListener('click',function(){
    var name=fName._input.value.trim();
    var newId=fId._input.value.trim();
    if(!newId){ showToast('An ID is required',true); return; }
    var docData={
      player_id:newId,
      player_name:name,
      position:fPos._input.value||'',
      class:fClass._input.value||'',
      bats:fBats._state.v||'',
      throws:fThrows._state.v||''
    };
    if(!DB||!DB.upsert){ showToast('Not connected to the database',true); return; }
    if(newId!==oldId && rows.some(function(x){return String(x.player_id||x._id||'')===newId;})){
      showToast('A profile with ID '+newId+' already exists',true); return;
    }
    save.disabled=true;
    Promise.resolve(DB.upsert(newId,docData)).then(function(){
      if(!isNew && oldId && oldId!==newId){ return DB.remove(oldId); }
    }).then(function(){
      closeModal();
      showToast(isNew?'Profile created':'Profile saved');
    }).catch(function(e){ save.disabled=false; showToast('Save failed: '+(e&&e.message||e),true); });
  });
  openModalNode(root);
  fName._input.focus();
}

// ---- date-cell action menu (Cancel / Edit / Delete) ----
var _openMenu=null;
function closeDateMenu(){ if(_openMenu){ _openMenu.remove(); _openMenu=null; document.removeEventListener('click',closeDateMenu); } }
function openDateMenu(ev,r,group,val){
  closeDateMenu();
  var m=el('div',{className:'menu'});
  var edit=el('button',{textContent:'Edit date'});
  edit.addEventListener('click',function(e){ e.stopPropagation(); closeDateMenu(); openDateEdit(r,group,val); });
  var del=el('button',{className:'del',textContent:'Delete date'});
  del.addEventListener('click',function(e){ e.stopPropagation(); closeDateMenu(); deleteDate(r,group); });
  var cancel=el('button',{textContent:'Cancel'});
  cancel.addEventListener('click',function(e){ e.stopPropagation(); closeDateMenu(); });
  m.appendChild(edit); m.appendChild(del); m.appendChild(cancel);
  document.body.appendChild(m);
  var x=Math.min(ev.clientX, window.innerWidth-170), y=Math.min(ev.clientY, window.innerHeight-140);
  m.style.left=x+'px'; m.style.top=y+'px';
  _openMenu=m;
  setTimeout(function(){ document.addEventListener('click',closeDateMenu); },0);
}
function idOf(r){ return String(r.player_id||r._id||''); }
function deleteDate(r,group){
  if(!DB||!DB.clearStatusDate){ showToast('Not connected to the database',true); return; }
  Promise.resolve(DB.clearStatusDate(idOf(r),group)).then(function(){
    showToast(group+' date cleared');
  }).catch(function(e){ showToast('Delete failed: '+(e&&e.message||e),true); });
}
function openDateEdit(r,group,val){
  var root=el('div');
  root.appendChild(el('h3',{textContent:'Edit '+group+' date'}));
  root.appendChild(el('p',{className:'sub2',textContent:(r.player_name||'(no name)')+' \u2014 '+idOf(r)}));
  var f=el('div',{className:'field'});
  f.appendChild(el('label',{textContent:'Date taken'}));
  var input=el('input'); input.type='date';
  var d=parseMDY(val);
  if(d){ input.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  f.appendChild(input); root.appendChild(f);
  var acts=el('div',{className:'acts'});
  var cancel=el('button',{className:'ghost',textContent:'Cancel'}); cancel.addEventListener('click',closeModal);
  var save=el('button',{className:'primary',textContent:'Save'});
  acts.appendChild(cancel); acts.appendChild(save); root.appendChild(acts);
  save.addEventListener('click',function(){
    if(!input.value){ showToast('Pick a date',true); return; }
    var p=input.value.split('-'); // yyyy-mm-dd
    var mdy=p[1]+'/'+p[2]+'/'+p[0];
    if(!DB||!DB.setStatusDate){ showToast('Not connected to the database',true); return; }
    save.disabled=true;
    Promise.resolve(DB.setStatusDate(idOf(r),group,mdy)).then(function(){
      closeModal(); showToast(group+' date updated');
    }).catch(function(e){ save.disabled=false; showToast('Save failed: '+(e&&e.message||e),true); });
  });
  openModalNode(root); input.focus();
}

// ---- Download Sheet (real .xlsx with live color formulas) ----
function ensureExcelJS(){
  return new Promise(function(resolve,reject){
    if(window.ExcelJS) return resolve(window.ExcelJS);
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    s.onload=function(){ window.ExcelJS?resolve(window.ExcelJS):reject(new Error('Excel library did not load')); };
    s.onerror=function(){ reject(new Error('Could not load the Excel library (check your connection)')); };
    document.head.appendChild(s);
  });
}
function colLetter(n){ var s=''; while(n>0){ var m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
function fmtLongDate(d){ return d.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}); }
function isoDate(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function downloadSheet(){
  showToast('Building sheet\u2026');
  ensureExcelJS().then(function(ExcelJS){
    var now=new Date();
    // Order by position: OF, then IF, then C, then P, then no position.
    // Within a position group keep alphabetical-by-name order.
    var posRankOf=function(r){
      var p=String(r.position||'').toUpperCase();
      if(p==='OF'||p==='LF'||p==='CF'||p==='RF') return 0;
      if(p==='IF'||p==='1B'||p==='2B'||p==='3B'||p==='SS') return 1;
      if(p==='C') return 2;
      if(p==='P') return 3;
      return 4;
    };
    var list=rows.slice().sort(function(a,b){
      var ra=posRankOf(a), rb=posRankOf(b);
      if(ra!==rb) return ra-rb;
      return String(a.player_name||'').toLowerCase().localeCompare(String(b.player_name||'').toLowerCase());
    });
    var headers=['Player Name','Player ID','Position'].concat(GROUPS);
    var nCols=headers.length;
    var wb=new ExcelJS.Workbook();
    wb.creator='CubSentry'; wb.created=now;
    var ws=wb.addWorksheet('Data Control',{views:[{state:'frozen',ySplit:6}]});
    var thin={top:{style:'thin',color:{argb:'FFCBD5E1'}},left:{style:'thin',color:{argb:'FFCBD5E1'}},bottom:{style:'thin',color:{argb:'FFCBD5E1'}},right:{style:'thin',color:{argb:'FFCBD5E1'}}};
    // ---- Title block ----
    ws.mergeCells(1,1,1,nCols);
    var t1=ws.getCell(1,1); t1.value='Gustavo Rios Cubs Data Control Sheet'; t1.font={bold:true,size:18,color:{argb:'FF0B2540'}}; t1.alignment={horizontal:'left',vertical:'middle'};
    ws.getRow(1).height=26;
    ws.mergeCells(2,1,2,nCols);
    var t2=ws.getCell(2,1); t2.value='Cubs International Scouting Department, Venezuela'; t2.font={size:12,color:{argb:'FF475569'}};
    ws.mergeCells(3,1,3,nCols);
    var t3=ws.getCell(3,1); t3.value='As of '+fmtLongDate(now); t3.font={italic:true,size:11,color:{argb:'FF64748B'}};
    ws.mergeCells(4,1,4,nCols);
    var t4=ws.getCell(4,1); t4.value='Color key:  Green = less than 2 months   \u2022   Yellow = 2 to 6 months   \u2022   Red = more than 6 months'; t4.font={size:10,color:{argb:'FF64748B'}};
    // ---- Header row (row 6) ----
    var headerRow=6, dataStart=7;
    headers.forEach(function(h,i){
      var cell=ws.getCell(headerRow,i+1);
      cell.value=h;
      cell.font={bold:true,size:11,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B2540'}};
      cell.alignment={horizontal:(i<3?'left':'center'),vertical:'middle'};
      cell.border=thin;
    });
    ws.getRow(headerRow).height=20;
    // ---- Data rows ----
    list.forEach(function(r,ri){
      var rowNum=dataStart+ri;
      var st=r.status||{};
      var isPitcher=(r.position||'')==='P';
      ws.getCell(rowNum,1).value=r.player_name||'';
      ws.getCell(rowNum,2).value=idOf(r);
      ws.getCell(rowNum,3).value=r.position||'';
      ws.getCell(rowNum,1).border=thin;
      ws.getCell(rowNum,2).border=thin; ws.getCell(rowNum,2).alignment={horizontal:'left'};
      ws.getCell(rowNum,3).border=thin; ws.getCell(rowNum,3).alignment={horizontal:'center'};
      GROUPS.forEach(function(g,gi){
        var col=4+gi, cell=ws.getCell(rowNum,col);
        if(isNaForPitcher(g,isPitcher)){ cell.value='N/A'; cell.font={color:{argb:'FF94A3B8'}}; }
        else {
          var d=parseMDY(st[g]||'');
          if(d){ cell.value=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); cell.numFmt='mm/dd/yyyy'; }
        }
        cell.alignment={horizontal:'center'};
        cell.border=thin;
      });
    });
    var lastRow=list.length?(dataStart+list.length-1):dataStart;
    // ---- Column widths ----
    ws.getColumn(1).width=26; ws.getColumn(2).width=14; ws.getColumn(3).width=11;
    for(var cc=4;cc<=nCols;cc++){ ws.getColumn(cc).width=14; }
    // ---- Conditional formatting: live colors from TODAY() ----
    var prio=1;
    for(var gi2=0; gi2<GROUPS.length; gi2++){
      var L=colLetter(4+gi2);
      var ref=L+dataStart+':'+L+lastRow;
      var top=L+dataStart;
      ws.addConditionalFormatting({ ref:ref, rules:[
        {type:'expression',priority:prio++,stopIfTrue:true,formulae:['AND(ISNUMBER('+top+'),'+top+'>=EDATE(TODAY(),-2))'],style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FFC6EFCE'}},font:{color:{argb:'FF006100'}}}},
        {type:'expression',priority:prio++,stopIfTrue:true,formulae:['AND(ISNUMBER('+top+'),'+top+'>=EDATE(TODAY(),-6))'],style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FFFFEB9C'}},font:{color:{argb:'FF9C6500'}}}},
        {type:'expression',priority:prio++,formulae:['AND(ISNUMBER('+top+'),'+top+'<EDATE(TODAY(),-6))'],style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FFFFC7CE'}},font:{color:{argb:'FF9C0006'}}}}
      ]});
    }
    return wb.xlsx.writeBuffer().then(function(buf){
      var blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      var url=URL.createObjectURL(blob);
      var a=el('a'); a.href=url; a.download='Cubs_Data_Control_Sheet_'+isoDate(now)+'.xlsx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){URL.revokeObjectURL(url);},1500);
      showToast('Sheet downloaded');
    });
  }).catch(function(e){ showToast('Export failed: '+(e&&e.message||e),true); });
}

$('search').addEventListener('input',function(e){ filterText=e.target.value.trim(); render(); });
$('downloadSheetBtn').addEventListener('click',downloadSheet);
$('overlay').addEventListener('click',function(e){ if(e.target===$('overlay')) closeModal(); });
window.__applyData=function(list,api){ rows=list; if(api) DB=api; render(); };
window.__setDB=function(api){ DB=api; };
