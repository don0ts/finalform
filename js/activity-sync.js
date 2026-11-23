/* Activity-based event synchronization: version only actual changes. */
(function(root){
'use strict';
var baselines=new WeakMap(),clock=0;
var client=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
var nameIndex=0,idIndex=1;
var skip=new Set(['_dbSig','_syncId','_lastPosKey','__ei']);
function clone(v){return v===undefined?null:JSON.parse(JSON.stringify(v));}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function key(path){return JSON.stringify(path);}
function rowKey(r,i){return String(r.linkPid||r.cubsId||r.id||r.name||i)+'|'+String(r.hand||'');}
function flat(ev){
 var out={};function put(path,v){out[key(path)]={path:path,value:clone(v)};}
 ['name','date'].forEach(function(f){put(['e',f],ev[f]||'');});
 (ev.players||[]).forEach(function(p,i){
  var pid=String(p._pid||('legacy:'+i));put(['p',pid,'@'],true);
  Object.keys(p).forEach(function(f){if(skip.has(f)||f==='_pid')return;
   if(f==='_dev'&&p[f]&&typeof p[f]==='object'){Object.keys(p[f]).forEach(function(g){put(['p',pid,'_dev',g],p[f][g]);});}
   else put(['p',pid,f],p[f]);
  });
 });
 function walk(value,path){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   Object.keys(value).forEach(function(f){walk(value[f],path.concat(f));});
  }else put(path,value);
 }
 var data=ev.data||{};
 Object.keys(data).forEach(function(f){if(f!=='devices')walk(data[f],['x',f]);});
 Object.keys(data.devices||{}).forEach(function(dk){
  var d=data.devices[dk]||{};
  Object.keys(d).forEach(function(f){if(f!=='players')walk(d[f],['x','devices',dk,f]);});
  (d.players||[]).forEach(function(r,i){var rk=rowKey(r,i);put(['d',dk,rk,'@'],true);
   Object.keys(r).forEach(function(f){walk(r[f],['d',dk,rk,f]);});
  });
 });
 return out;
}
function scope(ev){return String((ev&& (ev._dbId||ev.event_id||ev._activityEvent))||'');}
function validOps(ev){
 var ops=(ev&&ev._activity)||{},out={},sid=scope(ev);
 if(ev&&ev._activityEvent&&sid&&ev._activityEvent!==sid)return out;
 Object.keys(ops).forEach(function(k){var op=ops[k];
  if(!op||!Array.isArray(op.path)||key(op.path)!==k)return;
  if(op.event&&sid&&op.event!==sid)return;
  out[k]=op;
 });return out;
}
function prime(ev){if(ev&&typeof ev==='object'){
 ev._activity=validOps(ev);if(scope(ev))ev._activityEvent=scope(ev);
 baselines.set(ev,flat(ev));
}}

function capture(ev){
 var now=flat(ev),old=baselines.get(ev);
 if(!old){prime(ev);return false;}
 var changes=[],all=new Set(Object.keys(old).concat(Object.keys(now)));
 all.forEach(function(k){if(!equal(old[k]&&old[k].value,now[k]&&now[k].value)){
  var item=now[k]||old[k];changes.push({path:item.path,value:now[k]?now[k].value:null,deleted:!now[k]});
 }});
 if(changes.length){
  var ops=validOps(ev);
  Object.keys(ops).forEach(function(k){clock=Math.max(clock,Number(ops[k].time)||0);});
  clock=Math.max(Date.now(),clock+1);ev._activity=ops;
  changes.forEach(function(c){c.time=clock;c.client=client;if(scope(ev))c.event=scope(ev);ops[key(c.path)]=c;});
  if(scope(ev))ev._activityEvent=scope(ev);
 }
 baselines.set(ev,now);return !!changes.length;
}
function newer(a,b){return !b || Number(a.time)>Number(b.time) || (Number(a.time)===Number(b.time)&&String(a.client)>String(b.client));}
function combine(a,b){
 var ops={},as=scope(a),bs=scope(b);
 [a,b].forEach(function(ev){
  if(ev===b&&as&&bs&&as!==bs)return;
  var valid=validOps(ev);
  Object.keys(valid).forEach(function(k){var op=valid[k];if(newer(op,ops[k]))ops[k]=op;});
 });
 var sorted={};Object.keys(ops).sort().forEach(function(k){sorted[k]=ops[k];});return sorted;
}
function membership(ops,path){return ops[key(path.concat('@'))];}
function admits(ops,path){var op=membership(ops,path);return !!(op&&!op.deleted&&op.value===true);}
function revoked(ops,path){var op=membership(ops,path);return !!(op&&(op.deleted||op.value===false));}
function fold(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function preserveRemovals(ev,remote,ops){
 var records={},sid=scope(ev)||scope(remote);
 [ev,remote].forEach(function(e){(e&&e._removedPlayers||[]).forEach(function(r){
  var k=JSON.stringify([r.id||'',r.pid||'',r.name||'']);if(!records[k]||Number(r.at)>Number(records[k].at))records[k]=r;
 });});
 var removed=Object.keys(records).sort().map(function(k){return records[k];});
 if(removed.length)ev._removedPlayers=removed;
 [ev,remote].forEach(function(e){(e&&e.players||[]).forEach(function(p){
  if(!p._pid)return;
  var id=String(p[idIndex]||'').trim(),name=fold(p[nameIndex]);
  removed.forEach(function(r){
   var same=(r.pid&&r.pid===p._pid)||(r.id&&id?r.id===id:!!(r.name&&r.name===name));
   if(!same||Number(p._rosterAddedAt||0)>Number(r.at||0))return;
   var path=['p',String(p._pid),'@'],k=key(path),op={path:path,value:null,deleted:true,time:Number(r.at)||0,client:'roster-removal'};
   if(sid)op.event=sid;
   // The add-time marker distinguishes a real re-add from a stale copy.
   if(ops[k]&&!ops[k].deleted&&ops[k].value===true)op.time=Math.max(op.time,Number(ops[k].time||0)+1);
   if(newer(op,ops[k]))ops[k]=op;
  });
 });});
 return ops;
}
function prepareCandidates(ev,remote,ops){
 var remoteOps=validOps(remote);
 var players=ev.players||(ev.players=[]),ids={};players.forEach(function(p){if(p._pid)ids[p._pid]=true;});
 (remote&&remote.players||[]).forEach(function(p){
  if(p._pid&&!ids[p._pid]&&admits(remoteOps,['p',String(p._pid)])&&admits(ops,['p',String(p._pid)])){
   players.push(clone(p));ids[p._pid]=true;
  }
 });
 ev.data=ev.data||{};ev.data.devices=ev.data.devices||{};
 Object.keys((remote&&remote.data&&remote.data.devices)||{}).forEach(function(dk){
  var rows=remote.data.devices[dk].players||[],d=ev.data.devices[dk];
  rows.forEach(function(r,i){
   var rk=rowKey(r,i);if(!admits(remoteOps,['d',dk,rk])||!admits(ops,['d',dk,rk]))return;
   if(r.linkPid&&(!ids[String(r.linkPid)]||revoked(ops,['p',String(r.linkPid)])))return;
   if(!d)d=ev.data.devices[dk]={players:[]};d.players=d.players||[];
   if(!d.players.some(function(existing,j){return rowKey(existing,j)===rk;}))d.players.push(clone(r));
  });
 });
}
function assign(obj,path,op){
 for(var i=0;i<path.length-1;i++){if(!obj[path[i]]||typeof obj[path[i]]!=='object')obj[path[i]]={};obj=obj[path[i]];}
 if(op.deleted)delete obj[path[path.length-1]];else obj[path[path.length-1]]=clone(op.value);
}
function apply(ev,ops){
 var players=ev.players||(ev.players=[]),byPid={};players.forEach(function(p,i){byPid[String(p._pid||('legacy:'+i))]=p;});
 var rows={},membership={};
 ev.data=ev.data||{};ev.data.devices=ev.data.devices||{};
 // A removal remains authoritative even if the player is already absent.
 Object.keys(ops).forEach(function(k){var op=ops[k],p=op.path;if(p[0]==='p'&&p[2]==='@')membership[p[1]]=!(op.deleted||op.value===false);});
 Object.keys(ops).sort().forEach(function(k){var op=ops[k],p=op.path;
  if(!Array.isArray(p))return;
  if(p[0]==='e'){assign(ev,p.slice(1),op);return;}
  if(p[0]==='x'){assign(ev.data,p.slice(1),op);return;}
  if(p[0]==='p'){
   var pl=byPid[p[1]];
   // Field history is not roster membership: never invent a player here.
   if(!pl)return;
   if(p[2]==='@')membership[p[1]]=!(op.deleted||op.value===false);
   else assign(pl,p.slice(2),op);
  }
  if(p[0]==='d'){
   var d=ev.data.devices[p[1]];if(!d)return;d.players=d.players||[];
   var map=rows[p[1]];
   if(!map){map=rows[p[1]]={};d.players.forEach(function(r,i){map[rowKey(r,i)]=r;});}
   var r=map[p[2]];
   if(!r)return;
   if(p[3]==='@'){if(op.deleted||op.value===false)r.__activityRemoved=true;else delete r.__activityRemoved;}
   else assign(r,p.slice(3),op);
  }
 });
 for(var i=players.length-1;i>=0;i--)if(membership[String(players[i]._pid||('legacy:'+i))]===false)players.splice(i,1);
 Object.keys(ev.data.devices).forEach(function(k){var d=ev.data.devices[k];if(d.players){for(var i=d.players.length-1;i>=0;i--)if(d.players[i].__activityRemoved || (d.players[i].linkPid && membership[String(d.players[i].linkPid)]===false))d.players.splice(i,1);}});
 ev._activity=ops;return ev;
}
function merge(a,b){
 // The stored event is the baseline. Only explicit membership activity can
 // add another copy's row; its field history alone cannot resurrect a row.
 if(scope(a)&&scope(b)&&scope(a)!==scope(b))return clone(a);
 var out=clone(a||b||{}),ops=combine(a,b);
 if(scope(b)||scope(a))out._activityEvent=scope(a)||scope(b);
 preserveRemovals(out,b,ops);
 prepareCandidates(out,b,ops);
 return apply(out,ops);
}
function payloadMerge(stored,sent){
 var a=null,b=null;
 try{a=JSON.parse((stored||{}).data||'null');b=JSON.parse(sent.data||'null');}catch(e){}
 if(!a||!b||!Object.keys(b._activity||{}).length)return sent;
 if(stored.event_id)a._dbId=stored.event_id;
 if(sent.event_id){a._dbId=sent.event_id;b._dbId=sent.event_id;}
 var merged=merge(a,b);delete merged._dbId;
 var payload=Object.assign({},sent);
 payload.data=JSON.stringify(merged);payload.name=merged.name||'';payload.date=merged.date||'';
 payload.player_count=(merged.players||[]).length;
 return payload;
}
function receive(local,remote){
 // Capture unsent local work before incorporating a remote operation.
 capture(local);
 var old=flat(local),oldRemovals=JSON.stringify(local._removedPlayers||[]),ops=combine(local,remote);
 // Unknown identities need an explicit add AND a real row in that event.
 if(scope(local)&&scope(remote)&&scope(local)!==scope(remote))return {changed:false,structural:false,needsWrite:false};
 preserveRemovals(local,remote,ops);
 prepareCandidates(local,remote,ops);
 apply(local,ops);prime(local);
 var after=flat(local),structural=false;
 var keys=new Set(Object.keys(old).concat(Object.keys(after)));keys.forEach(function(k){var item=after[k]||old[k];if(item.path[item.path.length-1]==='@'&&!equal(old[k]&&old[k].value,after[k]&&after[k].value))structural=true;});
 return {changed:!equal(old,after)||oldRemovals!==JSON.stringify(local._removedPlayers||[]),structural:structural,needsWrite:Object.keys(ops).some(function(k){return !equal(ops[k],(remote._activity||{})[k]);})};
}
root.ActivitySync={configure:function(name,id){nameIndex=name;idIndex=id;},prime:prime,capture:capture,merge:merge,receive:receive,flat:flat,combine:combine,payloadMerge:payloadMerge};
})(typeof window!=='undefined'?window:globalThis);
