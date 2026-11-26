/* Durable local-first event snapshots and per-field pending edits. */
(function(root){
'use strict';
var db=null,readyResolve,readyReject,chain=Promise.resolve(),client=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),journalKey='meas_local_journal_'+client;
var ready=new Promise(function(resolve,reject){readyResolve=resolve;readyReject=reject;});
function copy(x){return JSON.parse(JSON.stringify(x));}
function id(ev){return String(ev._dbId||ev.event_id||ev.date.replace(/\D/g,'')+'_'+ev.name.replace(/[^a-zA-Z0-9]+/g,'_'));}
function compact(v,k){if(k==='_activity')return v;if(Array.isArray(v))return v.map(function(x){return compact(x)||{};});if(v&&typeof v==='object'){var o={};Object.keys(v).forEach(function(n){var x=compact(v[n],n);if(x!==undefined)o[n]=x;});return o;}return v;}
function getAll(){return new Promise(function(resolve,reject){var tx=db.transaction('events','readonly'),req=tx.objectStore('events').getAll();req.onsuccess=function(){resolve(req.result||[]);};req.onerror=function(){reject(req.error);};});}
function transact(fn){return new Promise(function(resolve,reject){var tx=db.transaction('events','readwrite');var result;tx.oncomplete=function(){resolve(result);};tx.onerror=tx.onabort=function(){reject(tx.error||Error('Local save failed'));};fn(tx.objectStore('events'),function(v){result=v;});});}
function enqueue(fn){var next=chain.catch(function(){}).then(fn);chain=next;return next;}
function mergeOps(a,b){var x={};[a||{},b||{}].forEach(function(ops){Object.keys(ops).forEach(function(k){var op=ops[k],old=x[k];if(!old||Number(op.time)>Number(old.time)||Number(op.time)===Number(old.time)&&String(op.client)>String(old.client))x[k]=op;});});return x;}
function delta(before,after){var out={};Object.keys(after||{}).forEach(function(k){if(JSON.stringify(before&&before[k])!==JSON.stringify(after[k]))out[k]=copy(after[k]);});return out;}
var journals={};
function writeJournal(key,ev,ops){
 if(!Object.keys(ops||{}).length)return;
 var old=journals[key]||{id:key,ops:{},players:[],devices:{}};old.ops=mergeOps(old.ops,ops);old.name=ev.name;old.date=ev.date;
 (ev.players||[]).forEach(function(p){if(Object.keys(ops).some(function(k){return ops[k].path[0]==='p'&&ops[k].path[1]===p._pid;})){var i=old.players.findIndex(function(x){return x._pid===p._pid;});if(i<0)old.players.push(copy(p));else old.players[i]=copy(p);}});
 old.data=copy(ev.data||{});journals[key]=old;
 try{localStorage.setItem(journalKey,JSON.stringify(journals));return true;}catch(e){return false;}
}
function save(ev,newOps){
 var snapshot=copy(ev),key=id(snapshot),ops=copy(newOps||{});snapshot._dbId=key;
 writeJournal(key,snapshot,ops);
 return enqueue(function(){return transact(function(store,done){var req=store.get(key);req.onsuccess=function(){
  var old=req.result,pending=mergeOps(old&&old.pending,ops);
  var merged=old?root.ActivitySync.mergePending(old.event,snapshot,pending):snapshot;
  store.put({id:key,event:merged,pending:pending,updatedAt:Date.now()});done({id:key,event:merged,pending:pending});
 };});}).then(function(record){if(journals[key]){Object.keys(ops).forEach(function(k){if(JSON.stringify(journals[key].ops[k])===JSON.stringify(ops[k]))delete journals[key].ops[k];});if(!Object.keys(journals[key].ops).length)delete journals[key];}try{if(Object.keys(journals).length)localStorage.setItem(journalKey,JSON.stringify(journals));else localStorage.removeItem(journalKey);}catch(e){}return record;});
}
function pending(){return enqueue(getAll).then(function(rows){return rows.filter(function(r){return Object.keys(r.pending||{}).length;});});}
function acknowledge(key,sent){return enqueue(function(){return transact(function(store,done){var req=store.get(key);req.onsuccess=function(){var r=req.result;if(!r){done(null);return;}Object.keys(sent||{}).forEach(function(k){if(JSON.stringify(r.pending[k])===JSON.stringify(sent[k]))delete r.pending[k];});store.put(r);done(r);};});});}
function remove(key){return enqueue(function(){return transact(function(store){store.delete(key);});});}
function open(){try{var req=indexedDB.open('meas-local-first-v1',1);req.onupgradeneeded=function(){req.result.createObjectStore('events',{keyPath:'id'});};req.onerror=function(){readyReject(req.error);};req.onsuccess=function(){db=req.result;getAll().then(function(rows){
 var recovered=[],recoveryKeys=[];for(var i=0;i<(function(){try{return localStorage.length;}catch(e){return 0;}})();i++){var k=localStorage.key(i);if(k&&k.indexOf('meas_local_journal_')===0){try{recoveryKeys.push(k);var journal=JSON.parse(localStorage.getItem(k));Object.keys(journal||{}).forEach(function(key){var j=journal[key],ev={_dbId:key,name:j.name,date:j.date,players:j.players||[],data:j.data||{},_activity:j.ops||{},_activityEvent:key};recovered.push(save(ev,j.ops));});}catch(e){}}}
 return Promise.all(recovered).then(function(){recoveryKeys.forEach(function(k){try{localStorage.removeItem(k);}catch(e){}});return getAll();});
 }).then(readyResolve,readyReject);};}catch(e){readyReject(e);}}
root.LocalEdits={ready:ready,save:save,pending:pending,acknowledge:acknowledge,remove:remove,delta:delta,id:id,flush:function(){return chain;}};open();
})(window);
