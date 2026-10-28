// ---- helpers ----
function $(id){return document.getElementById(id);}
function el(tag,props,style){var e=document.createElement(tag);if(props)Object.keys(props).forEach(function(k){e[k]=props[k];});if(style)e.style.cssText=style;return e;}
function showToast(m,bad){var t=$('toast');t.textContent=m;t.className='toast show'+(bad?' bad':'');setTimeout(function(){t.className='toast'+(bad?' bad':'');},2000);}
var CLASS_OPTS=(function(){var a=[];for(var y=2016;y<=2037;y++)a.push(String(y));return a;})();
var POSITIONS=['','P','C','1B','2B','3B','SS','IF','LF','CF','RF','OF','DH','UTIL'];

// ---- Status-entry / merge helpers ----
// A profile "has entries in the Status page" when its status{} map holds at
// least one recorded date. Such profiles are protected from deletion.
function hasStatusEntries(r){
  var st=r&&r.status; if(!st||typeof st!=='object') return false;
  return Object.keys(st).some(function(k){ return st[k]!==''&&st[k]!=null; });
}
// Dropdown label: "1787812 - Jose Fuenmayor (C)"
function profileLabel(r){
  var id=String(r.player_id||r._id||'');
  var nm=r.player_name||'(no name)';
  var pos=r.position?(' ('+r.position+')'):'';
  return id+' - '+nm+pos;
}
function parseMDY(s){ var m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s||'').trim()); if(!m) return 0; var y=+m[3]; if(y<100)y+=2000; return new Date(y,(+m[1])-1,+m[2]).getTime(); }
function statusOf(r){ return (r&&r.status&&typeof r.status==='object')?r.status:{}; }
// Union of every selected profile's status dates, keeping the most recent per group.
function mergeStatus(selected){
  var out={};
  selected.forEach(function(r){
    var st=statusOf(r);
    Object.keys(st).forEach(function(g){
      var v=st[g]; if(v===''||v==null) return;
      if(!out[g] || parseMDY(v)>parseMDY(out[g])) out[g]=v;
    });
  });
  return out;
}
// Build the merged profile: profile fields DEFAULT to the primary (first) pick,
// blanks are back-filled from the other picks, and all Status data is combined.
function computeMergedDoc(selected){
  var primary=selected[0]||{};
  function pick(field){ for(var i=0;i<selected.length;i++){ var v=selected[i][field]; if(v!==''&&v!=null) return v; } return ''; }
  return {
    player_id:String(primary.player_id||primary._id||''),
    player_name:(primary.player_name||pick('player_name'))||'',
    position:(primary.position||pick('position'))||'',
    class:(primary.class||pick('class'))||'',
    bats:(primary.bats||pick('bats'))||'',
    throws:(primary.throws||pick('throws'))||'',
    dob:(primary.dob||pick('dob'))||'',
    status:mergeStatus(selected)
  };
}

var DB=null;         // set once Firestore is ready
var rows=[];         // current cache of profiles
var filterText='';

// ---- sortable columns (click a header to sort, click again to flip direction) ----
var SORT_COLS=[
  {key:'name',     label:'Name',     get:function(r){return String(r.player_name||'');}},
  {key:'id',       label:'ID',       get:function(r){return String(r.player_id||r._id||'');}},
  {key:'position', label:'Position', get:function(r){return String(r.position||'');}},
  {key:'class',    label:'Class',    get:function(r){return String(r.class||'');}},
  {key:'bats',     label:'Bats',     get:function(r){return String(r.bats||'');}},
  {key:'throws',   label:'Throws',   get:function(r){return String(r.throws||'');}},
  {key:'dob',      label:'DOB',      get:function(r){return String(r.dob||'');}}
];
var sortState={key:'name',dir:'asc'};
function colByKey(k){ for(var i=0;i<SORT_COLS.length;i++){ if(SORT_COLS[i].key===k) return SORT_COLS[i]; } return SORT_COLS[0]; }
function sortList(list){
  var col=colByKey(sortState.key);
  return list.sort(function(a,b){
    var va=col.get(a), vb=col.get(b);
    // blanks always sort last, regardless of direction
    if(!va && !vb) return String(a.player_name||'').localeCompare(String(b.player_name||''));
    if(!va) return 1;
    if(!vb) return -1;
    var c=va.localeCompare(vb,undefined,{numeric:true,sensitivity:'base'});
    if(c===0) c=String(a.player_name||'').localeCompare(String(b.player_name||''));
    return sortState.dir==='asc'?c:-c;
  });
}
function buildHead(){
  var hr=$('headRow'); if(!hr) return; hr.innerHTML='';
  SORT_COLS.forEach(function(col){
    var th=el('th',{className:'sortable'});
    th.appendChild(document.createTextNode(col.label));
    if(sortState.key===col.key){ th.appendChild(el('span',{className:'arrow',textContent:sortState.dir==='asc'?'\u25b2':'\u25bc'})); }
    th.addEventListener('click',function(){
      if(sortState.key===col.key){ sortState.dir=(sortState.dir==='asc')?'desc':'asc'; }
      else { sortState.key=col.key; sortState.dir='asc'; }
      render();
    });
    hr.appendChild(th);
  });
  hr.appendChild(el('th',{textContent:'Actions'},'text-align:right'));
}

