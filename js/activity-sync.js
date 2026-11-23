/* Activity-based event synchronization: version only actual changes. */
(function(root){
'use strict';
var baselines=new WeakMap(),clock=0;
var client=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
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
function prime(ev){if(ev&&typeof ev==='object')baselines.set(ev,flat(ev));}
function capture(ev){
 var now=flat(ev),old=baselines.get(ev);
 if(!old){prime(ev);return false;}
 var changes=[],all=new Set(Object.keys(old).concat(Object.keys(now)));
 all.forEach(function(k){if(!equal(old[k]&&old[k].value,now[k]&&now[k].value)){
  var item=now[k]||old[k];changes.push({path:item.path,value:now[k]?now[k].value:null,deleted:!now[k]});
 }});
 if(changes.length){
  var ops=ev._activity||{};
  Object.keys(ops).forEach(function(k){clock=Math.max(clock,Number(ops[k].time)||0);});
  clock=Math.max(Date.now(),clock+1);ev._activity=ops;
  changes.forEach(function(c){c.time=clock;c.client=client;ops[key(c.path)]=c;});
 }
 baselines.set(ev,now);return !!changes.length;
}
function newer(a,b){return !b || Number(a.time)>Number(b.time) || (Number(a.time)===Number(b.time)&&String(a.client)>String(b.client));}
function combine(a,b){var ops={};[a,b].forEach(function(ev){Object.keys((ev&&ev._activity)||{}).forEach(function(k){var op=ev._activity[k];if(newer(op,ops[k]))ops[k]=op;});});var sorted={};Object.keys(ops).sort().forEach(function(k){sorted[k]=ops[k];});return sorted;}
function assign(obj,path,op){
 for(var i=0;i<path.length-1;i++){if(!obj[path[i]]||typeof obj[path[i]]!=='object')obj[path[i]]={};obj=obj[path[i]];}
 if(op.deleted)delete obj[path[path.length-1]];else obj[path[path.length-1]]=clone(op.value);
}
function apply(ev,ops){
 var players=ev.players||(ev.players=[]),byPid={};players.forEach(function(p,i){byPid[String(p._pid||('legacy:'+i))]=p;});
 var rows={},membership={};
 ev.data=ev.data||{};ev.data.devices=ev.data.devices||{};
 Object.keys(ops).sort().forEach(function(k){var op=ops[k],p=op.path;
  if(!Array.isArray(p))return;
  if(p[0]==='e'){assign(ev,p.slice(1),op);return;}
  if(p[0]==='x'){assign(ev.data,p.slice(1),op);return;}
  if(p[0]==='p'){
   var pl=byPid[p[1]];
   if(!pl){pl={_pid:p[1]};byPid[p[1]]=pl;players.push(pl);}
   if(p[2]==='@')membership[p[1]]=!(op.deleted||op.value===false);
   else assign(pl,p.slice(2),op);
  }
  if(p[0]==='d'){
   var d=ev.data.devices[p[1]]||(ev.data.devices[p[1]]={players:[]});d.players=d.players||[];
   var map=rows[p[1]];
   if(!map){map=rows[p[1]]={};d.players.forEach(function(r,i){map[rowKey(r,i)]=r;});}
   var r=map[p[2]];
   if(!r){r={};map[p[2]]=r;d.players.push(r);}
   if(p[3]==='@'){if(op.deleted||op.value===false)r.__activityRemoved=true;else delete r.__activityRemoved;}
   else assign(r,p.slice(3),op);
  }
 });
 for(var i=players.length-1;i>=0;i--)if(membership[String(players[i]._pid||('legacy:'+i))]===false)players.splice(i,1);
 Object.keys(ev.data.devices).forEach(function(k){var d=ev.data.devices[k];if(d.players){for(var i=d.players.length-1;i>=0;i--)if(d.players[i].__activityRemoved)d.players.splice(i,1);}});
 ev._activity=ops;return ev;
}
function merge(a,b){
 var out=clone(b||a||{}),ops=combine(a,b);
 // Existing unchanged roster entries are retained; membership operations decide removals.
 var seen={};(out.players||[]).forEach(function(p){seen[p._pid]=true;});
 (a&&a.players||[]).forEach(function(p){if(p._pid&&!seen[p._pid]){out.players=out.players||[];out.players.push(clone(p));seen[p._pid]=true;}});
 return apply(out,ops);
}
function payloadMerge(stored,sent){
 var a=null,b=null;
 try{a=JSON.parse((stored||{}).data||'null');b=JSON.parse(sent.data||'null');}catch(e){}
 if(!a||!b||!Object.keys(b._activity||{}).length)return sent;
 var merged=merge(a,b),payload=Object.assign({},sent);
 payload.data=JSON.stringify(merged);payload.name=merged.name||'';payload.date=merged.date||'';
 payload.player_count=(merged.players||[]).length;
 return payload;
}
function receive(local,remote){
 // Capture unsent local work before incorporating a remote operation.
 capture(local);
 var old=flat(local),ops=combine(local,remote);
 // New players on another device arrive without rebuilding existing player objects.
 var ids={};(local.players||[]).forEach(function(p){ids[p._pid]=true;});
 (remote.players||[]).forEach(function(p){if(p._pid&&!ids[p._pid]){local.players.push(clone(p));ids[p._pid]=true;}});
 apply(local,ops);prime(local);
 var after=flat(local),structural=false;
 var keys=new Set(Object.keys(old).concat(Object.keys(after)));keys.forEach(function(k){var item=after[k]||old[k];if(item.path[item.path.length-1]==='@'&&!equal(old[k]&&old[k].value,after[k]&&after[k].value))structural=true;});
 return {changed:!equal(old,after),structural:structural,needsWrite:Object.keys(ops).some(function(k){return !equal(ops[k],(remote._activity||{})[k]);})};
}
root.ActivitySync={prime:prime,capture:capture,merge:merge,receive:receive,flat:flat,combine:combine,payloadMerge:payloadMerge};
})(typeof window!=='undefined'?window:globalThis);