// ---- rendering ----
function matches(r){
  if(!filterText) return true;
  var q=filterText.toLowerCase();
  return String(r.player_name||'').toLowerCase().indexOf(q)>=0
      || String(r.player_id||r._id||'').toLowerCase().indexOf(q)>=0
      || String(r.position||'').toLowerCase().indexOf(q)>=0;
}
function render(){
  var status=$('statusBox'),tw=$('tableWrap'),cards=$('cards');
  if(!DB){ return; }
  var list=sortList(rows.filter(matches));
  $('countNote').textContent=rows.length?(list.length+' of '+rows.length+' profile'+(rows.length!==1?'s':'')):'';
  if(!rows.length){
    tw.style.display='none';cards.style.display='';cards.innerHTML='';
    status.style.display='';status.className='status';status.textContent='No profiles yet. Profiles you create in the data-entry tool show up here, or add one now.';
    return;
  }
  if(!list.length){
    tw.style.display='none';cards.innerHTML='';
    status.style.display='';status.className='status';status.textContent='No profiles match \u201c'+filterText+'\u201d.';
    return;
  }
  status.style.display='none';
  // table (wide screens)
  buildHead();
  tw.style.display='';
  var tb=$('tbody');tb.innerHTML='';
  list.forEach(function(r){
    var tr=el('tr');
    tr.appendChild(el('td',{className:'',textContent:''},'')).appendChild(el('span',{className:'nm',textContent:r.player_name||'(no name)'}));
    tr.appendChild(el('td',{textContent:r.player_id||r._id||''}));
    var tdPos=el('td');if(r.position){var bcls='badge'+(r.position==='P'?' pitcher':'');tdPos.appendChild(el('span',{className:bcls,textContent:r.position}));}else{tdPos.appendChild(el('span',{className:'mut',textContent:'\u2014'}));}tr.appendChild(tdPos);
    tr.appendChild(el('td',{textContent:r.class||'\u2014'}));
    tr.appendChild(el('td',{textContent:r.bats||'\u2014'}));
    tr.appendChild(el('td',{textContent:r.throws||'\u2014'}));
    tr.appendChild(el('td',{textContent:r.dob||'\u2014'}));
    var tdA=el('td');var wrap=el('div',{className:'rowacts'});
    var eb=el('button',{className:'ghost',textContent:'Edit'});eb.addEventListener('click',function(){openEdit(r);});
    var db=el('button',{className:'danger',textContent:'Delete'});
    if(hasStatusEntries(r)){ db.disabled=true; db.title='This profile has Status entries and can\u2019t be deleted.'; db.style.opacity='.5'; db.style.cursor='not-allowed'; }
    else { db.addEventListener('click',function(){openDelete(r);}); }
    wrap.appendChild(eb);wrap.appendChild(db);tdA.appendChild(wrap);tr.appendChild(tdA);
    tb.appendChild(tr);
  });
  // cards (narrow screens)
  cards.innerHTML='';
  list.forEach(function(r){
    var c=el('div',{className:'pcard'});
    var top=el('div',{className:'top'});top.appendChild(el('span',{className:'nm',textContent:r.player_name||'(no name)'}));
    if(r.position){var bcls='badge'+(r.position==='P'?' pitcher':'');top.appendChild(el('span',{className:bcls,textContent:r.position}));}
    c.appendChild(top);
    var kv=el('div',{className:'kv'});
    function add(label,val){kv.appendChild(el('b',{textContent:label}));kv.appendChild(el('span',{textContent:val||'\u2014'}));}
    add('ID',r.player_id||r._id);add('Class',r.class);add('Bats',r.bats);add('Throws',r.throws);add('DOB',r.dob);
    c.appendChild(kv);
    var wrap=el('div',{className:'rowacts'});
    var eb=el('button',{className:'ghost',textContent:'Edit'});eb.addEventListener('click',function(){openEdit(r);});
    var db=el('button',{className:'danger',textContent:'Delete'});
    if(hasStatusEntries(r)){ db.disabled=true; db.title='This profile has Status entries and can\u2019t be deleted.'; db.style.opacity='.5'; db.style.cursor='not-allowed'; }
    else { db.addEventListener('click',function(){openDelete(r);}); }
    wrap.appendChild(eb);wrap.appendChild(db);c.appendChild(wrap);
    cards.appendChild(c);
  });
}

// ---- modals ----
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
function fieldDate(label,val){
  var f=el('div',{className:'field'});f.appendChild(el('label',{textContent:label}));
  var i=el('input');i.type='date';i.value=val||'';i.style.colorScheme='dark';
  f.appendChild(i);f._input=i;return f;
}

function openEdit(r){ profileForm(r); }
function openNew(){ profileForm(null); }

function profileForm(r){
  var isNew=!r;
  var root=el('div');
  root.appendChild(el('h3',{textContent:isNew?'New profile':'Edit profile'}));
  root.appendChild(el('p',{className:'sub2',textContent:isNew?'Create a new player profile.':'Update this player\u2019s details.'}));
  var fName=fieldText('Name',r?r.player_name:'','Full name');
  var fId=fieldText('ID (Player ID Cubs)',r?(r.player_id||r._id):'','e.g. 129393');
  var idWarn=el('div',{className:'warn',textContent:'Changing the ID moves this profile to the new ID — the existing record is updated, not duplicated.'});
  fId.appendChild(idWarn);
  var oldId=r?String(r.player_id||r._id||''):'';
  fId._input.addEventListener('input',function(){idWarn.style.display=(!isNew&&fId._input.value.trim()!==oldId)?'block':'none';});
  var fPos=fieldSelect('Position',r?r.position:'',POSITIONS);
  var fClass=fieldSelect('Class',r?r.class:'',[''].concat(CLASS_OPTS));
  var fBats=fieldSeg('Bats',r?r.bats:'',['R','L']);
  var fThrows=fieldSeg('Throws',r?r.throws:'',['R','L']);
  var fDob=fieldDate('Date of birth',r?r.dob:'');
  root.appendChild(fName);root.appendChild(fId);root.appendChild(fPos);root.appendChild(fClass);root.appendChild(fBats);root.appendChild(fThrows);root.appendChild(fDob);
  var acts=el('div',{className:'acts'});
  var cancel=el('button',{className:'ghost',textContent:'Cancel'});cancel.addEventListener('click',closeModal);
  var save=el('button',{className:'primary',textContent:isNew?'Create':'Save changes'});
  acts.appendChild(cancel);acts.appendChild(save);root.appendChild(acts);
  save.addEventListener('click',function(){
    var name=fName._input.value.trim();
    var newId=fId._input.value.trim();
    if(!newId){ showToast('An ID is required',true); return; }
    var doc={
      player_id:newId,
      player_name:name,
      position:fPos._input.value||'',
      class:fClass._input.value||'',
      bats:fBats._state.v||'',
      throws:fThrows._state.v||'',
      dob:fDob._input.value||''
    };
    if(!DB){ showToast('Not connected to the database',true); return; }
    // duplicate-id guard when creating or changing the ID
    if(newId!==oldId && rows.some(function(x){return String(x.player_id||x._id||'')===newId;})){
      showToast('A profile with ID '+newId+' already exists',true); return;
    }
    save.disabled=true;
    Promise.resolve(DB.upsert(newId,doc)).then(function(){
      if(!isNew && oldId && oldId!==newId){ return DB.remove(oldId); }
    }).then(function(){
      closeModal();
      showToast(isNew?'Profile created':'Profile saved');
    }).catch(function(e){ save.disabled=false; showToast('Save failed: '+(e&&e.message||e),true); });
  });
  openModalNode(root);
  fName._input.focus();
}

function openDelete(r){
  var id=String(r.player_id||r._id||'');
  // Guard: profiles with Status-page entries can't be deleted.
  if(hasStatusEntries(r)){
    var rootB=el('div');
    rootB.appendChild(el('h3',{textContent:'Can\u2019t delete this profile'}));
    rootB.appendChild(el('p',{className:'sub2',textContent:'This profile has entries on the Status page, so it can\u2019t be deleted. Clear its Status dates first if you really need to remove it.'}));
    var boxB=el('div',{className:'field'});
    boxB.appendChild(el('div',{textContent:(r.player_name||'(no name)')+'  \u2014  ID '+id},'font-size:15px;font-weight:700;padding:10px 12px;background:#0b1220;border:1px solid var(--line);border-radius:8px'));
    rootB.appendChild(boxB);
    var actsB=el('div',{className:'acts'});
    var okB=el('button',{className:'ghost',textContent:'Close'});okB.addEventListener('click',closeModal);
    actsB.appendChild(okB);rootB.appendChild(actsB);
    openModalNode(rootB);
    return;
  }
  var root=el('div');
  root.appendChild(el('h3',{textContent:'Delete profile'}));
  root.appendChild(el('p',{className:'sub2',textContent:'This permanently removes the profile from the database. This cannot be undone.'}));
  var box=el('div',{className:'field'});
  box.appendChild(el('div',{textContent:(r.player_name||'(no name)')+'  \u2014  ID '+id},'font-size:15px;font-weight:700;padding:10px 12px;background:#0b1220;border:1px solid var(--line);border-radius:8px'));
  root.appendChild(box);
  var acts=el('div',{className:'acts'});
  var cancel=el('button',{className:'ghost',textContent:'Cancel'});cancel.addEventListener('click',closeModal);
  var del=el('button',{className:'danger',textContent:'Delete profile'});
  acts.appendChild(cancel);acts.appendChild(del);root.appendChild(acts);
  del.addEventListener('click',function(){
    if(!DB){ showToast('Not connected to the database',true); return; }
    del.disabled=true;
    Promise.resolve(DB.remove(id)).then(function(){ closeModal(); showToast('Profile deleted'); })
      .catch(function(e){ del.disabled=false; showToast('Delete failed: '+(e&&e.message||e),true); });
  });
  openModalNode(root);
}

// ---- merge profiles ----
// A searchable dropdown listing every profile as "ID - Name (Pos)". Typing
// filters the list; picking an option stores that profile's id.
function buildMergeSelect(preId){
  var wrap=el('div',{},'position:relative;flex:1');
  var input=el('input');input.type='text';input.placeholder='Search by ID, name or position\u2026';input.autocomplete='off';
  input.style.cssText='width:100%;background:#0b1220;border:1px solid var(--line);border-radius:8px;color:var(--txt);padding:9px 11px;font-size:14px';
  var menu=el('div',{},'position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;background:var(--panel2);border:1px solid var(--line);border-radius:8px;max-height:240px;overflow:auto;display:none;box-shadow:0 12px 30px rgba(0,0,0,.45)');
  var state={id:''}; var onChangeCb=null;
  function pick(r){ state.id=String(r.player_id||r._id||''); input.value=profileLabel(r); menu.style.display='none'; if(onChangeCb) onChangeCb(); }
  function open(filter){
    menu.innerHTML=''; var q=(filter||'').toLowerCase();
    var list=rows.filter(function(r){ return !q || profileLabel(r).toLowerCase().indexOf(q)>=0; });
    if(!list.length){ menu.appendChild(el('div',{textContent:'No matches'},'padding:10px 12px;color:var(--muted);font-size:13px')); }
    list.slice(0,80).forEach(function(r){
      var it=el('div',{textContent:profileLabel(r)},'padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--line)');
      it.addEventListener('mousedown',function(ev){ ev.preventDefault(); pick(r); });
      it.addEventListener('mouseenter',function(){ it.style.background='rgba(56,189,248,.08)'; });
      it.addEventListener('mouseleave',function(){ it.style.background=''; });
      menu.appendChild(it);
    });
    menu.style.display='block';
  }
  input.addEventListener('focus',function(){ open(state.id?'':input.value); });
  input.addEventListener('input',function(){ state.id=''; open(input.value); });
  input.addEventListener('blur',function(){ setTimeout(function(){ menu.style.display='none'; },160); });
  wrap.appendChild(input);wrap.appendChild(menu);
  var api={node:wrap, getId:function(){return state.id;}, setId:function(id){ var r=rows.find(function(x){return String(x.player_id||x._id||'')===String(id);}); if(r) pick(r); }, onChange:function(fn){onChangeCb=fn;}};
  if(preId) api.setId(preId);
  return api;
}
function openMerge(){
  if(!DB){ showToast('Not connected to the database',true); return; }
  if(rows.length<2){ showToast('Need at least two profiles to merge',true); return; }
  var root=el('div');
  root.appendChild(el('h3',{textContent:'Merge profiles'}));
  root.appendChild(el('p',{className:'sub2',textContent:'Pick the profiles to merge. The first pick is the primary \u2014 the merged profile defaults to its details. Data from every selected profile (including Status entries) is combined.'}));
  var holder=el('div',{});
  var selects=[];
  function relabel(){ selects.forEach(function(m,i){ m._line._tag.textContent=(i===0?'Primary':('#'+(i+1))); }); }
  function addSelect(preId){
    var msel=buildMergeSelect(preId);
    var line=el('div',{},'display:flex;gap:8px;align-items:center;margin-bottom:10px');
    var tag=el('span',{textContent:(selects.length===0?'Primary':('#'+(selects.length+1)))},'min-width:60px;font-size:12px;color:var(--muted);font-weight:700');
    var rm=el('button',{className:'ghost',textContent:'\u2715'},'padding:6px 10px');
    rm.addEventListener('click',function(){
      var i=selects.indexOf(msel); if(i<0) return;
      if(selects.length<=2){ showToast('Keep at least two profiles',true); return; }
      selects.splice(i,1); holder.removeChild(line); relabel();
    });
    line.appendChild(tag);line.appendChild(msel.node);line.appendChild(rm);
    msel._line=line; line._tag=tag;
    selects.push(msel); holder.appendChild(line);
  }
  addSelect(); addSelect();
  root.appendChild(holder);
  var addRow=el('div',{},'margin:2px 0 8px');
  var addAnother=el('button',{className:'ghost',textContent:'+ Add another player'});
  addAnother.addEventListener('click',function(){ addSelect(); });
  addRow.appendChild(addAnother); root.appendChild(addRow);
  var acts=el('div',{className:'acts'});
  var cancel=el('button',{className:'ghost',textContent:'Cancel'});cancel.addEventListener('click',closeModal);
  var mergeBtn=el('button',{className:'primary',textContent:'Merge'});
  acts.appendChild(cancel);acts.appendChild(mergeBtn);root.appendChild(acts);
  mergeBtn.addEventListener('click',function(){
    var ids=selects.map(function(m){return m.getId();}).filter(function(x){return x;});
    var seen={},uniq=[]; ids.forEach(function(id){ if(!seen[id]){seen[id]=1;uniq.push(id);} });
    if(uniq.length<2){ showToast('Select at least two different profiles',true); return; }
    var selectedRows=uniq.map(function(id){ return rows.find(function(r){return String(r.player_id||r._id||'')===id;}); }).filter(Boolean);
    if(selectedRows.length<2){ showToast('Select at least two different profiles',true); return; }
    mergeConfirmForm(computeMergedDoc(selectedRows), selectedRows);
  });
  openModalNode(root);
}
function mergeConfirmForm(merged, selectedRows){
  var root=el('div');
  root.appendChild(el('h3',{textContent:'Confirm merged profile'}));
  root.appendChild(el('p',{className:'sub2',textContent:'Review the merged details. Defaults come from the primary profile \u2014 edit anything before confirming. '+selectedRows.length+' profiles will be combined into one.'}));
  var srcBox=el('div',{className:'field'});
  selectedRows.forEach(function(r,i){
    srcBox.appendChild(el('div',{textContent:(i===0?'Primary \u2192 ':'merge  \u2192 ')+profileLabel(r)},'font-size:12px;color:var(--muted);padding:3px 0'));
  });
  root.appendChild(srcBox);
  var fName=fieldText('Name',merged.player_name,'Full name');
  var fId=fieldText('ID (Player ID Cubs)',merged.player_id,'e.g. 129393');
  var fPos=fieldSelect('Position',merged.position,POSITIONS);
  var fClass=fieldSelect('Class',merged.class,[''].concat(CLASS_OPTS));
  var fBats=fieldSeg('Bats',merged.bats,['R','L']);
  var fThrows=fieldSeg('Throws',merged.throws,['R','L']);
  var fDob=fieldDate('Date of birth',merged.dob);
  root.appendChild(fName);root.appendChild(fId);root.appendChild(fPos);root.appendChild(fClass);root.appendChild(fBats);root.appendChild(fThrows);root.appendChild(fDob);
  var acts=el('div',{className:'acts'});
  var cancel=el('button',{className:'ghost',textContent:'Cancel'});cancel.addEventListener('click',closeModal);
  var go=el('button',{className:'primary',textContent:'Merge profiles'});
  acts.appendChild(cancel);acts.appendChild(go);root.appendChild(acts);
  go.addEventListener('click',function(){
    var finalId=fId._input.value.trim();
    if(!finalId){ showToast('An ID is required',true); return; }
    var sourceIds=selectedRows.map(function(r){return String(r.player_id||r._id||'');});
    if(sourceIds.indexOf(finalId)<0 && rows.some(function(x){return String(x.player_id||x._id||'')===finalId;})){
      showToast('A different profile already uses ID '+finalId,true); return;
    }
    var finalDoc={
      player_id:finalId,
      player_name:fName._input.value.trim(),
      position:fPos._input.value||'',
      class:fClass._input.value||'',
      bats:fBats._state.v||'',
      throws:fThrows._state.v||'',
      dob:fDob._input.value||'',
      status:merged.status||{}
    };
    if(!DB){ showToast('Not connected to the database',true); return; }
    go.disabled=true;
    Promise.resolve(DB.upsert(finalId,finalDoc)).then(function(){
      var seen={},toRemove=[];
      sourceIds.forEach(function(id){ if(id&&id!==finalId&&!seen[id]){ seen[id]=1; toRemove.push(id); } });
      return Promise.all(toRemove.map(function(id){ return Promise.resolve(DB.remove(id)); }));
    }).then(function(){
      closeModal();
      showToast('Merged '+selectedRows.length+' profiles');
    }).catch(function(e){ go.disabled=false; showToast('Merge failed: '+(e&&e.message||e),true); });
  });
  openModalNode(root);
}

// ---- wire up static UI ----
$('search').addEventListener('input',function(e){ filterText=e.target.value.trim(); render(); });
$('addBtn').addEventListener('click',openNew);
$('mergeBtn').addEventListener('click',openMerge);
$('overlay').addEventListener('click',function(e){ if(e.target===$('overlay')) closeModal(); });
// bridge the module (Firestore) layer into this script's state
window.__applyData=function(list,api){ rows=list; if(api) DB=api; render(); };
window.__setDB=function(api){ DB=api; };
// auto-capitalize first letter of text inputs (matches the data-entry tool)
document.addEventListener('input',function(e){
  var t=e.target; if(!t||t.tagName!=='INPUT'||(t.type||'text')!=='text') return;
  var v=t.value; if(v && v.charAt(0)!==v.charAt(0).toUpperCase()){ var p=t.selectionStart; t.value=v.charAt(0).toUpperCase()+v.slice(1); try{t.setSelectionRange(p,p);}catch(_){} }
},true);
