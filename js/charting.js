const STORAGE_KEY = 'pitch_recorder_compact_v1';
const FLOAT_KEY = 'pitch_recorder_compact_float_v1';

const $ = id => document.getElementById(id);
function uid(prefix){ return (prefix||'id') + '_' + Math.random().toString(36).slice(2,9); }

/* ===================== Firebase (player search) ===================== */
const firebaseConfig = {
  apiKey: "AIzaSyDzxseQexlbv0onZH2l5PHNDa5ZKFv5Kz8",
  authDomain: "cubsentry.web.app",
  projectId: "cubsentry",
  storageBucket: "cubsentry.firebasestorage.app",
  messagingSenderId: "929110932897",
  appId: "1:929110932897:web:1d91596a2787084a085fe0"
};
const COLLECTION = "Players";
let _db = null;
try { if (window.firebase && firebase.initializeApp){ firebase.initializeApp(firebaseConfig); _db = firebase.firestore(); } }
catch(err){ console.error('Firebase init failed', err); }

// derive the display name from a player document (search is by player_name)
function playerDocName(data, id){
  if (!data) return id;
  const direct = data.player_name || data.playerName || data.name || data.Name || data.fullName || data.full_name;
  if (direct) return String(direct);
  const first = data.firstName || data.first_name || data.first || '';
  const last  = data.lastName  || data.last_name  || data.last  || '';
  const combo = (String(first)+' '+String(last)).trim();
  if (combo) return combo;
  return id;
}
// derive the Player_ID value stored on a player document (fallback: Firestore doc id)
function playerDocId(data, id){
  if (data){ const pid = data.player_id!=null ? data.player_id : (data.playerId!=null ? data.playerId : (data.Player_ID!=null ? data.Player_ID : null)); if (pid!=null && pid!=='') return String(pid); }
  return id;
}

// live cache of the whole Players collection, kept in sync in real time via onSnapshot.
// New / edited / deleted players (from the Profile Manager or any other tool writing
// to the same "Players" collection) show up here automatically without a reload.
let _playerCache = [], _playerCacheReady = false, _playerCacheError = false;
let _playerCacheLoading = null, _playerCacheResolve = null;
function loadPlayerCache(){
  if (_playerCacheReady || _playerCacheError) return Promise.resolve(_playerCache);
  if (_playerCacheLoading) return _playerCacheLoading;
  if (!_db){ _playerCacheError = true; _playerCache = []; return Promise.resolve(_playerCache); }
  // first-call promise resolves when the first snapshot arrives
  _playerCacheLoading = new Promise(res => { _playerCacheResolve = res; });
  startPlayerCacheListener();
  return _playerCacheLoading;
}
function startPlayerCacheListener(){
  if (!_db || _playerCache._listening) return;
  _playerCache._listening = true;
  try {
    _db.collection(COLLECTION).onSnapshot(
      snap => {
        const list = snap.docs.map(d => { const data=d.data(); return { id:playerDocId(data, d.id), name:playerDocName(data, d.id) }; });
        list.sort((a,b)=> a.name.localeCompare(b.name));
        _playerCache = list; _playerCache._listening = true;
        _playerCacheReady = true; _playerCacheError = false;
        if (_playerCacheResolve){ _playerCacheResolve(_playerCache); _playerCacheResolve = null; }
      },
      err => {
        console.error('Firestore live listen failed', err);
        _playerCacheError = true;
        if (_playerCacheResolve){ _playerCacheResolve(_playerCache); _playerCacheResolve = null; }
      }
    );
  } catch(err){
    console.error('Firestore listener setup failed', err);
    _playerCacheError = true;
    if (_playerCacheResolve){ _playerCacheResolve(_playerCache); _playerCacheResolve = null; }
  }
}
// kick off the live listener as soon as the DB is ready
if (_db) startPlayerCacheListener();

// rank search results by how closely a name matches the typed term:
//   0 = name starts with the term            ("Ye" -> "Yeanderson ...")
//   1 = a later word in the name starts with it ("Mar" -> "Yenderson Martinez")
//   2 = term appears somewhere inside the name
// ties within a rank are broken alphabetically (A -> Z).
function matchRank(name, t){
  const n = name.toLowerCase();
  if (n.startsWith(t)) return 0;
  const words = n.split(/\s+/);
  for (let i=1;i<words.length;i++){ if (words[i].startsWith(t)) return 1; }
  if (n.indexOf(t) >= 0) return 2;
  return -1;
}
// Rank/match players by NAME or by their player_id (from the Firebase "Players"
// database). An id match ranks: exact / starts-with = 0 (top), contains = 2.
function matchIdRank(id, t){
  const s = String(id==null?'':id).toLowerCase();
  if (!s) return -1;
  if (s===t || s.startsWith(t)) return 0;
  if (s.indexOf(t) >= 0) return 2;
  return -1;
}
function searchPlayers(term){
  const t = String(term||'').trim().toLowerCase();
  return loadPlayerCache().then(list => {
    if (!t) return list.slice(0, 12); // list is already alphabetical
    const scored = [];
    for (const p of list){
      let r = matchRank(p.name, t);
      const ir = matchIdRank(p.id, t);           // also search by player_id
      if (ir >= 0 && (r < 0 || ir < r)) r = ir;  // keep the best (lowest) rank
      if (r >= 0) scored.push({ p, r });
    }
    scored.sort((a,b)=> a.r - b.r || a.p.name.localeCompare(b.p.name));
    return scored.slice(0, 12).map(s => s.p);
  });
}

// record the Firestore id chosen for a given player name on the current session
function ensurePlayerIds(sess){ if (sess && !sess.playerIds) sess.playerIds = {}; }
function assignPlayerId(name, id){ const sess=getCurrentSession(); if(!sess) return; ensurePlayerIds(sess); sess.playerIds[name] = id; saveAll(); }
function playerIdFor(sess, name){
  if(!sess||!name) return '';
  ensurePlayerIds(sess);
  // IDs are NOT read from the database automatically anymore. We only return
  // the id explicitly linked to this player (via the search picker, an
  // "name #id" add, Edit Players, or the "Sync IDs" button). Use Sync IDs to
  // pull/refresh ids from the live Players collection on demand.
  if(sess.playerIds[name]) return String(sess.playerIds[name]);
  return '';
}
/* ===== Sync IDs: on-demand only (no automatic DB reads) =====
   Resolves every player currently in the session (game lineup + workout lists +
   anything already in the logs) against the live Players collection by name
   (falling back to a stored id when the name was renamed in the DB) and stores
   the real player_id. Re-stamps existing log entries so their exported ids
   match. Nothing here runs on its own — only when the Sync IDs button is used. */
/* ===== CSV helpers for re-stamping stored CSV player ids on Sync IDs ===== */
// Minimal RFC4180-style parser: handles quoted fields, escaped "" quotes and
// CR/LF. Returns an array of rows (each an array of string cells).
function parseCsvRows(text){
  const rows=[]; let row=[]; let field=''; let inq=false; const s=String(text||''); let i=0;
  while(i<s.length){
    const c=s[i];
    if(inq){
      if(c==='"'){ if(s[i+1]==='"'){ field+='"'; i+=2; continue; } inq=false; i++; continue; }
      field+=c; i++; continue;
    }
    if(c==='"'){ inq=true; i++; continue; }
    if(c===','){ row.push(field); field=''; i++; continue; }
    if(c==='\r'){ i++; continue; }
    if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; i++; continue; }
    field+=c; i++;
  }
  if(field!=='' || row.length){ row.push(field); rows.push(row); }
  return rows;
}
function serializeCsvRows(rows, trailingNl){
  return rows.map(r=>r.map(csvEscape).join(',')).join('\n') + (trailingNl?'\n':'');
}
// Re-stamp PLAYER_ID / PITCHER_ID columns of one stored CSV using the current
// (post-sync) id resolution keyed off the PLAYER / PITCHER name columns.
function restampCsvIds(sess, content){
  const trailingNl=/\n$/.test(String(content||''));
  const rows=parseCsvRows(content);
  if(rows.length<2) return { content, changed:false };
  const header=rows[0].map(h=>String(h||'').trim().toUpperCase());
  const pName=header.indexOf('PLAYER'), pId=header.indexOf('PLAYER_ID');
  const ptName=header.indexOf('PITCHER'), ptId=header.indexOf('PITCHER_ID');
  if(pId<0 && ptId<0) return { content, changed:false };
  let changed=false;
  function stamp(row, nameCol, idCol){
    if(idCol<0 || nameCol<0 || nameCol>=row.length) return;
    const nm=row[nameCol];
    if(!nm || !String(nm).trim()) return;
    const newId=String(playerIdFor(sess, nm)||'');
    while(row.length<=idCol) row.push('');
    if(String(row[idCol]||'')!==newId){ row[idCol]=newId; changed=true; }
  }
  for(let r=1;r<rows.length;r++){ stamp(rows[r], pName, pId); stamp(rows[r], ptName, ptId); }
  return changed ? { content: serializeCsvRows(rows, trailingNl), changed:true } : { content, changed:false };
}

function syncIds(){
  const sess=getCurrentSession();
  if(!sess){ showToast('Create/select an event first'); return; }
  if(!(Array.isArray(_playerCache) && _playerCache.length)){ showToast(_playerCacheError?'Database unavailable (offline?)':'Still loading players — try again'); return; }
  ensurePlayerIds(sess); ensureWorkout(sess);
  const names=new Set();
  ['top','bot'].forEach(sd=>{ const t=sess.teams&&sess.teams[sd]; if(t){ (t.pitchers||[]).forEach(n=>n&&names.add(n)); (t.hitters||[]).forEach(n=>n&&names.add(n)); } });
  const w=sess.workout;
  if(w.dash) (w.dash.players||[]).forEach(n=>n&&names.add(n));
  if(w.defense) (w.defense.outfielders||[]).concat(w.defense.infielders||[], w.defense.catchers||[]).forEach(n=>n&&names.add(n));
  if(w.bp) (w.bp.players||[]).forEach(n=>n&&names.add(n));
  (sess.events||[]).forEach(e=>{ if(e.player) names.add(e.player); if(e.pitcher) names.add(e.pitcher); });
  let n=0;
  names.forEach(name=>{
    const t=String(name).trim().toLowerCase();
    let hit=_playerCache.find(p=>p.name && p.name.trim().toLowerCase()===t);
    const stored=sess.playerIds[name];
    if(!hit && stored!=null && stored!=='') hit=_playerCache.find(p=>String(p.id)===String(stored)||String(p.docId)===String(stored));
    if(hit && hit.id!=null && hit.id!==''){ if(String(sess.playerIds[name]||'')!==String(hit.id)){ sess.playerIds[name]=String(hit.id); n++; } }
  });
  (sess.events||[]).forEach(e=>{ if(e.player) e.player_id=playerIdFor(sess,e.player); if(e.pitcher) e.pitcher_id=playerIdFor(sess,e.pitcher); });
  ['dash','defense','bp'].forEach(k=>{ const st=w[k]; if(st&&st.events) st.events.forEach(e=>{ if(e.player) e.player_id=playerIdFor(sess,e.player); }); });
  let csvN=0;
  (sess.csvStorage||[]).forEach(c=>{ const r=restampCsvIds(sess, c.content); if(r.changed){ c.content=r.content; csvN++; } });
  saveAll(); renderAll();
  const parts=[]; if(n) parts.push(n+' player'+(n>1?'s':'')); if(csvN) parts.push(csvN+' stored CSV'+(csvN>1?'s':''));
  showToast(parts.length?('Synced IDs — '+parts.join(', ')+' updated'):'IDs already up to date');
}

/* attach a Firestore-backed suggestion dropdown to an add-player input.
   onPick(name, id) is called when a DB player is chosen. */
function attachPlayerSearch(input, onPick){
  if (!input) return;
  const box = document.createElement('div'); box.className = 'player-suggest'; (input.parentElement || document.body).appendChild(box);
  let items = [], active = -1, open = false, debounce = null;
  function position(){ /* dropdown is CSS-anchored directly under the input's row (position:absolute), so no manual coordinates needed */ }
  function hide(){ open = false; box.classList.remove('open'); active = -1; }
  function show(){ position(); open = true; box.classList.add('open'); }
  function render(){
    box.innerHTML = '';
    if (_playerCacheError){ const n=document.createElement('div'); n.className='psnote'; n.textContent='Database unavailable (offline?). You can still type a name manually.'; box.appendChild(n); show(); return; }
    if (!items.length){ const n=document.createElement('div'); n.className='psnote'; n.textContent='No matching players in database.'; box.appendChild(n); show(); return; }
    items.forEach((p, i) => {
      const b = document.createElement('button'); b.type='button';
      const nm = document.createElement('span'); nm.textContent = p.name;
      const idl = document.createElement('span'); idl.className='psid'; idl.textContent = 'ID: ' + p.id;
      b.appendChild(nm); b.appendChild(idl);
      if (i===active) b.classList.add('active');
      b.addEventListener('mousedown', (e)=>{ e.preventDefault(); choose(p); });
      box.appendChild(b);
    });
    show();
  }
  function choose(p){ hide(); onPick(p.name, p.id); input.value=''; }
  function query(){ const term = input.value; if (!term || !term.trim()){ if (debounce) clearTimeout(debounce); items = []; active = -1; hide(); return; } if (debounce) clearTimeout(debounce); debounce = setTimeout(()=>{ searchPlayers(term).then(res => { items = res; active = -1; render(); }); }, 160); }
  input.addEventListener('focus', query);
  input.addEventListener('input', query);
  input.addEventListener('keydown', (e)=>{
    if (!open) return;
    if (e.key==='ArrowDown'){ e.preventDefault(); if(items.length){ active=(active+1)%items.length; render(); } }
    else if (e.key==='ArrowUp'){ e.preventDefault(); if(items.length){ active=(active-1+items.length)%items.length; render(); } }
    else if (e.key==='Enter'){ if (active>=0 && items[active]){ e.preventDefault(); e.stopPropagation(); choose(items[active]); } }
    else if (e.key==='Escape'){ hide(); }
  });
  input.addEventListener('blur', ()=> setTimeout(hide, 150));
  window.addEventListener('scroll', ()=>{ if(open) position(); }, true);
  window.addEventListener('resize', ()=>{ if(open) position(); });
}
/* ================================================================== */
function titleCaseName(s){ if (!s) return ''; return s.trim().split(/\s+/).map(w => { const low = w.toLowerCase(); return low.charAt(0).toUpperCase() + low.slice(1); }).join(' '); }
// Parse an "Add" entry that may carry a jersey/player ID alongside the name.
// Accepted: "Name #12", "Name, 12", "12, Name", "Name 12", "12 Name". Returns {name,id}.
function parseNameAndId(raw){
  let s=(raw||'').trim(); if(!s) return {name:'',id:''};
  let id='';
  const hash = s.match(/#\s*([A-Za-z0-9._-]+)/);
  if (hash){ id=hash[1]; s=s.replace(hash[0],' ').trim(); }
  else if (s.indexOf(',')>=0){ const parts=s.split(',').map(x=>x.trim()).filter(Boolean); const ni=parts.findIndex(p=>/^[0-9]+$/.test(p)); if(ni>=0){ id=parts[ni]; s=parts.filter((_,i)=>i!==ni).join(' ').trim(); } else { s=parts.join(' '); } }
  else { const tm=s.match(/^(.*?)\s+([0-9]+)$/); const lm=s.match(/^([0-9]+)\s+(.*)$/); if(tm){ s=tm[1].trim(); id=tm[2]; } else if(lm){ id=lm[1]; s=lm[2].trim(); } }
  return { name: titleCaseName(s), id: String(id||'').trim() };
}
function compactName(name){ if (!name) return ''; const parts = name.trim().split(/\s+/); if (parts.length===1){ if (parts[0].length<=12) return parts[0]; return parts[0].slice(0,1)+'. '+parts[0].slice(Math.max(1, parts[0].length-12)); } const last = parts[parts.length-1]; const first = parts[0].charAt(0).toUpperCase(); return first + '. ' + last; }
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const modalRoot = $('modal-root');
function showModal(opts){
  opts = opts || {};
  const title = opts.title||'', message = opts.message||'', html = opts.html||null;
  const buttons = opts.buttons || [{label:'OK',value:true,className:'btn'}];
  return new Promise(resolve=>{
    modalRoot.innerHTML = '';
    modalRoot.style.display = 'flex';
    const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div'); modal.className = 'modal';
    if (title){ const h = document.createElement('h4'); h.textContent = title; modal.appendChild(h); }
    if (html){ const w = document.createElement('div'); w.innerHTML = html; modal.appendChild(w); }
    else { const p = document.createElement('div'); p.className = 'muted-note'; p.textContent = message; modal.appendChild(p); }
    const row = document.createElement('div'); row.style.gap='8px'; row.style.marginTop='10px';
    if (opts.gridCols){ row.style.display='grid'; row.style.gridTemplateColumns='repeat('+opts.gridCols+',1fr)'; }
    else { row.style.display='flex'; row.style.justifyContent='flex-end'; row.style.flexWrap='wrap'; }
    buttons.forEach(b => { const btn = document.createElement('button'); btn.textContent = b.label; btn.className = b.className || 'btn'; if (b.id) btn.id = b.id; if (opts.gridCols && b.fullWidth) btn.style.gridColumn='1 / -1'; btn.addEventListener('click', ()=>{ modalRoot.style.display = 'none'; resolve(b.value); }); row.appendChild(btn); });
    modal.appendChild(row);
    if (opts.showBack){ const back = document.createElement('button'); back.type='button'; back.className='modal-back'; back.innerHTML='\u2190'; back.setAttribute('aria-label','Back'); back.addEventListener('click', ()=>{ modalRoot.style.display='none'; resolve('__back__'); }); modal.appendChild(back); }
    modal.querySelectorAll('[data-resolve]').forEach(el=> el.addEventListener('click', ()=>{ modalRoot.style.display='none'; resolve(el.getAttribute('data-resolve')); }));
    modalRoot.appendChild(backdrop); modalRoot.appendChild(modal);
  });
}
function promptModal(title, initial){
  initial = initial||'';
  return new Promise(resolve=>{
    const html = '<div style="display:flex;flex-direction:column;gap:8px"><input id="prompt-val" value="'+escapeHtml(initial)+'" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)"/></div>';
    showModal({title, html, buttons:[{label:'Save',value:'save',className:'btn'},{label:'Cancel',value:'cancel',className:'btn ghost'}]}).then(res=>{ if (res!=='save') return resolve(null); const v = $('prompt-val').value.trim(); if (!v) return resolve(null); resolve(v); });
  });
}
/* ===== option picker modal: returns chosen option string, or null if cancelled ===== */
const toastContainer = $('toast-container');
function showToast(message, type){
  if (!toastContainer) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type==='contact'?' contact-toast':type==='play'?' play-toast':type==='store'?' store-toast':'');
  t.textContent = message;
  toastContainer.appendChild(t);
  setTimeout(()=> { t.remove(); }, 2700);
}
function msToToastTime(ms){
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [String(hours).padStart(2,'0'),String(minutes).padStart(2,'0'),String(seconds).padStart(2,'0')].join(':');
}

/* State */
let state = { sessions: [], currentSessionId: null, currentSide: 'top', compactNames: false, activeTab: 'game', workoutSection: 'defense' };
// Strike-zone / log selection (not persisted): which pitch/play is focused.
let selState = { idx:null, whole:false };
let logSearchTerm = '';
let floatState = { left:null, top:null, size:96 };

/* DOM refs */
const sessionSelect = $('session-select');
const createSessionBtn = $('create-session-btn');
const clearLogBtn = $('clear-log-btn');
const logSearchInput = $('log-search');
const logSearchClear = $('log-search-clear');
const lockFloatsCheckbox = $('lock-floats');
const clockDisplay = $('clock-display');
const startBtn = $('start-btn');
const pauseBtn = $('pause-btn');
const resetBtn = $('reset-btn');
const exportBtn = $('export-btn');
const gameCsvMenu = $('game-csv-menu');
const clockHint = $('clock-hint');

const tabGame = $('tab-game');
const tabWorkout = $('tab-workout');
const gameTab = $('game-tab');
const workoutTab = $('workout-tab');

const wsecDefense = $('wsec-defense');
const wsecBP = $('wsec-bp');
const wsecDash = $('wsec-dash');
const defenseSection = $('defense-section');
const bpSection = $('bp-section');
const dashSection = $('dash-section');
const dashList = $('dash-list');
const dashLogList = $('dash-log-list');

const sideTop = $('side-top');
const sideBot = $('side-bot');
const sideTop2 = $('side-top-2');
const sideBot2 = $('side-bot-2');
const szDesc = $('sz-desc');

const addPitcherInput = $('add-pitcher');
const addPitcherBtn = $('add-pitcher-btn');
const pitchersList = $('pitchers-list');
const addHitterInput = $('add-hitter');
const addHitterBtn = $('add-hitter-btn');
const hittersList = $('hitters-list');

const logList = $('log-list');
const floatBtn = $('float-log-btn');
const floatContactBtn = $('float-contact-btn');
const floatWorkoutBtn = $('float-workout-btn');
const floatStartBtn = $('float-start-btn');

const ofList = $('of-list'), ifList = $('if-list'), cList = $('c-list'), bpList = $('bp-list');
const defenseLogList = $('defense-log-list'), bpLogList = $('bp-log-list');
const angleSide = $('angle-side'), angleBehind = $('angle-behind');
const csvStorageList = $('csv-storage-list');
const downloadAllBtn = $('download-all-btn');
const workoutCsvBtn = $('workout-csv-btn');
const workoutCsvMenu = $('workout-csv-menu');

const DEF_POS = { outfielders:'OF', infielders:'IF', catchers:'C' };
const DEF_LABEL = { outfielders:'Outfielder', infielders:'Infielder', catchers:'Catcher' };
const DEF_CLASS = { outfielders:'of', infielders:'if', catchers:'cat' };
const DEF_ROLE = { outfielders:'OF', infielders:'IF', catchers:'C' };

function saveAll(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem(FLOAT_KEY, JSON.stringify(floatState)); } catch(e){ console.warn('save failed', e); } }
function loadAll(){ try { const r = localStorage.getItem(STORAGE_KEY); if (r) state = Object.assign(state, JSON.parse(r) || {}); const fr = localStorage.getItem(FLOAT_KEY); if (fr) floatState = Object.assign(floatState, JSON.parse(fr) || {}); if (!Array.isArray(state.sessions)) state.sessions = []; if (!state.currentSide) state.currentSide = 'top'; if (!state.activeTab) state.activeTab = 'game'; if (!state.workoutSection) state.workoutSection = 'dash'; } catch(e){ console.warn('load failed', e); } }

/* Sessions / model */
function buildDefaultSession(name, date){
  name = name || 'Event 1'; date = date || new Date().toISOString().slice(0,10);
  return {
    id: uid('sess'), name, date,
    teams: {
      top: { pitchers:['PITCHER_1'], hitters:['BATEADOR_1'], selectedPitcher:'PITCHER_1', selectedHitter:'BATEADOR_1' },
      bot: { pitchers:['PITCHER_1'], hitters:['BATEADOR_1'], selectedPitcher:'PITCHER_1', selectedHitter:'BATEADOR_1' }
    },
    events: [], nextId: 1, nextContactId: 1, nextPlayId: 1,
    clock: { running:false, elapsedBefore:0, startTimestamp:null },
    workout: buildDefaultWorkout(),
    csvStorage: []
  };
}
function buildDefaultWorkout(){
  return {
    dash: { players:['RUNNER_1'], selectedPlayer:'RUNNER_1', events:[], nextId:1 },
    defense: {
      outfielders:['OF_1'], infielders:['IF_1'], catchers:['C_1'],
      selectedGroup:'outfielders', selectedPlayer:'OF_1',
      events:[], nextId:1
    },
    bp: { players:['BP_1'], selectedPlayer:'BP_1', angle:'S', events:[], nextId:1 }
  };
}
function getCurrentSession(){ return state.sessions.find(s => s.id === state.currentSessionId) || null; }
function ensureSessionClock(sess){ if (!sess.clock) sess.clock = { running:false, elapsedBefore:0, startTimestamp:null }; }
function allocEventId(store){ let m=0; (store && store.events ? store.events : []).forEach(e=>{ if (typeof e.id==='number' && e.id>m) m=e.id; }); return m+1; }
function ensureSessionCounters(sess){
  if (typeof sess.nextContactId !== 'number'){ let m=0; sess.events.forEach(e=>{ if (typeof e.contact==='number' && e.contact>m) m=e.contact; }); sess.nextContactId=m+1; }
  if (typeof sess.nextPlayId !== 'number'){ let m=0; sess.events.forEach(e=>{ if (typeof e.play==='number' && e.play>m) m=e.play; }); sess.nextPlayId=m+1; }
}
function ensureWorkout(sess){
  if (!sess.workout) sess.workout = buildDefaultWorkout();
  const w = sess.workout;
  if (!w.dash) w.dash = buildDefaultWorkout().dash;
  if (!w.defense) w.defense = buildDefaultWorkout().defense;
  if (!w.bp) w.bp = buildDefaultWorkout().bp;
  const dh = w.dash;
  if (!Array.isArray(dh.players)) dh.players=[];
  if (typeof dh.selectedPlayer !== 'string') dh.selectedPlayer = dh.players[0] || '';
  if (!Array.isArray(dh.events)) dh.events = [];
  if (typeof dh.nextId !== 'number'){ let m=0; dh.events.forEach(e=>{ if (e.id>m) m=e.id; }); dh.nextId=m+1; }
  const d = w.defense;
  ['outfielders','infielders','catchers'].forEach(g=>{ if (!Array.isArray(d[g])) d[g]=[]; });
  if (!d.selectedGroup) d.selectedGroup = 'outfielders';
  if (typeof d.selectedPlayer !== 'string') d.selectedPlayer = d[d.selectedGroup][0] || '';
  if (!Array.isArray(d.events)) d.events = [];
  if (typeof d.nextId !== 'number'){ let m=0; d.events.forEach(e=>{ if (e.id>m) m=e.id; }); d.nextId=m+1; }
  const b = w.bp;
  if (!Array.isArray(b.players)) b.players=[];
  if (typeof b.selectedPlayer !== 'string') b.selectedPlayer = b.players[0] || '';
  if (!b.angle) b.angle = 'S';
  if (!Array.isArray(b.events)) b.events = [];
  if (typeof b.nextId !== 'number'){ let m=0; b.events.forEach(e=>{ if (e.id>m) m=e.id; }); b.nextId=m+1; }
  if (!Array.isArray(sess.csvStorage)) sess.csvStorage = [];
}

/* Clock helpers */
function computeSessionElapsedMs(sess){ ensureSessionClock(sess); if (sess.clock.running && sess.clock.startTimestamp) return Math.round(sess.clock.elapsedBefore + (Date.now() - sess.clock.startTimestamp)); return Math.round(sess.clock.elapsedBefore); }
function msToLabel(ms){ const total = Math.floor(ms); const minutes = Math.floor(total/60000); const seconds = Math.floor((total%60000)/1000); const millis = total%1000; return String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0')+'.'+String(millis).padStart(3,'0'); }
function updateClockDisplay(){ const sess = getCurrentSession(); clockDisplay.textContent = sess ? msToLabel(computeSessionElapsedMs(sess)) : '00:00.000'; }
function renderClockButtons(){ const sess = getCurrentSession(); if (!sess){ startBtn.disabled=true; pauseBtn.disabled=true; return; } ensureSessionClock(sess); startBtn.disabled = !!sess.clock.running; pauseBtn.disabled = !sess.clock.running; }

function renderSessionSelect(){ sessionSelect.innerHTML=''; state.sessions.forEach(s=>{ const opt = document.createElement('option'); opt.value=s.id; opt.textContent = s.name + ' - ' + (s.date||''); sessionSelect.appendChild(opt); }); if (state.currentSessionId) sessionSelect.value = state.currentSessionId; }

/* ===== GAME: pitcher count ===== */
function countPitcherEvents(sess, pitcherName){ if (!sess || !sess.events) return 0; return sess.events.filter(e => e.pitcher === pitcherName).length; }
// Total balls/strikes thrown by a pitcher. InPlay stores ball_strike='Strike',
// so it counts as a strike here (per spec) even though it does not ramp the
// displayed strike count in the zone.
function countPitcherBS(sess, pitcherName){ let b=0,s=0; if (sess && sess.events){ sess.events.forEach(e=>{ if (e.pitcher===pitcherName){ if (e.ball_strike==='Ball') b++; else if (e.ball_strike==='Strike') s++; } }); } return {b,s}; }
function updatePitcherCountBadges(){
  const sess = getCurrentSession(); if (!sess) return;
  const team = sess.teams[state.currentSide];
  team.pitchers.forEach((p, idx) => {
    const badge = pitchersList.querySelector('.player-row:nth-child('+(idx+1)+') .pitcher-count');
    if (badge){ const newText = '('+countPitcherEvents(sess,p)+')'; if (badge.textContent !== newText){ badge.textContent=newText; badge.classList.remove('badge-pop'); void badge.offsetWidth; badge.classList.add('badge-pop'); } }
    const bsb = pitchersList.querySelector('.player-row:nth-child('+(idx+1)+') .pitcher-bs');
    if (bsb){ const bs=countPitcherBS(sess,p); const t='(B: '+bs.b+', S: '+bs.s+')'; if (bsb.textContent !== t){ bsb.textContent=t; bsb.classList.remove('badge-pop'); void bsb.offsetWidth; bsb.classList.add('badge-pop'); } }
  });
}

/* Generic icon button helpers reused by rows */
function mkIconBtn(label, disabled){ const b=document.createElement('button'); b.className='icon-btn'; b.textContent=label; if (disabled) b.disabled=true; return b; }

/* ===== GAME player lists ===== */
function renderPlayerLists(){
  const sess = getCurrentSession();
  pitchersList.innerHTML=''; hittersList.innerHTML='';
  if (!sess) return;
  const team = sess.teams[state.currentSide];

  team.pitchers.forEach((p, idx)=>{
    const row = document.createElement('div'); row.className = 'player-row pitcher' + (team.selectedPitcher===p?' selected':'');
    const left = document.createElement('div'); left.className='player-left';
    const role = document.createElement('div'); role.className='player-role'; role.textContent='P';
    const name = document.createElement('div'); name.className='player-name'; name.textContent = (state.compactNames?compactName(p):p);
    name.addEventListener('click', ()=>{ team.selectedPitcher = p; saveAll(); renderPlayerLists(); });
    const badge = document.createElement('span'); badge.className='pitcher-count'; badge.textContent='('+countPitcherEvents(sess,p)+')';
    const bsNow = countPitcherBS(sess,p);
    const bsBadge = document.createElement('span'); bsBadge.className='pitcher-bs'; bsBadge.textContent='(B: '+bsNow.b+', S: '+bsNow.s+')';
    left.appendChild(role); left.appendChild(name); left.appendChild(badge); left.appendChild(bsBadge);

    const btns = document.createElement('div'); btns.className='player-buttons';
    const up = mkIconBtn('\u2191', idx===0);
    up.addEventListener('click', ()=>{ if (idx===0) return; team.pitchers.splice(idx-1,0,team.pitchers.splice(idx,1)[0]); saveAll(); renderPlayerLists(); });
    const down = mkIconBtn('\u2193', idx===team.pitchers.length-1);
    down.addEventListener('click', ()=>{ if (idx===team.pitchers.length-1) return; team.pitchers.splice(idx+1,0,team.pitchers.splice(idx,1)[0]); saveAll(); renderPlayerLists(); });
    const edit = mkIconBtn('\u270E');
    edit.addEventListener('click', async ()=>{ const nv = await promptModal('Edit pitcher', p); if (!nv) return; const title=titleCaseName(nv); const old=team.pitchers[idx]; team.pitchers[idx]=title; if (team.selectedPitcher===old) team.selectedPitcher=title; sess.events.forEach(e=>{ if (e.pitcher===old) e.pitcher=title; }); saveAll(); renderPlayerLists(); });
    const del = mkIconBtn('\u2715');
    del.addEventListener('click', async ()=>{ const ok = await showModal({title:'Remove pitcher?', message:'Remove '+p+'?', buttons:[{label:'Remove',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!ok) return; team.pitchers.splice(idx,1); if (team.selectedPitcher===p) team.selectedPitcher=team.pitchers[0]||''; saveAll(); renderPlayerLists(); });
    btns.appendChild(up); btns.appendChild(down); btns.appendChild(edit); btns.appendChild(del);
    row.appendChild(left); row.appendChild(btns); pitchersList.appendChild(row);
  });

  team.hitters.forEach((h, idx)=>{
    const row = document.createElement('div'); row.className = 'player-row hitter' + (team.selectedHitter===h?' selected':'');
    const left = document.createElement('div'); left.className='player-left';
    const role = document.createElement('div'); role.className='player-role'; role.textContent='B';
    const name = document.createElement('div'); name.className='player-name'; name.textContent = (state.compactNames?compactName(h):h);
    name.addEventListener('click', ()=>{ team.selectedHitter = h; saveAll(); renderPlayerLists(); });
    left.appendChild(role); left.appendChild(name);
    const btns = document.createElement('div'); btns.className='player-buttons';
    const up = mkIconBtn('\u2191', idx===0);
    up.addEventListener('click', ()=>{ if (idx===0) return; team.hitters.splice(idx-1,0,team.hitters.splice(idx,1)[0]); saveAll(); renderPlayerLists(); });
    const down = mkIconBtn('\u2193', idx===team.hitters.length-1);
    down.addEventListener('click', ()=>{ if (idx===team.hitters.length-1) return; team.hitters.splice(idx+1,0,team.hitters.splice(idx,1)[0]); saveAll(); renderPlayerLists(); });
    const edit = mkIconBtn('\u270E');
    edit.addEventListener('click', async ()=>{ const nv = await promptModal('Edit hitter', h); if (!nv) return; const title=titleCaseName(nv); const old=team.hitters[idx]; team.hitters[idx]=title; if (team.selectedHitter===old) team.selectedHitter=title; sess.events.forEach(e=>{ if (e.player===old) e.player=title; }); saveAll(); renderPlayerLists(); });
    const del = mkIconBtn('\u2715');
    del.addEventListener('click', async ()=>{ const ok = await showModal({title:'Remove hitter?', message:'Remove '+h+'?', buttons:[{label:'Remove',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!ok) return; team.hitters.splice(idx,1); if (team.selectedHitter===h) team.selectedHitter=team.hitters[0]||''; saveAll(); renderPlayerLists(); });
    btns.appendChild(up); btns.appendChild(down); btns.appendChild(edit); btns.appendChild(del);
    row.appendChild(left); row.appendChild(btns); hittersList.appendChild(row);
  });
  renderActiveSelects();
}

/* ===== GAME log ===== */
function renderLog(){
  const sess = getCurrentSession();
  logList.innerHTML = '';
  if (!sess) return;
  ensureSessionCounters(sess);
  // Keep the selection valid if events changed underneath it.
  if (selState.idx!=null && !sess.events[selState.idx]){ selState.idx=null; selState.whole=false; }
  const groups = groupsOf(sess);
  // The single live at-bat is the trailing non-terminal group; any OTHER
  // non-terminal group (e.g. a branched/edited pitch awaiting a result) is an
  // unfinished at-bat, not the current one.
  const liveGroup = (groups.length && !groups[groups.length-1].terminal) ? groups[groups.length-1] : null;
  // Pre-number terminal plays in chronological order so numbering is stable even when filtered.
  let n=0; groups.forEach(g=>{ g._playNo = g.terminal ? (++n) : null; });
  // Optional search: keep groups where any pitch matches pitcher/hitter name or ID.
  const q = (logSearchTerm||'').trim().toLowerCase();
  let visGroups = groups;
  if (q){
    visGroups = groups.filter(g=> g.pitches.some(p=>{
      const e=p.ev;
      const pid=String(e.pitcher_id||playerIdFor(sess,e.pitcher)||'').toLowerCase();
      const hid=String(e.player_id||playerIdFor(sess,e.player)||'').toLowerCase();
      return (e.pitcher||'').toLowerCase().includes(q) || (e.player||'').toLowerCase().includes(q) || (pid&&pid.includes(q)) || (hid&&hid.includes(q));
    }));
  }
  if (q && !visGroups.length){ const empty=document.createElement('div'); empty.className='muted-note'; empty.style.padding='10px 4px'; empty.textContent='No players match “'+logSearchTerm.trim()+'”.'; logList.appendChild(empty); return; }
  // Newest group on top.
  visGroups.slice().reverse().forEach((g)=>{
    const term = g.terminal ? g.pitches[g.pitches.length-1].ev : null;
    const matchup = (()=>{ const any=g.pitches[g.pitches.length-1].ev; return (any.pitcher||'')+' vs '+(any.player||''); })();
    const groupSel = (selState.whole && g.pitches.some(p=>p.idx===selState.idx));
    const card = document.createElement('div');
    card.className = 'play-card'+(g.terminal?'':' live')+(groupSel?' sel':'');
    const head = document.createElement('div'); head.className='play-head'+(groupSel?' sel':'');
    const title = document.createElement('div'); title.className='play-title';
    if (g.terminal){ title.textContent = 'Play '+g._playNo+' \u00b7 '+(evPlayLabel(term)||''); }
    else { title.textContent = (g===liveGroup) ? 'Current At-Bat' : 'At-Bat is ongoing (Unfinished)'; }
    const bs = groupBS(g.pitches);
    const pcount = g.pitches.length+(g.pitches.length===1?' pitch':' pitches');
    const sub = document.createElement('div'); sub.className='play-sub'; sub.textContent = matchup+'  \u00b7  '+pcount+'  \u00b7  Balls: '+bs.balls+'  \u00b7  Strikes: '+bs.strikes;
    const textCol = document.createElement('div'); textCol.className='play-head-text';
    textCol.appendChild(title); textCol.appendChild(sub);
    head.appendChild(textCol);
    const headOpts = document.createElement('button'); headOpts.className='btn small play-opts'; headOpts.textContent='Options';
    headOpts.addEventListener('click', (e)=>{ e.stopPropagation(); openPlayOptionsModal(g); });
    head.appendChild(headOpts);
    head.addEventListener('click', ()=> selectPlay(g));
    card.appendChild(head);
    const wrap = document.createElement('div'); wrap.className='play-pitches';
    g.pitches.slice().reverse().forEach(p=> wrap.appendChild(buildPitchItem(sess, p.ev, p.idx)));
    card.appendChild(wrap);
    logList.appendChild(card);
  });
}
function buildPitchItem(sess, ev, idx){
  const item = document.createElement('div');
  item.className = 'log-item pitch-item'+((selState.idx===idx && !selState.whole)?' sel':'');
  const left = document.createElement('div'); left.className='log-left';
  const main = document.createElement('div'); main.textContent = '#'+ev.id+' \u2014 '+msToLabel(ev.timecode_ms); main.style.fontWeight='700';
  const meta = document.createElement('div'); meta.className='log-meta'; meta.textContent = evDescription(ev);
  left.appendChild(main); left.appendChild(meta);
  const actions = document.createElement('div');
  const opts = document.createElement('button'); opts.className='btn small'; opts.textContent='Options';
  opts.addEventListener('click', (e)=>{ e.stopPropagation(); openOptionsModal(idx); });
  actions.appendChild(opts);
  item.appendChild(left); item.appendChild(actions);
  item.addEventListener('click', ()=> selectPitch(idx));
  return item;
}

/* ===== GAME options modal ===== */
async function openOptionsModal(index){
  const sess = getCurrentSession(); if (!sess) return;
  const ev = sess.events[index];
  const allHitters = Array.from(new Set(sess.teams.top.hitters.concat(sess.teams.bot.hitters)));
  const allPitchers = Array.from(new Set(sess.teams.top.pitchers.concat(sess.teams.bot.pitchers)));
  const summary = [
    (ev.pitch_group?('Pitch: '+ev.pitch_group+(ev.velo?(' '+ev.velo+' mph'):'')):'Pitch: --'),
    'Strike/Ball: '+(ev.ball_strike||'--'),
    'Swing: '+(ev.swing||'--'),
    'Play: '+(evPlayLabel(ev)||'--'),
    'Contact Quality: '+(ev.contact_quality||'--'),
    'Batted Ball: '+(ev.batted_ball||'--')
  ].join('  \u00b7  ');
  const html = '<div style="display:flex;flex-direction:column;gap:8px">'
    + '<div class="muted-note" style="font-size:12px;line-height:1.5">'+escapeHtml(summary)+'</div>'
    + '<label style="font-size:13px;color:var(--muted)">Hitter</label>'
    + '<select id="modal-hitter" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)">'
    + allHitters.map(h=>'<option value="'+escapeHtml(h)+'"'+(ev.player===h?' selected':'')+'>'+escapeHtml(h)+'</option>').join('')
    + '</select>'
    + '<label style="font-size:13px;color:var(--muted)">Pitcher</label>'
    + '<select id="modal-pitcher" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)">'
    + allPitchers.map(p=>'<option value="'+escapeHtml(p)+'"'+(ev.pitcher===p?' selected':'')+'>'+escapeHtml(p)+'</option>').join('')
    + '</select>'
    + '<div style="display:flex;gap:10px;align-items:center;margin-top:6px">'
    + '<label><input type="checkbox" id="modal-late"'+((ev.notes&&ev.notes.late)?' checked':'')+' /> Late Input</label>'
    + '<label><input type="checkbox" id="modal-early"'+((ev.notes&&ev.notes.early)?' checked':'')+' /> Early Input</label>'
    + '</div></div>';
  const res = await showModal({ title:'Options', html, buttons:[{label:'Save',value:'save',className:'btn'},{label:'Edit Play',value:'editplay',className:'btn'},{label:'Delete',value:'delete',className:'btn warn'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  if (res==='cancel' || !res) return;
  if (res==='editplay'){ const hh=$('modal-hitter').value, pp=$('modal-pitcher').value, late=$('modal-late').checked, early=$('modal-early').checked; if(hh){ ev.player=hh; ev.player_id=playerIdFor(sess,hh); } if(pp){ ev.pitcher=pp; ev.pitcher_id=playerIdFor(sess,pp); } await classifyPitch(ev, ev.inzone); ev.contact = evContact(ev)?(ev.contact||1):''; ev.play = evPlayLabel(ev); ev.notes={late,early}; ev.bad_data = late?'YES_LATE':(early?'YES_EARLY':'YES_FIX'); saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); return; }
  if (res==='delete'){ const c = await showModal({ title:'Delete entry?', message:'Delete this log entry?', buttons:[{label:'Delete',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!c) return; sess.events.splice(index,1); selState.idx=null; selState.whole=false; saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); return; }
  if (res==='save'){ const hh=$('modal-hitter').value, pp=$('modal-pitcher').value, late=$('modal-late').checked, early=$('modal-early').checked; if(hh){ ev.player=hh; ev.player_id=playerIdFor(sess,hh); } if(pp){ ev.pitcher=pp; ev.pitcher_id=playerIdFor(sess,pp); } ev.notes={late,early}; ev.bad_data = late?'YES_LATE':(early?'YES_EARLY':'YES_FIX'); saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); return; }
}

/* ===== PLAY-level options modal (edits last play + applies matchup to all pitches in the card) ===== */
async function openPlayOptionsModal(g){
  const sess = getCurrentSession(); if (!sess || !g || !g.pitches.length) return;
  const last = g.pitches[g.pitches.length-1];
  const term = last.ev; const termIdx = last.idx;
  const allHitters = Array.from(new Set(sess.teams.top.hitters.concat(sess.teams.bot.hitters)));
  const allPitchers = Array.from(new Set(sess.teams.top.pitchers.concat(sess.teams.bot.pitchers)));
  const summary = [
    'Play: '+(evPlayLabel(term)||'--'),
    g.pitches.length+(g.pitches.length===1?' pitch':' pitches'),
    'Matchup applies to the whole card'
  ].join('  \u00b7  ');
  const html = '<div style="display:flex;flex-direction:column;gap:8px">'
    + '<div class="muted-note" style="font-size:12px;line-height:1.5">'+escapeHtml(summary)+'</div>'
    + '<label style="font-size:13px;color:var(--muted)">Hitter (applied to all pitches in this play)</label>'
    + '<select id="pmodal-hitter" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)">'
    + allHitters.map(h=>'<option value="'+escapeHtml(h)+'"'+(term.player===h?' selected':'')+'>'+escapeHtml(h)+'</option>').join('')
    + '</select>'
    + '<label style="font-size:13px;color:var(--muted)">Pitcher (applied to all pitches in this play)</label>'
    + '<select id="pmodal-pitcher" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)">'
    + allPitchers.map(p=>'<option value="'+escapeHtml(p)+'"'+(term.pitcher===p?' selected':'')+'>'+escapeHtml(p)+'</option>').join('')
    + '</select>'
    + '<div style="display:flex;gap:10px;align-items:center;margin-top:6px">'
    + '<label><input type="checkbox" id="pmodal-late"'+((term.notes&&term.notes.late)?' checked':'')+' /> Late Input</label>'
    + '<label><input type="checkbox" id="pmodal-early"'+((term.notes&&term.notes.early)?' checked':'')+' /> Early Input</label>'
    + '</div></div>';
  const res = await showModal({ title:'Play Options', html, buttons:[{label:'Save',value:'save',className:'btn'},{label:'Edit Play',value:'editplay',className:'btn'},{label:'Delete Play',value:'delete',className:'btn warn'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  if (res==='cancel' || !res) return;
  if (res==='delete'){
    const c = await showModal({ title:'Delete play?', message:'Delete all '+g.pitches.length+' pitch(es) in this play?', buttons:[{label:'Delete',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]});
    if (!c) return;
    const idxs = g.pitches.map(p=>p.idx).sort((a,b)=>b-a);
    idxs.forEach(i=> sess.events.splice(i,1));
    selState.idx=null; selState.whole=false;
    saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); return;
  }
  const hh=$('pmodal-hitter').value, pp=$('pmodal-pitcher').value, late=$('pmodal-late').checked, early=$('pmodal-early').checked;
  function applyMatchup(){ g.pitches.forEach(p=>{ if(hh){ p.ev.player=hh; p.ev.player_id=playerIdFor(sess,hh); } if(pp){ p.ev.pitcher=pp; p.ev.pitcher_id=playerIdFor(sess,pp); } }); }
  if (res==='editplay'){
    applyMatchup();
    await classifyPitch(term, term.inzone);
    term.contact = evContact(term)?(term.contact||1):'';
    term.play = evPlayLabel(term);
    term.notes={late,early};
    term.bad_data = late?'YES_LATE':(early?'YES_EARLY':'YES_FIX');
    applyMatchup();
    saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); return;
  }
  if (res==='save'){
    applyMatchup();
    term.notes={late,early};
    term.bad_data = late?'YES_LATE':(early?'YES_EARLY':'YES_FIX');
    saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); return;
  }
}

/* ===== Edit Players (Profile Manager-style) — writes to Firebase + updates lineup ===== */
async function writePlayerDoc(id, data){
  if(!_db) return false;
  try{ await _db.collection(COLLECTION).doc(String(id)).set(data, {merge:true}); return true; }
  catch(e){ console.error('player write failed', e); return false; }
}
// Returns true if a Players doc with this ID already exists in the database.
async function playerExistsInDb(id){
  if(!_db || id==='' || id==null) return false;
  // Prefer the live cache (snapshot listener) when it has loaded.
  if(Array.isArray(_playerCache) && _playerCache.length && _playerCache.some(pl=> String(pl.id)===String(id))) return true;
  try{ const doc=await _db.collection(COLLECTION).doc(String(id)).get(); return !!(doc && doc.exists); }
  catch(e){ return false; }
}
async function editPlayersModal(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'Edit Players', message:'Start or select a session first.'}); return; }
  const hitters=Array.from(new Set(sess.teams.top.hitters.concat(sess.teams.bot.hitters)));
  const pitchers=Array.from(new Set(sess.teams.top.pitchers.concat(sess.teams.bot.pitchers)));
  const lineup=Array.from(new Set(pitchers.concat(hitters)));
  const POSITIONS=['','P','C','1B','2B','3B','SS','LF','CF','RF','OF','IF','DH','UTIL'];
  const CLASSES=['','Fr','So','Jr','Sr','GR'];
  const BATS=['','R','L','S'];
  const THROWS=['','R','L'];
  const sel=(arr,cur)=>arr.map(o=>'<option value="'+escapeHtml(o)+'"'+(o===cur?' selected':'')+'>'+(o===''?'--':escapeHtml(o))+'</option>').join('');
  const dbNote = _db? '' : '<div class="muted-note" style="color:var(--pitch-red)">Database offline — the lineup will update, but no profile is written.</div>';
  const html='<div style="display:flex;flex-direction:column;gap:8px">'
    + dbNote
    + '<label style="font-size:13px;color:var(--muted)">Player</label>'
    + '<select id="ep-player" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)">'
    + '<option value="__new__">+ New Player</option>'
    + lineup.map(n=>'<option value="'+escapeHtml(n)+'">'+escapeHtml(n)+'</option>').join('')
    + '</select>'
    + '<div class="ep-grid">'
    + '<label>Player Name<input id="ep-name" type="text" /></label>'
    + '<label>Player ID<input id="ep-id" type="text" /></label>'
    + '<label>Position<select id="ep-pos">'+sel(POSITIONS,'')+'</select></label>'
    + '<label>Class<select id="ep-class">'+sel(CLASSES,'')+'</select></label>'
    + '<label>Bats<select id="ep-bats">'+sel(BATS,'')+'</select></label>'
    + '<label>Throws<select id="ep-throws">'+sel(THROWS,'')+'</select></label>'
    + '<label>Date of Birth<input id="ep-dob" type="date" /></label>'
    + '</div>'
    + '<div id="ep-status" class="muted-note" style="font-size:12px"></div>'
    + '</div>';
  const p=showModal({ title:'Edit Players', html, buttons:[{label:'Save',value:'save',className:'btn'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  const playerSel=$('ep-player');
  async function fillForm(name){
    const nameEl=$('ep-name'), idEl=$('ep-id'), posEl=$('ep-pos'), clsEl=$('ep-class'), batEl=$('ep-bats'), thrEl=$('ep-throws'), dobEl=$('ep-dob'), st=$('ep-status');
    if(name==='__new__'){ nameEl.value=''; idEl.value=''; posEl.value=''; clsEl.value=''; batEl.value=''; thrEl.value=''; dobEl.value=''; st.textContent='Enter a new player profile.'; return; }
    nameEl.value=name;
    let id=playerIdFor(sess,name);
    if(!id){ const m=_playerCache.find(pl=>pl.name && pl.name.toLowerCase()===name.toLowerCase()); if(m) id=m.id; }
    idEl.value=id||''; posEl.value=''; clsEl.value=''; batEl.value=''; thrEl.value=''; dobEl.value='';
    if(id && _db){ st.textContent='Loading profile\u2026';
      try{ const doc=await _db.collection(COLLECTION).doc(String(id)).get();
        if(doc && doc.exists){ const d=doc.data()||{};
          posEl.value=d.position||d.pos||''; clsEl.value=d.class||d.year||d.grade||'';
          batEl.value=(d.bats||d.bat||'').toString().charAt(0).toUpperCase(); thrEl.value=(d.throws||d.throw||'').toString().charAt(0).toUpperCase();
          dobEl.value=d.dob||d.birthdate||d.birth_date||''; st.textContent='Loaded from database.';
        } else { st.textContent='No database profile yet \u2014 fill and save to create.'; }
      }catch(e){ st.textContent='Could not load profile (offline?).'; }
    } else { st.textContent = _db? 'No ID yet \u2014 add one and save to create a profile.' : 'Database offline \u2014 lineup update only.'; }
  }
  playerSel.addEventListener('change', ()=>fillForm(playerSel.value));
  fillForm(lineup.length?lineup[0]:'__new__');
  if(lineup.length) playerSel.value=lineup[0];
  const res=await p;
  if(res!=='save') return;
  const oldKey=playerSel.value;
  const newName=$('ep-name').value.trim();
  const id=$('ep-id').value.trim();
  if(!newName){ await showModal({title:'Edit Players', message:'Please enter a player name.'}); return; }
  const data={ player_name:newName, position:$('ep-pos').value, class:$('ep-class').value, bats:$('ep-bats').value, throws:$('ep-throws').value, dob:$('ep-dob').value };
  if(id) data.player_id=id;
  let wrote=false;
  let alreadyInDb=false;
  if(id && _db){
    // If this ID already exists in the database, leave that player's
    // profile completely untouched — only link the ID to the lineup.
    alreadyInDb=await playerExistsInDb(id);
    if(!alreadyInDb){ wrote=await writePlayerDoc(id, data); }
  }
  // lineup updates
  if(oldKey==='__new__'){
    const side=state.currentSide; const isP=($('ep-pos').value==='P');
    const list=isP?sess.teams[side].pitchers:sess.teams[side].hitters;
    if(!list.includes(newName)) list.push(newName);
  } else if(oldKey!==newName){
    ['top','bot'].forEach(sd=>{ const t=sess.teams[sd];
      const ih=t.hitters.indexOf(oldKey); if(ih>=0) t.hitters[ih]=newName;
      const ip=t.pitchers.indexOf(oldKey); if(ip>=0) t.pitchers[ip]=newName;
      if(t.selectedPitcher===oldKey) t.selectedPitcher=newName;
      if(t.selectedHitter===oldKey) t.selectedHitter=newName;
    });
    sess.events.forEach(e=>{ if(e.player===oldKey) e.player=newName; if(e.pitcher===oldKey) e.pitcher=newName; });
    ensurePlayerIds(sess); if(sess.playerIds[oldKey]!=null) delete sess.playerIds[oldKey];
  }
  if(id) assignPlayerId(newName, id);
  saveAll(); renderAll();
  let msg;
  if(!id){ msg='Lineup updated. Add a Player ID to save a database profile.'; }
  else if(alreadyInDb){ msg='Player ID '+id+' already exists in the database — that profile was kept untouched and only linked to the lineup.'; }
  else if(wrote){ msg='Saved to database and added to the lineup (ID '+id+').'; }
  else { msg=_db?'Lineup updated, but the database write failed (try again).':'Lineup updated with ID '+id+' (database offline).'; }
  await showModal({ title:'Edit Players', message:msg });
}

/* ===== WORKOUT: Defense rendering ===== */
function renderDefenseLists(){
  const sess = getCurrentSession(); if (!sess) return;
  ensureWorkout(sess);
  const d = sess.workout.defense;
  const map = { outfielders: ofList, infielders: ifList, catchers: cList };
  Object.keys(map).forEach(group=>{
    const listEl = map[group]; listEl.innerHTML='';
    d[group].forEach((pname, idx)=>{
      const isSel = (d.selectedGroup===group && d.selectedPlayer===pname);
      const row = document.createElement('div'); row.className='player-row '+DEF_CLASS[group]+(isSel?' selected':'');
      const left = document.createElement('div'); left.className='player-left';
      const role = document.createElement('div'); role.className='player-role'; role.textContent=DEF_ROLE[group];
      const name = document.createElement('div'); name.className='player-name'; name.textContent=(state.compactNames?compactName(pname):pname);
      name.addEventListener('click', ()=>{ d.selectedGroup=group; d.selectedPlayer=pname; saveAll(); renderDefenseLists(); });
      left.appendChild(role); left.appendChild(name);
      const btns = document.createElement('div'); btns.className='player-buttons';
      const up = mkIconBtn('\u2191', idx===0);
      up.addEventListener('click', ()=>{ if (idx===0) return; d[group].splice(idx-1,0,d[group].splice(idx,1)[0]); saveAll(); renderDefenseLists(); });
      const down = mkIconBtn('\u2193', idx===d[group].length-1);
      down.addEventListener('click', ()=>{ if (idx===d[group].length-1) return; d[group].splice(idx+1,0,d[group].splice(idx,1)[0]); saveAll(); renderDefenseLists(); });
      const edit = mkIconBtn('\u270E');
      edit.addEventListener('click', async ()=>{ const nv = await promptModal('Edit '+DEF_LABEL[group], pname); if (!nv) return; const title=titleCaseName(nv); const old=d[group][idx]; d[group][idx]=title; if (d.selectedPlayer===old) d.selectedPlayer=title; d.events.forEach(e=>{ if (e.player===old && e.position===DEF_POS[group]) e.player=title; }); saveAll(); renderDefenseLists(); renderDefenseLog(); });
      const del = mkIconBtn('\u2715');
      del.addEventListener('click', async ()=>{ const ok = await showModal({title:'Remove player?', message:'Remove '+pname+'?', buttons:[{label:'Remove',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!ok) return; d[group].splice(idx,1); if (d.selectedGroup===group && d.selectedPlayer===pname) d.selectedPlayer=d[group][0]||''; saveAll(); renderDefenseLists(); });
      btns.appendChild(up); btns.appendChild(down); btns.appendChild(edit); btns.appendChild(del);
      row.appendChild(left); row.appendChild(btns); listEl.appendChild(row);
    });
  });
}

/* ===== WORKOUT: BP rendering ===== */
function renderBPList(){
  const sess = getCurrentSession(); if (!sess) return;
  ensureWorkout(sess);
  const b = sess.workout.bp;
  bpList.innerHTML='';
  b.players.forEach((pname, idx)=>{
    const row = document.createElement('div'); row.className='player-row bp'+(b.selectedPlayer===pname?' selected':'');
    const left = document.createElement('div'); left.className='player-left';
    const role = document.createElement('div'); role.className='player-role'; role.textContent='BP';
    const name = document.createElement('div'); name.className='player-name'; name.textContent=(state.compactNames?compactName(pname):pname);
    name.addEventListener('click', ()=>{ b.selectedPlayer=pname; saveAll(); renderBPList(); });
    left.appendChild(role); left.appendChild(name);
    const btns = document.createElement('div'); btns.className='player-buttons';
    const up = mkIconBtn('\u2191', idx===0);
    up.addEventListener('click', ()=>{ if (idx===0) return; b.players.splice(idx-1,0,b.players.splice(idx,1)[0]); saveAll(); renderBPList(); });
    const down = mkIconBtn('\u2193', idx===b.players.length-1);
    down.addEventListener('click', ()=>{ if (idx===b.players.length-1) return; b.players.splice(idx+1,0,b.players.splice(idx,1)[0]); saveAll(); renderBPList(); });
    const edit = mkIconBtn('\u270E');
    edit.addEventListener('click', async ()=>{ const nv = await promptModal('Edit player', pname); if (!nv) return; const title=titleCaseName(nv); const old=b.players[idx]; b.players[idx]=title; if (b.selectedPlayer===old) b.selectedPlayer=title; b.events.forEach(e=>{ if (e.player===old) e.player=title; }); saveAll(); renderBPList(); renderBPLog(); });
    const del = mkIconBtn('\u2715');
    del.addEventListener('click', async ()=>{ const ok = await showModal({title:'Remove player?', message:'Remove '+pname+'?', buttons:[{label:'Remove',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!ok) return; b.players.splice(idx,1); if (b.selectedPlayer===pname) b.selectedPlayer=b.players[0]||''; saveAll(); renderBPList(); });
    btns.appendChild(up); btns.appendChild(down); btns.appendChild(edit); btns.appendChild(del);
    row.appendChild(left); row.appendChild(btns); bpList.appendChild(row);
  });
}

/* ===== WORKOUT logs ===== */
function renderDefenseLog(){
  const sess = getCurrentSession(); if (!sess) return; ensureWorkout(sess);
  const d = sess.workout.defense; defenseLogList.innerHTML='';
  d.events.slice().reverse().forEach((ev)=>{
    const idx = d.events.indexOf(ev);
    const item = document.createElement('div'); item.className='log-item';
    const left = document.createElement('div'); left.className='log-left';
    const main = document.createElement('div'); main.style.fontWeight='700'; main.textContent='#'+ev.id+' \u2014 '+msToLabel(ev.timecode_ms);
    const meta = document.createElement('div'); meta.className='log-meta'; meta.textContent=(ev.player||'')+'  \u00b7  '+(ev.position||'')+'  \u00b7  '+(ev.bad_data||'NO');
    left.appendChild(main); left.appendChild(meta);
    const actions = document.createElement('div');
    const opts = document.createElement('button'); opts.className='btn small'; opts.textContent='Options';
    opts.addEventListener('click', ()=> openWorkoutOptions('defense', idx));
    actions.appendChild(opts);
    item.appendChild(left); item.appendChild(actions); defenseLogList.appendChild(item);
  });
}
function renderBPLog(){
  const sess = getCurrentSession(); if (!sess) return; ensureWorkout(sess);
  const b = sess.workout.bp; bpLogList.innerHTML='';
  b.events.slice().reverse().forEach((ev)=>{
    const idx = b.events.indexOf(ev);
    const item = document.createElement('div'); item.className='log-item';
    const left = document.createElement('div'); left.className='log-left';
    const main = document.createElement('div'); main.style.fontWeight='700'; main.textContent='#'+ev.id+' \u2014 '+msToLabel(ev.timecode_ms);
    const meta = document.createElement('div'); meta.className='log-meta'; meta.textContent=(ev.player||'')+'  \u00b7  '+(ev.angle||'')+'  \u00b7  '+(ev.bad_data||'NO');
    left.appendChild(main); left.appendChild(meta);
    const actions = document.createElement('div');
    const opts = document.createElement('button'); opts.className='btn small'; opts.textContent='Options';
    opts.addEventListener('click', ()=> openWorkoutOptions('bp', idx));
    actions.appendChild(opts);
    item.appendChild(left); item.appendChild(actions); bpLogList.appendChild(item);
  });
}

/* ===== DASH: render + log + CSV + add ===== */
function renderDashList(){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const dh=sess.workout.dash; dashList.innerHTML='';
  dh.players.forEach((pname, idx)=>{
    const row=document.createElement('div'); row.className='player-row dash'+(dh.selectedPlayer===pname?' selected':'');
    const left=document.createElement('div'); left.className='player-left';
    const role=document.createElement('div'); role.className='player-role'; role.textContent='60YD';
    const name=document.createElement('div'); name.className='player-name'; name.textContent=(state.compactNames?compactName(pname):pname);
    name.addEventListener('click', ()=>{ dh.selectedPlayer=pname; saveAll(); renderDashList(); });
    left.appendChild(role); left.appendChild(name);
    const btns=document.createElement('div'); btns.className='player-buttons';
    const up=mkIconBtn('\u2191',idx===0); up.addEventListener('click', ()=>{ if(idx===0) return; dh.players.splice(idx-1,0,dh.players.splice(idx,1)[0]); saveAll(); renderDashList(); });
    const down=mkIconBtn('\u2193',idx===dh.players.length-1); down.addEventListener('click', ()=>{ if(idx===dh.players.length-1) return; dh.players.splice(idx+1,0,dh.players.splice(idx,1)[0]); saveAll(); renderDashList(); });
    const edit=mkIconBtn('\u270E'); edit.addEventListener('click', async ()=>{ const nv=await promptModal('Edit runner',pname); if(!nv) return; const title=titleCaseName(nv); const old=dh.players[idx]; dh.players[idx]=title; if(dh.selectedPlayer===old) dh.selectedPlayer=title; dh.events.forEach(e=>{ if(e.player===old) e.player=title; }); saveAll(); renderDashList(); renderDashLog(); });
    const del=mkIconBtn('\u2715'); del.addEventListener('click', async ()=>{ const ok=await showModal({title:'Remove runner?',message:'Remove '+pname+'?',buttons:[{label:'Remove',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if(!ok) return; dh.players.splice(idx,1); if(dh.selectedPlayer===pname) dh.selectedPlayer=dh.players[0]||''; saveAll(); renderDashList(); });
    btns.appendChild(up); btns.appendChild(down); btns.appendChild(edit); btns.appendChild(del);
    row.appendChild(left); row.appendChild(btns); dashList.appendChild(row);
  });
}
function renderDashLog(){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const dh=sess.workout.dash; dashLogList.innerHTML='';
  dh.events.slice().reverse().forEach((ev)=>{
    const idx=dh.events.indexOf(ev);
    const item=document.createElement('div'); item.className='log-item';
    const left=document.createElement('div'); left.className='log-left';
    const main=document.createElement('div'); main.style.fontWeight='700'; main.textContent='#'+ev.id+' \u2014 '+msToLabel(ev.timecode_ms);
    const meta=document.createElement('div'); meta.className='log-meta'; meta.textContent=(ev.player||'')+'  \u00b7  60YD  \u00b7  '+(ev.bad_data||'NO');
    left.appendChild(main); left.appendChild(meta);
    const actions=document.createElement('div');
    const opts=document.createElement('button'); opts.className='btn small'; opts.textContent='Options';
    opts.addEventListener('click', ()=> openWorkoutOptions('dash', idx));
    actions.appendChild(opts);
    item.appendChild(left); item.appendChild(actions); dashLogList.appendChild(item);
  });
}
function buildDashCsv(sess){
  const header='LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,BAD_DATA';
  const rows=sess.workout.dash.events.map(e=>[e.id,e.timecode_ms,e.player,(e.player_id||playerIdFor(sess,e.player)),(e.bad_data||'NO')].map(csvEscape).join(','));
  return header+'\n'+rows.join('\n')+(rows.length?'\n':'');
}
function exportDash(){
  const sess=getCurrentSession(); if(!sess) return;
  const en=sanitizeEventName(sess.name);
  exportStopAndStore(s=>buildDashCsv(s), en+'_60YD_Dash', '60YD Dash CSV', s=>{ s.workout.dash.events=[]; });
}
function addDashPlayer(raw){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const dh=sess.workout.dash; const val=(raw||'').trim(); if(!val) return; const parsed=parseNameAndId(val); const name=parsed.name; if(!name) return; if(parsed.id) assignPlayerId(name, parsed.id);
  if(!dh.players.includes(name)) dh.players.push(name); dh.selectedPlayer=name; saveAll(); renderDashList();
}
async function openWorkoutOptions(kind, index){
  const sess = getCurrentSession(); if (!sess) return; ensureWorkout(sess);
  const store = kind==='defense' ? sess.workout.defense : kind==='dash' ? sess.workout.dash : sess.workout.bp;
  const ev = store.events[index]; if (!ev) return;
  const bad = (ev.bad_data==='YES');
  const detail = kind==='defense' ? (ev.position||'') : kind==='dash' ? '60YD' : (ev.angle||'');
  // Candidate players this log entry can be reassigned to, drawn from the
  // matching workout list(s). Always include the entry's current player.
  let candidates;
  if (kind==='defense'){ const d=sess.workout.defense; candidates = d.outfielders.concat(d.infielders, d.catchers); }
  else { candidates = (store.players||[]).slice(); }
  if (ev.player && !candidates.includes(ev.player)) candidates.unshift(ev.player);
  candidates = Array.from(new Set(candidates));
  const html = '<div style="display:flex;flex-direction:column;gap:8px">'
    + '<label style="font-size:13px;color:var(--muted)">Player</label>'
    + '<select id="wk-player" style="padding:8px;border-radius:8px;border:1px solid var(--soft-border)">'
    + candidates.map(n=>'<option value="'+escapeHtml(n)+'"'+(ev.player===n?' selected':'')+'>'+escapeHtml(n)+'</option>').join('')
    + '</select>'
    + '<div style="font-size:13px;color:var(--muted)">'+escapeHtml(detail)+'</div>'
    + '<label><input type="checkbox" id="wk-bad"'+(bad?' checked':'')+' /> Mark BAD_DATA</label>'
    + '</div>';
  const res = await showModal({ title:'Options', html, buttons:[{label:'Save',value:'save',className:'btn'},{label:'Delete',value:'delete',className:'btn warn'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  if (res==='cancel' || !res) return;
  if (res==='delete'){ const c = await showModal({ title:'Delete entry?', message:'Delete this entry?', buttons:[{label:'Delete',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!c) return; store.events.splice(index,1); saveAll(); kind==='defense'?renderDefenseLog():kind==='dash'?renderDashLog():renderBPLog(); return; }
  if (res==='save'){ const np=$('wk-player').value; if(np){ ev.player=np; ev.player_id=playerIdFor(sess,np); } ev.bad_data = $('wk-bad').checked ? 'YES':'NO'; saveAll(); kind==='defense'?renderDefenseLog():kind==='dash'?renderDashLog():renderBPLog(); return; }
}

/* ===== CSV storage rendering ===== */
function renderCsvStorage(){
  const sess = getCurrentSession(); if (!sess) return; ensureWorkout(sess);
  csvStorageList.innerHTML='';
  const items = sess.csvStorage;
  downloadAllBtn.disabled = items.length===0;
  if (!items.length){ const e=document.createElement('div'); e.className='csv-empty'; e.textContent='No CSV stored yet. Use EXPORT on a list to stop the clock and store a CSV here.'; csvStorageList.appendChild(e); return; }
  items.forEach((it)=>{
    const row = document.createElement('div'); row.className='csv-row';
    const left = document.createElement('div'); left.style.minWidth='0'; left.style.flex='1';
    const nm = document.createElement('div'); nm.className='cname'; nm.textContent=it.name;
    const lines = (it.content||'').trim().split('\n').length - 1;
    const mt = document.createElement('div'); mt.className='cmeta'; mt.textContent=Math.max(0,lines)+' row(s)';
    left.appendChild(nm); left.appendChild(mt);
    const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='6px';
    const dl = document.createElement('button'); dl.className='btn small'; dl.textContent='Download';
    dl.addEventListener('click', ()=> downloadCsv(it.name, it.content));
    const rm = document.createElement('button'); rm.className='btn ghost small'; rm.textContent='\u2715';
    rm.addEventListener('click', ()=>{ const i = sess.csvStorage.indexOf(it); if (i>=0) sess.csvStorage.splice(i,1); saveAll(); renderCsvStorage(); });
    btns.appendChild(dl); btns.appendChild(rm);
    row.appendChild(left); row.appendChild(btns); csvStorageList.appendChild(row);
  });
}

/* ===== CSV builders ===== */
function csvEscape(v){ v = String(v==null?'':v); if (/[",\n]/.test(v)) return '"'+v.replace(/"/g,'""')+'"'; return v; }
function sanitizeEventName(name){ return String(name||'Event').trim().replace(/[^A-Za-z0-9_\-]+/g,'_').replace(/^_+|_+$/g,'') || 'Event'; }

function buildGameCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,PITCHER,PITCHER_ID,PITCH_GROUP,VELO,LOCATION,IN_ZONE,SWING,CONTACT,CONTACT_QUALITY,BB_TYPE,BATTED_TO,PA_OUTCOME,PITCH_X,PITCH_Y,BAD_DATA';
  const rows = sess.events.map(e => [e.id, e.timecode_ms, e.player, (e.player_id||playerIdFor(sess,e.player)), e.pitcher, (e.pitcher_id||playerIdFor(sess,e.pitcher)), (e.pitch_group||''), (e.velo||''), (LOC_LABEL[e.location]||(e.inzone?'In Zone':'Out of Zone')), (e.inzone?'Y':'N'), (e.swing||''), (evContact(e)?'Y':'N'), (e.contact_quality||''), (e.batted_ball||''), (e.batted_to||''), (e.pa_outcome||e.play||(Array.isArray(e.result)&&e.result.length?e.result.join('/'):'')||''), (e.pitch_x!=null?Number(e.pitch_x).toFixed(1):''), (e.pitch_y!=null?Number(e.pitch_y).toFixed(1):''), (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildPlaysCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,PITCHER,PITCHER_ID,PITCH_GROUP,VELO,LOCATION,IN_ZONE,SWING,CONTACT,CONTACT_QUALITY,BB_TYPE,BATTED_TO,PA_OUTCOME,PITCH_X,PITCH_Y,BAD_DATA';
  const rows = sess.events.filter(e => e.pa_outcome || e.play || (Array.isArray(e.result)&&e.result.length)).map(e => [e.id, e.timecode_ms, e.player, (e.player_id||playerIdFor(sess,e.player)), e.pitcher, (e.pitcher_id||playerIdFor(sess,e.pitcher)), (e.pitch_group||''), (e.velo||''), (LOC_LABEL[e.location]||(e.inzone?'In Zone':'Out of Zone')), (e.inzone?'Y':'N'), (e.swing||''), (evContact(e)?'Y':'N'), (e.contact_quality||''), (e.batted_ball||''), (e.batted_to||''), (e.pa_outcome||e.play||(Array.isArray(e.result)&&e.result.length?e.result.join('/'):'')||''), (e.pitch_x!=null?Number(e.pitch_x).toFixed(1):''), (e.pitch_y!=null?Number(e.pitch_y).toFixed(1):''), (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildDefenseCsv(sess, group){
  const pos = DEF_POS[group];
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,POSITION,BAD_DATA';
  const rows = sess.workout.defense.events.filter(e => e.position===pos).map(e => [e.id, e.timecode_ms, e.player, (e.player_id||playerIdFor(sess,e.player)), e.position, (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildAllDefenseCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,POSITION,BAD_DATA';
  const rows = sess.workout.defense.events.map(e => [e.id, e.timecode_ms, e.player, (e.player_id||playerIdFor(sess,e.player)), e.position, (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildBPCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,ANGLE,BAD_DATA';
  const rows = sess.workout.bp.events.map(e => [e.id, e.timecode_ms, e.player, (e.player_id||playerIdFor(sess,e.player)), e.angle, (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}

/* ===== download helpers ===== */
function downloadCsv(filename, content){
  const blob = new Blob([content], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/* ===== store CSV in memory ===== */
function storeCsv(sess, name, content){
  // de-dup by name: replace existing with same name
  const existing = sess.csvStorage.find(c => c.name===name);
  if (existing){ existing.content = content; }
  else { sess.csvStorage.push({ id: uid('csv'), name, content }); }
  saveAll(); renderCsvStorage();
}

/* ===== next numbered CSV name for a section prefix ===== */
function nextCsvName(sess, prefix){
  let max = 0;
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(\\d+)\\.csv$');
  sess.csvStorage.forEach(c => { const m = re.exec(c.name); if (m){ const n = parseInt(m[1],10); if (n>max) max=n; } });
  return prefix + (max+1) + '.csv';
}

/* ===== export flow (reset clock then store) ===== */
async function exportStopAndStore(buildFn, prefix, toastLabel, clearFn){
  const sess = getCurrentSession(); if (!sess) return;
  const ok = await showModal({ title:'Export', message:'This will reset the clock and clear the log, proceed?', buttons:[{label:'Proceed',value:true,className:'btn'},{label:'Cancel',value:false,className:'btn ghost'}] });
  if (!ok) return;
  const content = buildFn(sess);
  const filename = nextCsvName(sess, prefix);
  storeCsv(sess, filename, content);
  resetClock();
  if (clearFn) clearFn(sess);
  saveAll(); renderDefenseLog(); renderBPLog();
  showToast(toastLabel+' stored as '+filename, 'store-toast');
}
function exportDefense(group){
  const sess = getCurrentSession(); if (!sess) return;
  const en = sanitizeEventName(sess.name);
  const pos = DEF_POS[group];
  const prefix = en + '_' + pos + '_Defense';
  exportStopAndStore(
    s => buildDefenseCsv(s, group),
    prefix,
    DEF_LABEL[group]+' CSV',
    s => { s.workout.defense.events = s.workout.defense.events.filter(e => e.position !== pos); }
  );
}
function exportBP(){
  const sess = getCurrentSession(); if (!sess) return;
  const en = sanitizeEventName(sess.name);
  const angle = (sess.workout.bp.angle || 'S');
  const prefix = en + '_BP_' + (angle==='S' ? 'Side' : 'BehindHome');
  const label = (angle==='S' ? 'BP Side' : 'BP Behind Home');
  exportStopAndStore(
    s => buildBPCsv(s),
    prefix,
    label+' CSV',
    s => { s.workout.bp.events = []; }
  );
}

/* ===== top Workout CSV dropdown downloads ===== */
function workoutCsvDownload(kind){
  const sess = getCurrentSession(); if (!sess) return;
  const en = sanitizeEventName(sess.name);
  if (kind==='dash'){ downloadCsv(en+'_60YD_Dash.csv', buildDashCsv(sess)); }
  else if (kind==='of'){ downloadCsv(en+'_OF_Defense.csv', buildDefenseCsv(sess,'outfielders')); }
  else if (kind==='if'){ downloadCsv(en+'_IF_Defense.csv', buildDefenseCsv(sess,'infielders')); }
  else if (kind==='c'){ downloadCsv(en+'_C_Defense.csv', buildDefenseCsv(sess,'catchers')); }
  else if (kind==='alldef'){ downloadCsv(en+'_All_Defense.csv', buildAllDefenseCsv(sess)); }
  else if (kind==='allbp'){ downloadCsv(en+'_BP.csv', buildBPCsv(sess)); }
}
function downloadAllStored(){
  const sess = getCurrentSession(); if (!sess) return;
  if (!sess.csvStorage.length){ showToast('Nothing stored'); return; }
  sess.csvStorage.forEach((it, i)=> setTimeout(()=> downloadCsv(it.name, it.content), i*180));
}

/* ===== flash + clock helpers ===== */
function flashElement(el){ const duration=850; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(()=>{ el.classList.remove('flash'); }, duration+50); }
async function ensureClockRunningOrAsk(sess){
  ensureSessionClock(sess);
  if (sess.clock.running) return true;
  const ans = await showModal({ title:'You cannot start logging without the clock running', message:'Start?', buttons:[{label:'Yes',value:true,className:'btn'},{label:'No',value:false,className:'btn ghost'}]});
  if (!ans) return false;
  sess.clock.running = true; sess.clock.startTimestamp = Date.now(); saveAll(); renderClockButtons(); updateClockDisplay(); return true;
}
function startClockCurrent(){ const sess=getCurrentSession(); if(!sess) return; ensureSessionClock(sess); if (sess.clock.running) return; sess.clock.running=true; sess.clock.startTimestamp=Date.now(); saveAll(); renderClockButtons(); updateClockDisplay(); }
async function pauseClockCurrent(){ const sess=getCurrentSession(); if(!sess) return; ensureSessionClock(sess); const ok=await showModal({ title:'Pause clock', message:'Are you sure you want to pause?', buttons:[{label:'Pause',value:true,className:'btn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if(!ok) return; if (sess.clock.running && sess.clock.startTimestamp) sess.clock.elapsedBefore=computeSessionElapsedMs(sess); sess.clock.running=false; sess.clock.startTimestamp=null; saveAll(); renderClockButtons(); updateClockDisplay(); }
async function resetClockCurrent(){ const sess=getCurrentSession(); if(!sess) return; const ok=await showModal({ title:'Reset clock', message:'Are you sure you want to reset?', buttons:[{label:'Reset',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if(!ok) return; sess.clock.running=false; sess.clock.elapsedBefore=0; sess.clock.startTimestamp=null; saveAll(); renderClockButtons(); updateClockDisplay(); }
/* plain reset (no confirm) used by export flow */
function resetClock(){ const sess=getCurrentSession(); if(!sess) return; ensureSessionClock(sess); sess.clock.running=false; sess.clock.elapsedBefore=0; sess.clock.startTimestamp=null; saveAll(); renderClockButtons(); updateClockDisplay(); }
/* floating start-clock button */
function floatStartClicked(){ const sess=getCurrentSession(); if(!sess){ showToast('Create/select an event first'); return; } flashElement(floatStartBtn); if (sess.clock && sess.clock.running){ showToast('Clock already running'); return; } startClockCurrent(); showToast('Clock started'); }

/* ===== GAME float logging ===== */
async function floatLogClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  if (!(await ensureClockRunningOrAsk(sess))) return;
  const team=sess.teams[state.currentSide];
  const ev={ id:allocEventId(sess), timecode_ms:Math.round(computeSessionElapsedMs(sess)), type:'', mph:'', player:team.selectedHitter||'', player_id:playerIdFor(sess, team.selectedHitter), pitcher:team.selectedPitcher||'', pitcher_id:playerIdFor(sess, team.selectedPitcher), bad_data:'NO', notes:{}, contact:'', play:'' };
  sess.events.push(ev); saveAll(); renderLog(); updatePitcherCountBadges();
  flashElement(floatBtn); showToast('Logged #'+ev.id+' - '+msToToastTime(ev.timecode_ms));
}
async function floatContactClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  if (!(await ensureClockRunningOrAsk(sess))) return;
  ensureSessionCounters(sess);
  const team=sess.teams[state.currentSide];
  const ev={ id:allocEventId(sess), timecode_ms:Math.round(computeSessionElapsedMs(sess)), type:'', mph:'', player:team.selectedHitter||'', player_id:playerIdFor(sess, team.selectedHitter), pitcher:team.selectedPitcher||'', pitcher_id:playerIdFor(sess, team.selectedPitcher), bad_data:'NO', notes:{}, contact:sess.nextContactId++, play:'' };
  sess.events.push(ev); saveAll(); renderLog(); updatePitcherCountBadges();
  flashElement(floatContactBtn); showToast('Contact #'+ev.contact+' - '+msToToastTime(ev.timecode_ms), 'contact');
}
async function floatWorkoutClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  ensureWorkout(sess);
  if (!(await ensureClockRunningOrAsk(sess))) return;
  if (state.workoutSection==='dash'){
    const dh=sess.workout.dash;
    if (!dh.selectedPlayer){ showToast('Select a runner first'); return; }
    const ev={ id:allocEventId(dh), timecode_ms:Math.round(computeSessionElapsedMs(sess)), player:dh.selectedPlayer, player_id:playerIdFor(sess, dh.selectedPlayer), bad_data:'NO' };
    dh.events.push(ev); saveAll(); renderDashLog();
    flashElement(floatWorkoutBtn); showToast('Logged #'+ev.id+' 60YD - '+msToToastTime(ev.timecode_ms), 'store-toast');
  } else if (state.workoutSection==='defense'){
    const d=sess.workout.defense;
    if (!d.selectedPlayer){ showToast('Select a player first'); return; }
    const pos = DEF_POS[d.selectedGroup] || 'OF';
    const ev={ id:allocEventId(d), timecode_ms:Math.round(computeSessionElapsedMs(sess)), player:d.selectedPlayer, player_id:playerIdFor(sess, d.selectedPlayer), position:pos, bad_data:'NO' };
    d.events.push(ev); saveAll(); renderDefenseLog();
    flashElement(floatWorkoutBtn); showToast('Logged #'+ev.id+' '+pos+' - '+msToToastTime(ev.timecode_ms), 'store-toast');
  } else {
    const b=sess.workout.bp;
    if (!b.selectedPlayer){ showToast('Select a player first'); return; }
    const ev={ id:allocEventId(b), timecode_ms:Math.round(computeSessionElapsedMs(sess)), player:b.selectedPlayer, player_id:playerIdFor(sess, b.selectedPlayer), angle:(b.angle||'S'), bad_data:'NO' };
    b.events.push(ev); saveAll(); renderBPLog();
    flashElement(floatWorkoutBtn); showToast('Logged #'+ev.id+' '+ev.angle+' - '+msToToastTime(ev.timecode_ms), 'store-toast');
  }
}

/* ===== add players ===== */
function addPlayer(type, raw){
  const sess=getCurrentSession(); if(!sess) return showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]});
  const team=sess.teams[state.currentSide]; const val=(raw||'').trim(); if(!val) return; const parsed=parseNameAndId(val); const name=parsed.name; if(!name) return; if(parsed.id) assignPlayerId(name, parsed.id);
  if (type==='pitcher'){ if(!team.pitchers.includes(name)) team.pitchers.push(name); team.selectedPitcher=name; }
  else { if(!team.hitters.includes(name)) team.hitters.push(name); team.selectedHitter=name; }
  saveAll(); renderPlayerLists();
}
function addDefensePlayer(group, raw){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const d=sess.workout.defense; const val=(raw||'').trim(); if(!val) return; const parsed=parseNameAndId(val); const name=parsed.name; if(!name) return; if(parsed.id) assignPlayerId(name, parsed.id);
  if (!d[group].includes(name)) d[group].push(name); d.selectedGroup=group; d.selectedPlayer=name;
  saveAll(); renderDefenseLists();
}
function addBPPlayer(raw){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const b=sess.workout.bp; const val=(raw||'').trim(); if(!val) return; const parsed=parseNameAndId(val); const name=parsed.name; if(!name) return; if(parsed.id) assignPlayerId(name, parsed.id);
  if (!b.players.includes(name)) b.players.push(name); b.selectedPlayer=name;
  saveAll(); renderBPList();
}

/* ===== clear log (game only) ===== */
async function clearLog(){ const sess=getCurrentSession(); if(!sess) return; const ok=await showModal({title:'Clear Log',message:'Clear all Game entries for this event?',buttons:[{label:'Clear',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if(!ok) return; sess.events=[]; sess.nextId=1; sess.nextContactId=1; sess.nextPlayId=1; selState.idx=null; selState.whole=false; saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges(); }

/* ===== copy / paste player lists ===== */
function copyTextToClipboard(text){
  try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text); } catch(e){}
  return new Promise((resolve)=>{ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch(e){} document.body.removeChild(ta); resolve(); });
}
async function pasteNamesModal(title){
  const html = '<div style="display:flex;flex-direction:column;gap:8px">'
    + '<div style="font-size:12px;color:var(--muted)">Paste names (one per line or comma-separated).</div>'
    + '<textarea id="paste-area" rows="6" style="width:100%"></textarea></div>';
  const res = await showModal({ title, html, buttons:[{label:'Add',value:'add',className:'btn'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  if (res!=='add') return null;
  const raw = $('paste-area').value || '';
  const names = raw.split(/[\n,]+/).map(s=>titleCaseName(s.trim())).filter(Boolean);
  return names;
}
function copyGameList(kind){
  const sess=getCurrentSession(); if(!sess) return; const team=sess.teams[state.currentSide];
  const names = kind==='pitchers'? team.pitchers : team.hitters;
  copyTextToClipboard(names.join('\n')); showToast('Copied '+names.length+' name(s)');
}
async function pasteGameList(kind){
  const sess=getCurrentSession(); if(!sess) return; const team=sess.teams[state.currentSide];
  const names = await pasteNamesModal(kind==='pitchers'?'Paste pitchers':'Paste hitters'); if(!names||!names.length) return;
  const arr = kind==='pitchers'? team.pitchers : team.hitters;
  names.forEach(n=>{ if(!arr.includes(n)) arr.push(n); });
  if (kind==='pitchers') team.selectedPitcher = arr[arr.length-1]; else team.selectedHitter = arr[arr.length-1];
  saveAll(); renderPlayerLists(); showToast('Added '+names.length+' name(s)');
}
function copyWorkoutList(group){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const names = group==='bp' ? sess.workout.bp.players : group==='dash' ? sess.workout.dash.players : sess.workout.defense[group];
  copyTextToClipboard(names.join('\n')); showToast('Copied '+names.length+' name(s)');
}
async function pasteWorkoutList(group){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const names = await pasteNamesModal('Paste names'); if(!names||!names.length) return;
  if (group==='bp'){ const b=sess.workout.bp; names.forEach(n=>{ if(!b.players.includes(n)) b.players.push(n); }); b.selectedPlayer=b.players[b.players.length-1]; saveAll(); renderBPList(); }
  else if (group==='dash'){ const dh=sess.workout.dash; names.forEach(n=>{ if(!dh.players.includes(n)) dh.players.push(n); }); dh.selectedPlayer=dh.players[dh.players.length-1]; saveAll(); renderDashList(); }
  else { const d=sess.workout.defense; names.forEach(n=>{ if(!d[group].includes(n)) d[group].push(n); }); d.selectedGroup=group; d.selectedPlayer=d[group][d[group].length-1]; saveAll(); renderDefenseLists(); }
  showToast('Added '+names.length+' name(s)');
}

/* ===== floating button visibility (tab-aware) ===== */
function updateFloatingButtonVisibility(){
  // Game floats are fully retired: pitches log on the strike zone, clock starts from the Strike Zone panel.
  if (floatBtn) floatBtn.style.display = 'none';
  if (floatContactBtn) floatContactBtn.style.display = 'none';
  if (floatStartBtn) floatStartBtn.style.display = 'none';
  const isWorkout = state.activeTab==='workout';
  if (floatWorkoutBtn) floatWorkoutBtn.style.display = isWorkout ? 'flex' : 'none';
}

/* ===== tab + section switching ===== */
function setActiveTab(tab){
  state.activeTab = tab; saveAll();
  tabGame.classList.toggle('active', tab==='game');
  tabWorkout.classList.toggle('active', tab==='workout');
  gameTab.style.display = tab==='game' ? '' : 'none';
  workoutTab.style.display = tab==='workout' ? '' : 'none';
  const csvBox = document.querySelector('.csv-storage'); if (csvBox) csvBox.style.display = '';
  clockHint.textContent = tab==='game' ? 'Game: pick the matchup, then click the strike zone to log pitches.' : 'Workout: Defense (OF/IF/C) and Batting Practice. EXPORT stores a CSV below.';
  if (tab==='game'){ renderActiveSelects(); renderStrikeZone(); }
  updateFloatingButtonVisibility();
}
function setWorkoutSection(sec){
  state.workoutSection = sec; saveAll();
  wsecDash.classList.toggle('active', sec==='dash');
  wsecDefense.classList.toggle('active', sec==='defense');
  wsecBP.classList.toggle('active', sec==='bp');
  dashSection.style.display = sec==='dash' ? '' : 'none';
  defenseSection.style.display = sec==='defense' ? '' : 'none';
  bpSection.style.display = sec==='bp' ? '' : 'none';
  if (floatWorkoutBtn){ floatWorkoutBtn.textContent = 'Log';
  const c = sec==='dash' ? 'var(--dash-orange)' : sec==='defense' ? 'var(--of-green)' : 'var(--bp-teal)';
  floatWorkoutBtn.style.background = c; }
}

/* ===== angle checkboxes (mutually exclusive) ===== */
function setAngle(val){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  sess.workout.bp.angle = val;
  angleSide.checked = (val==='S');
  angleBehind.checked = (val==='BH');
  saveAll();
}

/* ===== draggable floating buttons (generic) ===== */
function initDraggableFloat(btn, stateKey, defaultLeft, defaultBottom){
  let dragging=false, startX=0, startY=0, origLeft=0, origTop=0, moved=false, suppressClick=false, resizeMode=false;
  function applyState(){
    const s = floatState[stateKey] || {}; const size = s.size || 96;
    btn.style.width=size+'px'; btn.style.height=size+'px'; btn.style.fontSize=Math.max(11, Math.round(size/4.5))+'px';
    if (s.left!=null && s.top!=null){ btn.style.left=s.left+'px'; btn.style.top=s.top+'px'; btn.style.right='auto'; btn.style.bottom='auto'; }
    else { btn.style.left=defaultLeft+'px'; btn.style.bottom=defaultBottom+'px'; }
  }
  applyState();
  function down(e){ if (floatState.locked) return; if (resizeMode){ e.preventDefault(); btn.setPointerCapture(e.pointerId); return; } dragging=true; moved=false; const rect=btn.getBoundingClientRect(); origLeft=rect.left; origTop=rect.top; startX=e.clientX; startY=e.clientY; btn.setPointerCapture(e.pointerId); document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); }
  function move(e){ if(!dragging) return; const dx=e.clientX-startX, dy=e.clientY-startY; if (Math.abs(dx)>4||Math.abs(dy)>4) moved=true; const padding=8; const btnW=btn.offsetWidth, btnH=btn.offsetHeight; let nl=origLeft+dx, nt=origTop+dy; nl=Math.max(padding, Math.min(window.innerWidth-btnW-padding, nl)); nt=Math.max(padding, Math.min(window.innerHeight-btnH-padding, nt)); btn.style.left=nl+'px'; btn.style.top=nt+'px'; }
  function up(e){ if(!dragging) return; dragging=false; try { btn.releasePointerCapture(e.pointerId); } catch(_){} document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if(!moved) return; const rect=btn.getBoundingClientRect(); if(!floatState[stateKey]) floatState[stateKey]={}; floatState[stateKey].left=rect.left; floatState[stateKey].top=rect.top; saveAll(); suppressClick=true; setTimeout(()=> suppressClick=false, 150); }
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('click', (e)=>{ if (suppressClick){ e.stopPropagation(); e.preventDefault(); return; }
    if (stateKey==='pitch') floatLogClicked();
    else if (stateKey==='contact') floatContactClicked();
    else if (stateKey==='workout') floatWorkoutClicked();
    else if (stateKey==='start') floatStartClicked();
  });
  btn.addEventListener('dblclick', ()=>{ if (floatState.locked) return; resizeMode=!resizeMode; btn.classList.toggle('resize-active', resizeMode); if(!resizeMode){ const r=btn.getBoundingClientRect(); if(!floatState[stateKey]) floatState[stateKey]={}; floatState[stateKey].left=r.left; floatState[stateKey].top=r.top; floatState[stateKey].size=r.width; saveAll(); } else { btn.focus(); } });
  btn.addEventListener('wheel', (e)=>{ if(!btn.classList.contains('resize-active')) return; e.preventDefault(); const step=Math.sign(-e.deltaY)*4; adjustSize(step); }, { passive:false });
  btn.addEventListener('keydown', (e)=>{ if(!btn.classList.contains('resize-active')) return; if (e.key==='+'||e.key==='='){ e.preventDefault(); adjustSize(4);} if (e.key==='-'){ e.preventDefault(); adjustSize(-4);} });
  function adjustSize(delta){ const min=44, max=140; const cur=(floatState[stateKey]&&floatState[stateKey].size)||btn.offsetWidth||96; let n=Math.max(min, Math.min(max, cur+delta)); if(!floatState[stateKey]) floatState[stateKey]={}; floatState[stateKey].size=n; applyState(); saveAll(); }
}
function initAllFloating(){
  if (!floatState.pitch) floatState.pitch={left:null,top:null,size:96};
  if (!floatState.contact) floatState.contact={left:null,top:null,size:96};
  if (!floatState.play) floatState.play={left:null,top:null,size:96};
  if (!floatState.workout) floatState.workout={left:null,top:null,size:96};
  if (!floatState.start) floatState.start={left:null,top:null,size:58};
  if (floatState.left!=null && floatState.top!=null && floatState.pitch.left==null){ floatState.pitch.left=floatState.left; floatState.pitch.top=floatState.top; }
  if (floatState.size!=null && floatState.pitch.size==null){ floatState.pitch.size=floatState.size; }
  initDraggableFloat(floatWorkoutBtn, 'workout', 18, 18);
  if (lockFloatsCheckbox){ lockFloatsCheckbox.checked = !!floatState.locked; }
  document.body.classList.toggle('floats-locked', !!floatState.locked);
  updateFloatingButtonVisibility();
}

/* ===== game CSV download ===== */
function gameCsvDownload(kind){
  const sess=getCurrentSession(); if(!sess) return showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]});
  if (!sess.events.length) return showModal({title:'No entries',message:'No Game log entries to export.',buttons:[{label:'OK',value:true}]});
  const en=sanitizeEventName(sess.name);
  if (kind==='plays'){
    if (!sess.events.some(e=>e.play)) return showModal({title:'No plays',message:'No play entries to export.',buttons:[{label:'OK',value:true}]});
    downloadCsv(en+'_Plays.csv', buildPlaysCsv(sess));
  } else {
    downloadCsv(en+'_Pitches.csv', buildGameCsv(sess));
  }
}

/* ===== wire up ===== */
if (logSearchInput){ logSearchInput.addEventListener('input', ()=>{ logSearchTerm=logSearchInput.value||''; if(logSearchClear) logSearchClear.style.display=logSearchTerm?'block':'none'; renderLog(); }); }
if (logSearchClear){ logSearchClear.style.display='none'; logSearchClear.addEventListener('click', ()=>{ logSearchTerm=''; if(logSearchInput) logSearchInput.value=''; logSearchClear.style.display='none'; renderLog(); }); }
sessionSelect.addEventListener('change', (e)=>{ state.currentSessionId=e.target.value; selState.idx=null; selState.whole=false; saveAll(); renderAll(); });
createSessionBtn.addEventListener('click', async ()=>{
  const html='<div style="display:flex;flex-direction:column;gap:8px"><input id="sess-name" placeholder="Event name" /><input id="sess-date" type="date" value="'+new Date().toISOString().slice(0,10)+'" /></div>';
  const res=await showModal({ title:'Create Event', html, buttons:[{label:'Create',value:'create',className:'btn'},{label:'Cancel',value:'cancel',className:'btn ghost'}]});
  if (res!=='create') return;
  const nm=$('sess-name').value.trim(), dt=$('sess-date').value.trim();
  if (!nm||!dt) return showModal({title:'Missing',message:'Please provide name and date.',buttons:[{label:'OK',value:true}]});
  const s=buildDefaultSession(nm, dt); state.sessions.push(s); state.currentSessionId=s.id; saveAll(); renderAll();
});
clearLogBtn.addEventListener('click', clearLog);
/* Lock Floating Buttons: when checked, floating buttons can't be dragged or resized
   (prevents accidentally moving them instead of tapping on touch devices). */
if (lockFloatsCheckbox){
  lockFloatsCheckbox.addEventListener('change', ()=>{ floatState.locked = lockFloatsCheckbox.checked; document.body.classList.toggle('floats-locked', floatState.locked); saveAll(); });
}
addPitcherBtn.addEventListener('click', ()=>{ addPlayer('pitcher', addPitcherInput.value); addPitcherInput.value=''; });
addHitterBtn.addEventListener('click', ()=>{ addPlayer('hitter', addHitterInput.value); addHitterInput.value=''; });
addPitcherInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ addPitcherBtn.click(); e.preventDefault(); }});
addHitterInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ addHitterBtn.click(); e.preventDefault(); }});
addPitcherInput.addEventListener('blur', ()=> addPitcherInput.value=titleCaseName(addPitcherInput.value));
addHitterInput.addEventListener('blur', ()=> addHitterInput.value=titleCaseName(addHitterInput.value));
/* Firestore player search on Game add-inputs */
function addDbPlayer(type, name, id){
  const sess=getCurrentSession(); if(!sess) return;
  const team=sess.teams[state.currentSide];
  if (type==='pitcher'){ if(!team.pitchers.includes(name)) team.pitchers.push(name); team.selectedPitcher=name; }
  else { if(!team.hitters.includes(name)) team.hitters.push(name); team.selectedHitter=name; }
  assignPlayerId(name, id);
  saveAll(); renderPlayerLists(); updatePitcherCountBadges();
}
attachPlayerSearch(addPitcherInput, (name,id)=> addDbPlayer('pitcher', name, id));
attachPlayerSearch(addHitterInput, (name,id)=> addDbPlayer('hitter', name, id));

/* Workout add-inputs: same live Firestore player search as the Game tab.
   Picking a DB player adds them to the matching workout list and records the id. */
function addDbWorkoutPlayer(target, name, id){
  if (target==='dash') addDashPlayer(name);
  else if (target==='bp') addBPPlayer(name);
  else addDefensePlayer(target, name); // 'outfielders' | 'infielders' | 'catchers'
  assignPlayerId(name, id);
}
attachPlayerSearch($('add-dash'), (name,id)=> addDbWorkoutPlayer('dash', name, id));
attachPlayerSearch($('add-of'),   (name,id)=> addDbWorkoutPlayer('outfielders', name, id));
attachPlayerSearch($('add-if'),   (name,id)=> addDbWorkoutPlayer('infielders', name, id));
attachPlayerSearch($('add-c'),    (name,id)=> addDbWorkoutPlayer('catchers', name, id));
attachPlayerSearch($('add-bp'),   (name,id)=> addDbWorkoutPlayer('bp', name, id));
exportBtn.addEventListener('click', (e)=>{ e.stopPropagation(); gameCsvMenu.classList.toggle('open'); });
document.addEventListener('click', (e)=>{ if (!gameCsvMenu.contains(e.target) && e.target!==exportBtn) gameCsvMenu.classList.remove('open'); });
gameCsvMenu.addEventListener('click', (e)=>{ const t=e.target.closest('[data-gcsv]'); if(!t) return; gameCsvDownload(t.getAttribute('data-gcsv')); gameCsvMenu.classList.remove('open'); });

$('copy-pitchers').addEventListener('click', ()=> copyGameList('pitchers'));
$('paste-pitchers').addEventListener('click', ()=> pasteGameList('pitchers'));
$('copy-hitters').addEventListener('click', ()=> copyGameList('hitters'));
$('paste-hitters').addEventListener('click', ()=> pasteGameList('hitters'));

/* workout add buttons */
function wireAdd(btnId, inputId, fn){ const b=$(btnId), i=$(inputId); if(!b||!i) return; b.addEventListener('click', ()=>{ fn(i.value); i.value=''; }); i.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ b.click(); e.preventDefault(); }}); i.addEventListener('blur', ()=> i.value=titleCaseName(i.value)); }
wireAdd('add-of-btn','add-of', (v)=> addDefensePlayer('outfielders', v));
wireAdd('add-if-btn','add-if', (v)=> addDefensePlayer('infielders', v));
wireAdd('add-c-btn','add-c', (v)=> addDefensePlayer('catchers', v));
wireAdd('add-bp-btn','add-bp', (v)=> addBPPlayer(v));
wireAdd('add-dash-btn','add-dash', (v)=> addDashPlayer(v));

/* workout copy/paste + export (event delegation) */
document.addEventListener('click', (e)=>{
  const t = e.target.closest('[data-copy],[data-paste],[data-export-def],[data-export-bp],[data-export-dash],[data-wcsv]');
  if (!t) return;
  if (t.hasAttribute('data-copy')) copyWorkoutList(t.getAttribute('data-copy'));
  else if (t.hasAttribute('data-paste')) pasteWorkoutList(t.getAttribute('data-paste'));
  else if (t.hasAttribute('data-export-def')) exportDefense(t.getAttribute('data-export-def'));
  else if (t.hasAttribute('data-export-bp')) exportBP();
  else if (t.hasAttribute('data-export-dash')) exportDash();
  else if (t.hasAttribute('data-wcsv')){ workoutCsvDownload(t.getAttribute('data-wcsv')); workoutCsvMenu.classList.remove('open'); }
});

/* workout CSV dropdown */
workoutCsvBtn.addEventListener('click', (e)=>{ e.stopPropagation(); workoutCsvMenu.classList.toggle('open'); });
document.addEventListener('click', (e)=>{ if (!workoutCsvMenu.contains(e.target) && e.target!==workoutCsvBtn) workoutCsvMenu.classList.remove('open'); });

downloadAllBtn.addEventListener('click', downloadAllStored);

/* tabs */
tabGame.addEventListener('click', ()=> setActiveTab('game'));
tabWorkout.addEventListener('click', ()=> setActiveTab('workout'));
wsecDash.addEventListener('click', ()=> setWorkoutSection('dash'));
wsecDefense.addEventListener('click', ()=> setWorkoutSection('defense'));
wsecBP.addEventListener('click', ()=> setWorkoutSection('bp'));

/* angle checkboxes */
angleSide.addEventListener('change', ()=> setAngle('S'));
angleBehind.addEventListener('change', ()=> setAngle('BH'));

/* side + clock */
if (sideTop && sideBot){ sideTop.addEventListener('click', ()=>{ state.currentSide='top'; saveAll(); renderAll(); }); sideBot.addEventListener('click', ()=>{ state.currentSide='bot'; saveAll(); renderAll(); }); }
if (sideTop2 && sideBot2){ sideTop2.addEventListener('click', ()=>{ state.currentSide='top'; saveAll(); renderAll(); }); sideBot2.addEventListener('click', ()=>{ state.currentSide='bot'; saveAll(); renderAll(); }); }
startBtn.addEventListener('click', ()=>{ startClockCurrent(); renderClockButtons(); });
pauseBtn.addEventListener('click', ()=>{ pauseClockCurrent().then(()=> renderClockButtons()); });
resetBtn.addEventListener('click', ()=>{ resetClockCurrent().then(()=> renderClockButtons()); });

/* ===== render all + init ===== */
function renderAll(){
  const sess=getCurrentSession(); if (sess) ensureWorkout(sess);
  renderSessionSelect(); renderPlayerLists(); renderLog();
  renderActiveSelects(); renderStrikeZone();
  renderDefenseLists(); renderBPList(); renderDashList(); renderDefenseLog(); renderBPLog(); renderDashLog(); renderCsvStorage();
  updateClockDisplay(); renderClockButtons();
  if (sideTop && sideBot){ sideTop.classList.toggle('active', state.currentSide==='top'); sideBot.classList.toggle('active', state.currentSide==='bot'); }
  if (sideTop2 && sideBot2){ sideTop2.classList.toggle('active', state.currentSide==='top'); sideBot2.classList.toggle('active', state.currentSide==='bot'); }
  renderSzDesc();
  if (sess){ const a=sess.workout.bp.angle||'S'; angleSide.checked=(a==='S'); angleBehind.checked=(a==='BH'); }
  setActiveTab(state.activeTab||'game');
  setWorkoutSection(state.workoutSection||'dash');
}
/* ===== NEW: strike-zone pitch flow + stats ===== */
const szArea = $('sz-area');
const szZone = $('sz-zone');
const szStatus = $('sz-status');
const szCount = $('sz-count');
const activePitcherSel = $('active-pitcher');
const activeHitterSel = $('active-hitter');

const PITCH_GROUPS = ['FB','BB','OS'];
const PITCH_GROUP_LABEL = {FB:'Fastball', BB:'Breaking Ball', OS:'OffSpeed'};
const VELO_MIN = 60, VELO_MAX = 115;
const LOC_OPTS = [['NonComp','Non-Competitive'],['IntBall','Intentional Ball']];
const LOC_LABEL = {InZone:'In Zone', OutOfZone:'Out of Zone', NonComp:'Non-Competitive', IntBall:'Intentional Ball'};
const PA_OUTCOMES = ['1B','2B','3B','HR','OUT','FC','E','DP','SAC','SACF'];
const CONTACT_QUALITY = ['Bunt','Weak','Avg','Hard'];
const TRAJECTORY = ['GB','LD','FB','PU'];

function evContact(ev){ return ev && (ev.swing==='InPlay'||ev.swing==='Foul'); }
function evPlayLabel(ev){
  if (!ev) return '';
  if (ev.pa_outcome) return ev.pa_outcome;
  if (Array.isArray(ev.result) && ev.result.length) return ev.result.join('/');
  return '';
}
function evIsPlay(ev){ return !!evPlayLabel(ev); }
function pitchInfoStr(ev){
  const parts=[];
  if (ev.pitch_group) parts.push(ev.pitch_group+(ev.velo?(' '+ev.velo):''));
  if (ev.swing && ev.swing!=='InPlay') parts.push(ev.swing);
  const pl=evPlayLabel(ev); if (pl) parts.push('Play: '+pl);
  if (ev.contact_quality) parts.push(ev.contact_quality);
  if (ev.batted_ball) parts.push(ev.batted_ball);
  return parts.join(' \u00b7 ');
}
function circleClass(ev){
  if (ev.swing==='Whiff') return 'c-whiff';
  if (ev.swing==='Foul') return 'c-foul';
  if (ev.swing==='InPlay') return 'c-inplay';
  if (ev.ball_strike==='Strike') return 'c-cstrike';
  return 'c-ball';
}

/* ----- play grouping + selection + descriptions ----- */
// Group events into plays (plate appearances): each run of pitches ending with a
// terminal play event is one group; trailing pitches with no result are the live at-bat.
function groupsOf(sess){
  const groups=[]; let cur=[];
  const mkey=(ev)=> (ev.pitcher||'')+'\u0000'+(ev.player||''); // matchup = pitcher|hitter
  (sess.events||[]).forEach((ev,idx)=>{
    // Branch into its own container when the matchup (pitcher/hitter) changes from
    // the previous pitch still open in the current group. This makes an edited
    // pitch whose players differ from its container split off instead of staying
    // grouped with the surrounding play.
    if (cur.length && mkey(cur[cur.length-1].ev) !== mkey(ev)){
      groups.push({pitches:cur, terminal:false});
      cur=[];
    }
    cur.push({ev,idx});
    if (evIsPlay(ev)){ groups.push({pitches:cur, terminal:true}); cur=[]; }
  });
  if (cur.length) groups.push({pitches:cur, terminal:false});
  return groups;
}
// Count balls/strikes across a group's pitches. InPlay is a strike in the CSV
// but must NOT bump the displayed strike count (the at-bat ends on contact).
function groupBS(pitches){
  let balls=0, strikes=0;
  for (const p of (pitches||[])){ const e=p.ev;
    if (e.ball_strike==='Ball'){ balls++; }
    else if (e.ball_strike==='Strike' && e.swing!=='InPlay'){
      // A foul with two strikes stays at two strikes (no foul strike-out).
      if (e.swing==='Foul' && strikes>=2) continue;
      strikes++;
    }
  }
  return { balls, strikes };
}
function displayGroup(sess){
  const groups=groupsOf(sess);
  if (selState.idx!=null){
    const g=groups.find(gr=>gr.pitches.some(p=>p.idx===selState.idx));
    if (g) return g;
  }
  const last=groups[groups.length-1];
  if (last && !last.terminal) return last;
  return {pitches:[], terminal:false};
}
// Full description line, pitcher first. 'Strike' is omitted when it's obvious
// (a play, a whiff, or a foul) — CSV data is untouched, only the description text.
function evDescription(ev){
  if (!ev) return '';
  const parts=[ (ev.pitcher||'')+' vs '+(ev.player||'') ];
  if (ev.pitch_group) parts.push(ev.pitch_group+(ev.velo?(' '+ev.velo):''));
  const hideStrike = evIsPlay(ev) || ev.swing==='Whiff' || ev.swing==='Foul';
  if (ev.ball_strike && !(ev.ball_strike==='Strike' && hideStrike)) parts.push(ev.ball_strike);
  if (ev.swing && ev.swing!=='InPlay') parts.push(ev.swing);
  const pl=evPlayLabel(ev); if (pl) parts.push('Play '+pl);
  if (ev.contact_quality) parts.push(ev.contact_quality);
  if (ev.batted_ball) parts.push(ev.batted_ball);
  if (ev.location && LOC_LABEL[ev.location]) parts.push(LOC_LABEL[ev.location]);
  return parts.join(' \u00b7 ');
}
function selectPlay(group){
  const term = group.pitches[group.pitches.length-1];
  const tid = term ? term.idx : null;
  // Clicking the same already-selected play toggles it off.
  if (selState.whole && selState.idx===tid){ selState.idx=null; selState.whole=false; }
  else { selState.idx = tid; selState.whole = true; }
  renderLog(); renderStrikeZone(); renderSzDesc();
}
function selectPitch(idx){
  // Clicking the same already-selected pitch toggles it off.
  if (!selState.whole && selState.idx===idx){ selState.idx=null; selState.whole=false; }
  else { selState.idx = idx; selState.whole = false; }
  renderLog(); renderStrikeZone(); renderSzDesc();
}
// Area above the Balls/Strikes count.
function renderSzDesc(){
  const el = szDesc; if (!el) return;
  el.innerHTML=''; el.className='sz-desc';
  const sess=getCurrentSession();
  if (!sess){ el.textContent='Create or select an event to begin.'; return; }
  ensureSessionClock(sess);
  if (!sess.clock.running){
    const btn=document.createElement('button'); btn.className='btn sz-startclock'; btn.textContent='Start the Clock!';
    btn.addEventListener('click', ()=>{ startClockCurrent(); renderClockButtons(); renderSzDesc(); });
    el.appendChild(btn); return;
  }
  if (selState.idx!=null && sess.events[selState.idx]){
    el.classList.add('has-info'); el.textContent = evDescription(sess.events[selState.idx]); return;
  }
  const team=sess.teams[state.currentSide];
  el.classList.add('matchup');
  el.textContent = (team.selectedPitcher||'')+' vs '+(team.selectedHitter||'');
}

/* ----- active matchup selects ----- */
function renderActiveSelects(){
  if (!activePitcherSel || !activeHitterSel) return;
  const sess=getCurrentSession();
  if (!sess){ activePitcherSel.innerHTML=''; activeHitterSel.innerHTML=''; return; }
  const team=sess.teams[state.currentSide];
  activePitcherSel.innerHTML = team.pitchers.map(p=>'<option value="'+escapeHtml(p)+'"'+(team.selectedPitcher===p?' selected':'')+'>'+escapeHtml(p)+'</option>').join('');
  activeHitterSel.innerHTML = team.hitters.map(h=>'<option value="'+escapeHtml(h)+'"'+(team.selectedHitter===h?' selected':'')+'>'+escapeHtml(h)+'</option>').join('');
}
if (activePitcherSel) activePitcherSel.addEventListener('change', ()=>{ const sess=getCurrentSession(); if(!sess) return; sess.teams[state.currentSide].selectedPitcher=activePitcherSel.value; saveAll(); renderPlayerLists(); });
if (activeHitterSel) activeHitterSel.addEventListener('change', ()=>{ const sess=getCurrentSession(); if(!sess) return; sess.teams[state.currentSide].selectedHitter=activeHitterSel.value; saveAll(); renderPlayerLists(); });

/* ----- strike zone render ----- */
function renderStrikeZone(){
  if (!szArea) return;
  szArea.querySelectorAll('.sz-circle').forEach(c=>c.remove());
  const sess=getCurrentSession();
  const group = sess ? displayGroup(sess) : {pitches:[]};
  const shown = group.pitches.filter(p=> p.ev.pitch_x!=null && p.ev.pitch_y!=null);
  // Focus pitch: a single selected pitch, else the last pitch in the group.
  let focusIdx = null;
  if (selState.idx!=null && !selState.whole) focusIdx = selState.idx;
  else if (shown.length) focusIdx = shown[shown.length-1].idx;
  shown.forEach((p,i)=>{ const e=p.ev; const c=document.createElement('div');
    const isSel = (selState.idx===p.idx);
    c.className='sz-circle '+circleClass(e)+(i===shown.length-1?' latest':'')+(isSel?' sel':'');
    c.style.left=e.pitch_x+'%'; c.style.top=e.pitch_y+'%';
    c.dataset.idx=p.idx;
    const info=pitchInfoStr(e); c.dataset.info=info; c.setAttribute('aria-label',info);
    c.addEventListener('mouseenter', (me)=> showSzTip(info, me));
    c.addEventListener('mousemove', moveSzTip);
    c.addEventListener('mouseleave', hideSzTip);
    const num=document.createElement('span'); num.className='sz-num'; num.textContent=String(i+1); c.appendChild(num);
    szArea.appendChild(c);
  });
  // Count balls/strikes up to the focus pitch. InPlay counts as a strike in the
  // CSV but must NOT bump the displayed strike count (an at-bat ends on contact).
  let balls=0, strikes=0;
  for (const p of shown){ const e=p.ev;
    if (e.ball_strike==='Ball') balls++;
    else if (e.ball_strike==='Strike' && e.swing!=='InPlay'){ if(!(e.swing==='Foul' && strikes>=2)) strikes++; }
    if (p.idx===focusIdx) break;
  }
  if (szCount) szCount.textContent='Balls: '+balls+' \u00b7 Strikes: '+strikes;
}

/* ----- instant strike-zone hover tooltip ----- */
let _szTip=null;
function szTipEl(){ if(!_szTip){ _szTip=document.createElement('div'); _szTip.className='sz-tip'; _szTip.style.display='none'; document.body.appendChild(_szTip); } return _szTip; }
function showSzTip(text, e){ const t=szTipEl(); t.textContent=text; t.style.display='block'; moveSzTip(e); }
function moveSzTip(e){ const t=_szTip; if(!t||t.style.display==='none') return; let x=e.clientX+12, y=e.clientY+12; const w=t.offsetWidth, h=t.offsetHeight; if(x+w>window.innerWidth-6) x=e.clientX-w-12; if(y+h>window.innerHeight-6) y=e.clientY-h-12; t.style.left=x+'px'; t.style.top=y+'px'; }
function hideSzTip(){ if(_szTip) _szTip.style.display='none'; }

/* ----- pitch classification pickers ----- */
function veloOptions(sel){ let o=''; for(let v=VELO_MIN;v<=VELO_MAX;v++){ o+='<option value="'+v+'"'+(String(v)===String(sel)?' selected':'')+'>'+v+'</option>'; } return o; }
// Remembers the most recently entered pitch group / velo so the modal
// re-opens pre-filled with the last pitch (e.g. FB 87).
let lastPitchGroup = 'FB', lastVelo = 85;
async function pitchGroupVeloModal(ev){
  let chosen = ev.pitch_group || lastPitchGroup || 'FB';
  const curV = ev.velo || lastVelo || 85;
  let noVelo = (ev.velo==='' || ev.velo==null) && !!ev.pitch_group;
  // Working copy of the pitch location; "Change Pitch Zone" edits these.
  let px = (ev.pitch_x!=null?ev.pitch_x:50), py = (ev.pitch_y!=null?ev.pitch_y:47), inzone = !!ev.inzone;
  // Strike-zone box as % of the sz-area (matches .sz-zone: 130x164 inside 500x460, centered 50%/47%).
  const ZW=130/500*100, ZH=164/460*100, ZCX=50, ZCY=47;
  function calcInzone(x,y){ return x>=ZCX-ZW/2 && x<=ZCX+ZW/2 && y>=ZCY-ZH/2 && y<=ZCY+ZH/2; }
  const header = '<div class="modal-head">'
    + '<h4 class="modal-head-title">Velo &amp; Pitch Group</h4>'
    + '<button type="button" class="btn small ghost chg-zone" id="chg-zone-btn">Change Pitch Zone</button>'
    + '</div>';
  const miniZone = '<div class="mini-sz-wrap" id="mini-sz-wrap" style="display:none">'
    + '<div class="mini-sz-hint">Tap the new pitch location</div>'
    + '<div class="mini-sz-area" id="mini-sz-area"><div class="mini-sz-zone"></div><div class="mini-sz-dot" id="mini-sz-dot"></div></div>'
    + '</div>';
  const html = header
    + '<div class="velo-row"><label>Velo (mph)</label><select id="velo-sel">'+veloOptions(curV)+'</select></div>'
    + '<label class="no-velo"><input type="checkbox" id="no-velo"'+(noVelo?' checked':'')+'/> No Velo Registered <span class="hk">N</span></label>'
    + '<div class="sect-lbl">Pitch Group</div>'
    + '<div class="grp-btns">'
    + PITCH_GROUPS.map(g=>'<button type="button" class="pk grp-pick hollow'+(g===chosen?' selected':'')+'" data-pg="'+g+'">'+PITCH_GROUP_LABEL[g]+' <span class="hk">'+(g==='FB'?'F':g==='BB'?'B':'O')+'</span></button>').join('')
    + '</div>'
    + miniZone;
  const p = showModal({ html, buttons:[{label:'Next',value:'next',className:'btn',id:'pgv-next'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  const grpBtns = Array.from(modalRoot.querySelectorAll('[data-pg]'));
  function paintGrp(){ grpBtns.forEach(b=> b.classList.toggle('selected', b.getAttribute('data-pg')===chosen)); }
  grpBtns.forEach(b=> b.addEventListener('click', ()=>{ chosen=b.getAttribute('data-pg'); paintGrp(); }));
  const veloSel = $('velo-sel');
  const noVeloBox = $('no-velo');
  function syncVelo(){ const off=noVeloBox.checked; noVelo=off; veloSel.disabled=off; const vr=veloSel.closest('.velo-row'); if(vr) vr.classList.toggle('velo-disabled', off); }
  noVeloBox.addEventListener('change', syncVelo);
  syncVelo();
  let veloBuf='', veloBufTimer=null;
  veloSel.addEventListener('keydown', function(e){
    if(e.key>='0' && e.key<='9'){ e.preventDefault(); if(veloBufTimer) clearTimeout(veloBufTimer); veloBuf += e.key;
      let match=null; for(let v=VELO_MIN; v<=VELO_MAX; v++){ if(String(v)===veloBuf){ match=v; break; } }
      if(match==null){ for(let v=VELO_MIN; v<=VELO_MAX; v++){ if(String(v).indexOf(veloBuf)===0){ match=v; break; } } }
      if(match==null){ veloBuf=e.key; for(let v=VELO_MIN; v<=VELO_MAX; v++){ if(String(v).indexOf(veloBuf)===0){ match=v; break; } } }
      if(match!=null) veloSel.value=String(match);
      veloBufTimer=setTimeout(()=>{ veloBuf=''; }, 1000);
    }
  });
  const chgBtn = $('chg-zone-btn'), mzWrap = $('mini-sz-wrap'), mzArea = $('mini-sz-area'), mzDot = $('mini-sz-dot');
  function placeDot(){ mzDot.style.left=px+'%'; mzDot.style.top=py+'%'; mzDot.classList.toggle('inzone', inzone); }
  placeDot();
  chgBtn.addEventListener('click', ()=>{ const show = mzWrap.style.display==='none'; mzWrap.style.display = show?'block':'none'; chgBtn.classList.toggle('on', show); });
  mzArea.addEventListener('click', (e)=>{ const r=mzArea.getBoundingClientRect(); px=Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)); py=Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100)); inzone=calcInzone(px,py); placeDot(); });
  function pgvOnKey(e){
    const tag=document.activeElement && document.activeElement.tagName;
    if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); const nx=$('pgv-next'); if(nx) nx.click(); return; }
    const k=(e.key||'').toLowerCase();
    if(tag==='SELECT' && k>='0' && k<='9') return;
    if(k==='n'){ e.preventDefault(); noVeloBox.checked=!noVeloBox.checked; syncVelo(); }
    else if(k==='f'){ e.preventDefault(); chosen='FB'; paintGrp(); }
    else if(k==='b'){ e.preventDefault(); chosen='BB'; paintGrp(); }
    else if(k==='o'){ e.preventDefault(); chosen='OS'; paintGrp(); }
  }
  modalRoot.addEventListener('keydown', pgvOnKey);
  paintGrp();
  if (!noVeloBox.checked){ setTimeout(()=>{ try{ veloSel.focus(); }catch(e){} }, 0); }
  const res = await p;
  modalRoot.removeEventListener('keydown', pgvOnKey);
  if (res!=='next') return null;
  if (!chosen) chosen='FB';
  const velo = noVeloBox.checked ? '' : parseInt(veloSel.value,10);
  lastPitchGroup = chosen;
  if (velo !== '' && !isNaN(velo)) lastVelo = velo;
  ev.pitch_x=px; ev.pitch_y=py; ev.inzone=inzone;
  return { group:chosen, velo:velo, inzone:inzone };
}
async function pitchInfoModal(ev, geomInzone){
  const inzone = (geomInzone!=null?geomInzone:ev.inzone);
  const extraCur = (ev.location==='NonComp'||ev.location==='IntBall') ? ev.location : '';
  let swingSel = (ev.swing==='InPlay'||ev.swing==='Whiff'||ev.swing==='Take'||ev.swing==='Foul') ? ev.swing : '';
  let outcome=null;
  const html = '<div class="sect-lbl">Extra Info</div>'
    + '<div class="loc-checks">'
    + LOC_OPTS.map(o=>'<label><input type="checkbox" name="locx" value="'+o[0]+'"'+(o[0]===extraCur?' checked':'')+'/> '+o[1]+'</label>').join('')
    + '</div>'
    + '<div class="sect-lbl">Swing Outcome</div>'
    + '<div class="swing-row">'
    +   '<button type="button" class="pk swing-pick hollow" data-sw="InPlay">InPlay <span class="hk">i</span></button>'
    +   '<button type="button" class="pk swing-pick hollow" data-sw="Whiff">Whiff <span class="hk">w</span></button>'
    +   '<button type="button" class="pk swing-pick hollow" data-sw="Take">Take <span class="hk">t</span></button>'
    +   '<button type="button" class="pk swing-pick hollow" data-sw="Foul">Foul <span class="hk">f</span></button>'
    + '</div>'
    + '<div class="field-sect" id="field-sect" style="display:none">'
    +   '<div class="muted-note" style="margin:6px 0">Tap where the ball was hit. Behind the plate defaults to C; beyond the fence is a Home Run.</div>'
    +   '<div class="field-wrap">'+buildFieldSvg()+'</div>'
    + '</div>'
    + '<div class="sect-lbl">Result</div>'
    + '<div class="result-row">'
    +   '<div class="result-top">'
    +     '<button type="button" class="pk res-pick hollow" data-res="Strike">Strike</button>'
    +     '<button type="button" class="pk res-pick hollow" data-res="Ball">Ball</button>'
    +   '</div>'
    +   '<div class="result-bot">'
    +     '<button type="button" class="pk res-pick hollow submit-btn" data-res="K">K</button>'
    +     '<button type="button" class="pk res-pick hollow submit-btn" data-res="BB">BB</button>'
    +     '<button type="button" class="pk res-pick hollow submit-btn" data-res="HBP">HBP</button>'
    +     '<button type="button" class="pk res-pick hollow submit-btn" data-res="iBB">iBB</button>'
    +   '</div>'
    + '</div>'
    + '<button type="button" data-resolve="done" id="pi-done" style="display:none"></button>';
  const p = showModal({ title:'Pitch Info', html, showBack:true, buttons:[{label:'Cancel',value:'cancel',className:'btn ghost',fullWidth:true}] });
  const doneBtn = $('pi-done');
  function finish(o){ outcome=o; doneBtn.click(); }
  function locVal(){ const picked=modalRoot.querySelector('input[name=locx]:checked'); return picked?picked.value:(inzone?'InZone':'OutOfZone'); }
  const swBtns = Array.from(modalRoot.querySelectorAll('[data-sw]'));
  const resBtns = Array.from(modalRoot.querySelectorAll('[data-res]'));
  const fieldSect = modalRoot.querySelector('#field-sect');
  const locxBtns = Array.from(modalRoot.querySelectorAll('input[name=locx]'));
  locxBtns.forEach(b=> b.addEventListener('change', ()=>{ if(b.checked){ locxBtns.forEach(o=>{ if(o!==b) o.checked=false; }); } }));
  function resDisabled(name){
    if(swingSel==='InPlay') return true;
    if(swingSel==='Whiff') return !(name==='Strike'||name==='K');
    if(swingSel==='Foul') return name!=='Strike';
    return false;
  }
  function paintRes(){ resBtns.forEach(b=>{ const dis=resDisabled(b.getAttribute('data-res')); b.disabled=dis; b.classList.toggle('res-off', dis); }); }
  function paintSwing(){ swBtns.forEach(b=> b.classList.toggle('selected', b.getAttribute('data-sw')===swingSel)); fieldSect.style.display=(swingSel==='InPlay')?'block':'none'; paintRes(); }
  swBtns.forEach(b=> b.addEventListener('click', ()=>{ swingSel=b.getAttribute('data-sw'); paintSwing(); }));
  resBtns.forEach(b=> b.addEventListener('click', ()=>{
    if(b.disabled) return;
    const r=b.getAttribute('data-res');
    const sw = swingSel || 'Take';
    let bs, result=[];
    if(r==='Strike'){ bs='Strike'; }
    else if(r==='Ball'){ bs='Ball'; }
    else if(r==='K'){ bs='Strike'; result=['K']; }
    else { bs='Ball'; result=[r]; }
    finish({ location:locVal(), swing:sw, ball_strike:bs, result:result, pa_outcome:'', contact_quality:'', batted_ball:'', batted_to:'' });
  }));
  // InPlay field: tap landing location -> gated batted-ball popup.
  const wrap=modalRoot.querySelector('.field-wrap');
  const svgEl=modalRoot.querySelector('.field-svg');
  const SVGNS='http://www.w3.org/2000/svg';
  let markerEl=null, bbOpen=false;
  function placeMarker(sx,sy){ if(markerEl) markerEl.remove(); markerEl=document.createElementNS(SVGNS,'g'); markerEl.setAttribute('class','fld-marker'); markerEl.setAttribute('pointer-events','none'); const r1=document.createElementNS(SVGNS,'circle'); r1.setAttribute('cx',sx); r1.setAttribute('cy',sy); r1.setAttribute('r','9'); r1.setAttribute('class','fld-marker-ring'); const r2=document.createElementNS(SVGNS,'circle'); r2.setAttribute('cx',sx); r2.setAttribute('cy',sy); r2.setAttribute('r','3.4'); r2.setAttribute('class','fld-marker-dot'); markerEl.appendChild(r1); markerEl.appendChild(r2); svgEl.appendChild(markerEl); }
  function clearMarker(){ if(markerEl){ markerEl.remove(); markerEl=null; } }
  function nearestPos(sx,sy){ let best=null,bd=1e12; Object.keys(POS_CENTERS).forEach(k=>{ const c=POS_CENTERS[k]; const d=(c.x-sx)*(c.x-sx)+(c.y-sy)*(c.y-sy); if(d<bd){ bd=d; best=k; } }); return best; }
  async function onFieldClick(clientX, clientY){
    if(bbOpen) return;
    const r=svgEl.getBoundingClientRect();
    const sx=(clientX-r.left)/r.width*FIELD_VB_W;
    const sy=(clientY-r.top)/r.height*FIELD_VB_H;
    placeMarker(sx,sy);
    const dx=sx-FIELD_H.x, up=FIELD_H.y-sy; const rad=Math.hypot(dx,up); const ang=Math.atan2(dx,up)*180/Math.PI;
    let pos, num, isHR=false;
    if(up<=0){ pos='C'; num='2'; }
    else if(rad>FIELD_FENCE && Math.abs(ang)<=47){ isHR=true; pos='HR'; num= ang<-15?'7':(ang>15?'9':'8'); }
    else { pos=nearestPos(sx,sy); num=POS_NUM[pos]||''; }
    bbOpen=true;
    const bb = await battedBallPopup(ev, pos, num, isHR, wrap, sx, sy);
    bbOpen=false;
    if(bb===null){ clearMarker(); return; }
    const hx=sx/FIELD_VB_W, hy=sy/FIELD_VB_H;
    finish({ location:locVal(), swing:'InPlay', ball_strike:'Strike', result:[], pa_outcome:bb.pa_outcome, contact_quality:bb.contact_quality, batted_ball:bb.batted_ball, batted_to:bb.batted_to, hit_x:hx, hit_y:hy });
  }
  svgEl.addEventListener('click', (e)=>{ onFieldClick(e.clientX, e.clientY); });
  function piOnKey(e){
    if(bbOpen) return;
    const tag=document.activeElement && document.activeElement.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
    const k=(e.key||'').toLowerCase();
    if(k==='i'){ e.preventDefault(); swingSel='InPlay'; paintSwing(); }
    else if(k==='w'){ e.preventDefault(); swingSel='Whiff'; paintSwing(); }
    else if(k==='t'){ e.preventDefault(); swingSel='Take'; paintSwing(); }
    else if(k==='f'){ e.preventDefault(); swingSel='Foul'; paintSwing(); }
  }
  modalRoot.addEventListener('keydown', piOnKey);
  if(swingSel) paintSwing(); else paintRes();
  const res = await p;
  modalRoot.removeEventListener('keydown', piOnKey);
  if(res==='__back__') return '__back__';
  if(res==='done' && outcome) return outcome;
  return null;
}
async function confirmCancel(){
  const res = await showModal({ title:'Cancel?', message:'Are you sure you want to cancel?', buttons:[{label:'Yes',value:true,className:'btn warn'},{label:'No',value:false,className:'btn hollow'}] });
  return res===true;
}
const NUM_POS={'1':'P','2':'C','3':'1B','4':'2B','5':'3B','6':'SS','7':'LF','8':'CF','9':'RF'};
const POS_NUM={P:'1',C:'2','1B':'3','2B':'4','3B':'5',SS:'6',LF:'7',CF:'8',RF:'9'};
const FIELD_VB_W=424, FIELD_VB_H=460;
const FIELD_H={x:212,y:418};
const FIELD_FENCE=300;
const fieldPt=(deg,r)=>{const t=deg*Math.PI/180;return{x:FIELD_H.x+r*Math.sin(t),y:FIELD_H.y-r*Math.cos(t)};};
// On-field reference spots for every fielder (used for "closest position" clicks + labels).
const POS_CENTERS={
  P:fieldPt(0,72), C:fieldPt(0,13),
  '1B':fieldPt(33.75,112), '2B':fieldPt(11.25,112), '3B':fieldPt(-33.75,112), SS:fieldPt(-11.25,112),
  LF:fieldPt(-30,232), CF:fieldPt(0,238), RF:fieldPt(30,232)
};
function buildFieldSvg(){
  const pt=fieldPt; const f=n=>n.toFixed(1);
  function sector(d1,d2,rIn,rOut){
    const steps=Math.max(2,Math.ceil(Math.abs(d2-d1)/3));
    const out=[],inn=[];
    for(let i=0;i<=steps;i++){ out.push(pt(d1+(d2-d1)*i/steps,rOut)); }
    for(let i=steps;i>=0;i--){ inn.push(pt(d1+(d2-d1)*i/steps,rIn)); }
    return 'M'+out.concat(inn).map(p=>f(p.x)+','+f(p.y)).join(' L')+' Z';
  }
  const IF_IN=24, IF_OUT=160, OF_IN=160, OF_OUT=FIELD_FENCE, ARC=158, BR1=104, BR2=147;
  const OVER=[
    {pos:'LF',d1:-45,d2:-15,rIn:OF_IN,rOut:OF_OUT},
    {pos:'CF',d1:-15,d2:15,rIn:OF_IN,rOut:OF_OUT},
    {pos:'RF',d1:15,d2:45,rIn:OF_IN,rOut:OF_OUT},
    {pos:'3B',d1:-45,d2:-22.5,rIn:IF_IN,rOut:IF_OUT},
    {pos:'SS',d1:-22.5,d2:0,rIn:IF_IN,rOut:IF_OUT},
    {pos:'2B',d1:0,d2:22.5,rIn:IF_IN,rOut:IF_OUT},
    {pos:'1B',d1:22.5,d2:45,rIn:IF_IN,rOut:IF_OUT}
  ];
  const arc=(d1,d2,r)=>{const st=Math.max(2,Math.ceil(Math.abs(d2-d1)/3));let a=[];for(let i=0;i<=st;i++)a.push(pt(d1+(d2-d1)*i/st,r));return 'M'+a.map(p=>f(p.x)+','+f(p.y)).join(' L');};
  let svg='<svg viewBox="0 0 '+FIELD_VB_W+' '+FIELD_VB_H+'" class="field-svg" preserveAspectRatio="none">';
  svg+='<defs>'
    +'<linearGradient id="grassG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#53a96c"/><stop offset="100%" stop-color="#2f8049"/></linearGradient>'
    +'<linearGradient id="dirtG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d8ab74"/><stop offset="100%" stop-color="#bd8a53"/></linearGradient>'
    +'<linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0f1a2b"/><stop offset="100%" stop-color="#17263c"/></linearGradient>'
    +'</defs>';
  svg+='<rect x="0" y="0" width="'+FIELD_VB_W+'" height="'+FIELD_VB_H+'" fill="url(#skyG)" pointer-events="none"/>';
  svg+='<path d="'+sector(-45,45,0,OF_OUT)+'" fill="url(#grassG)" pointer-events="none"/>';
  for(let k=0;k<6;k++){ if(k%2===0){ const a1=-45+k*15; svg+='<path d="'+sector(a1,a1+15,0,OF_OUT)+'" fill="rgba(255,255,255,0.035)" pointer-events="none"/>'; } }
  svg+='<path d="'+sector(-45,45,OF_OUT-9,OF_OUT)+'" fill="rgba(168,120,72,0.5)" pointer-events="none"/>';
  svg+='<path d="'+sector(-45,45,0,ARC)+'" fill="url(#dirtG)" pointer-events="none"/>';
  const g_h=pt(0,30), g1=pt(45,88), g2=pt(0,128), g3=pt(-45,88);
  svg+='<polygon points="'+f(g_h.x)+','+f(g_h.y)+' '+f(g1.x)+','+f(g1.y)+' '+f(g2.x)+','+f(g2.y)+' '+f(g3.x)+','+f(g3.y)+'" fill="url(#grassG)" pointer-events="none"/>';
  svg+='<path d="'+arc(-45,45,ARC)+'" class="fld-grassline" fill="none" pointer-events="none"/>';
  const lfp=pt(-45,OF_OUT), rfp=pt(45,OF_OUT);
  svg+='<line x1="'+f(FIELD_H.x)+'" y1="'+f(FIELD_H.y)+'" x2="'+f(lfp.x)+'" y2="'+f(lfp.y)+'" class="fld-foul" pointer-events="none"/>';
  svg+='<line x1="'+f(FIELD_H.x)+'" y1="'+f(FIELD_H.y)+'" x2="'+f(rfp.x)+'" y2="'+f(rfp.y)+'" class="fld-foul" pointer-events="none"/>';
  let fence=[]; for(let d=-45;d<=45;d+=2) fence.push(pt(d,OF_OUT));
  svg+='<polyline points="'+fence.map(p=>f(p.x)+','+f(p.y)).join(' ')+'" class="fld-fence" pointer-events="none"/>';
  const b1=pt(45,BR1),b2=pt(0,BR2),b3=pt(-45,BR1);
  svg+='<polygon points="'+f(FIELD_H.x)+','+f(FIELD_H.y)+' '+f(b1.x)+','+f(b1.y)+' '+f(b2.x)+','+f(b2.y)+' '+f(b3.x)+','+f(b3.y)+'" class="fld-diamond" pointer-events="none"/>';
  OVER.forEach(s=>{ svg+='<path class="fld-sect" data-pos="'+s.pos+'" data-num="'+POS_NUM[s.pos]+'" d="'+sector(s.d1,s.d2,s.rIn,s.rOut)+'"/>'; });
  svg+='<path class="fld-sect" data-pos="C" data-num="2" d="'+sector(-45,45,0,IF_IN)+'"/>';
  const mo=POS_CENTERS.P; svg+='<circle class="fld-sect" data-pos="P" data-num="1" cx="'+f(mo.x)+'" cy="'+f(mo.y)+'" r="22"/>';
  const base=(b)=>'<polygon points="'+f(b.x)+','+f(b.y-5)+' '+f(b.x+5)+','+f(b.y)+' '+f(b.x)+','+f(b.y+5)+' '+f(b.x-5)+','+f(b.y)+'" class="fld-base" pointer-events="none"/>';
  svg+=base(b1)+base(b2)+base(b3);
  svg+='<polygon points="'+f(FIELD_H.x)+','+f(FIELD_H.y-6)+' '+f(FIELD_H.x+6)+','+f(FIELD_H.y-1)+' '+f(FIELD_H.x+4)+','+f(FIELD_H.y+6)+' '+f(FIELD_H.x-4)+','+f(FIELD_H.y+6)+' '+f(FIELD_H.x-6)+','+f(FIELD_H.y-1)+'" class="fld-base" pointer-events="none"/>';
  svg+='<circle class="fld-mound" cx="'+f(mo.x)+'" cy="'+f(mo.y)+'" r="14" pointer-events="none"/>';
  svg+='<rect class="fld-rubber" x="'+f(mo.x-4)+'" y="'+f(mo.y-1.3)+'" width="8" height="2.6" rx="0.6" pointer-events="none"/>';
  Object.keys(POS_CENTERS).forEach(k=>{ const c=POS_CENTERS[k]; svg+='<text x="'+f(c.x)+'" y="'+f(c.y+(k==='P'?3:0))+'" class="fld-lbl'+(k==='P'?' fld-lbl-sm':'')+'" pointer-events="none">'+k+'</text>'; });
  svg+='<text x="'+(FIELD_VB_W/2)+'" y="22" class="fld-hr-lbl" pointer-events="none">Beyond the fence = Home Run</text>';
  svg+='</svg>';
  return svg;
}
async function battedBallPopup(ev, pos, num, isHR, wrap, sx, sy){
  return new Promise(resolve=>{
    const BB_DEFS=[['GB','G'],['LD','L'],['FB','F'],['PU','P']];
    const CQ_DEFS=[['Bunt','B'],['Weak','W'],['Avg','A'],['Hard','H']];
    const PA_DEFS=[['1B','1B','1'],['2B','2B','2'],['3B','3B','3'],['HR','HR','4'],['OUT','OUT','O'],['FC','FC','F'],['E','E','E'],['DP','DP','D'],['SAC','SACB','B'],['SACF','SACF','S']];
    let pickBB='', pickCQ='', pickBTo=num||'', pickPA=isHR?'HR':'';
    const title=isHR?'Home Run':'Hit to '+pos;
    const btoOpts=['1','2','3','4','5','6','7','8','9'].map(n=>'<button type="button" class="fp-opt bto-opt'+(n===pickBTo?' on':'')+'" data-v="'+n+'">'+n+' <small>'+NUM_POS[n]+'</small></button>').join('');
    const PA_LIST=(isHR?[['HR','HR','4']]:PA_DEFS);
    const paOpts=PA_LIST.map(d=>'<button type="button" class="fp-opt pa-opt" data-v="'+d[0]+'">'+d[1]+' <span class="hk">'+d[2]+'</span></button>').join('');
    const popupEl=document.createElement('div'); popupEl.className='field-popup';
    popupEl.innerHTML='<button type="button" class="fp-close" aria-label="Close">\u00d7</button>'
      +'<div class="fp-title">'+title+'</div>'
      +'<div class="fp-row" id="bb-row"><span>Batted Ball Type</span><div class="fp-pick fp-bb">'+BB_DEFS.map(d=>'<button type="button" class="fp-opt" data-v="'+d[0]+'">'+d[0]+' <span class="hk">'+d[1]+'</span></button>').join('')+'</div></div>'
      +'<div class="fp-row" id="cq-row" style="display:none"><span>Contact Quality</span><div class="fp-pick fp-cq">'+CQ_DEFS.map(d=>'<button type="button" class="fp-opt" data-v="'+d[0]+'">'+d[0]+' <span class="hk">'+d[1]+'</span></button>').join('')+'</div></div>'
      +'<div class="fp-row" id="bto-row" style="display:none"><span>Batted To</span><div class="fp-pick fp-bto">'+btoOpts+'</div></div>'
      +'<div class="fp-row" id="pa-row" style="display:none"><span>PA Outcome</span><div class="fp-pick fp-pa">'+paOpts+'</div></div>';
    wrap.appendChild(popupEl);
    const wr=wrap.getBoundingClientRect();
    const px0=sx/FIELD_VB_W*wr.width, py0=sy/FIELD_VB_H*wr.height;
    const pw=popupEl.offsetWidth, ph=popupEl.offsetHeight;
    let left=px0+14; if(left+pw>wr.width) left=px0-pw-14; if(left<4) left=4;
    let top=py0+14; if(top+ph>wr.height) top=wr.height-ph-4; if(top<4) top=4;
    popupEl.style.left=left+'px'; popupEl.style.top=top+'px';
    const cqRow=popupEl.querySelector('#cq-row'), btoRow=popupEl.querySelector('#bto-row'), paRow=popupEl.querySelector('#pa-row');
    const bbWrap=popupEl.querySelector('.fp-bb'), cqWrap=popupEl.querySelector('.fp-cq'), btoWrap=popupEl.querySelector('.fp-bto'), paWrap=popupEl.querySelector('.fp-pa');
    function paint(w,val){ w.querySelectorAll('.fp-opt').forEach(o=> o.classList.toggle('on', o.getAttribute('data-v')===val)); }
    function cleanup(){ document.removeEventListener('keydown',onKey,true); popupEl.remove(); }
    function done(){ cleanup(); resolve({ pa_outcome:pickPA, contact_quality:pickCQ, batted_ball:pickBB, batted_to:pickBTo, homerun:isHR }); }
    function cancel(){ cleanup(); resolve(null); }
    function pickBBType(v){ pickBB=v; paint(bbWrap,pickBB); if(pickBB==='PU'){ pickCQ='Weak'; paint(cqWrap,pickCQ); } cqRow.style.display='block'; }
    function pickCQType(v){ pickCQ=v; paint(cqWrap,pickCQ); btoRow.style.display='block'; paint(btoWrap,pickBTo); }
    function pickBToVal(v){ pickBTo=v; paint(btoWrap,pickBTo); paRow.style.display='block'; }
    bbWrap.querySelectorAll('.fp-opt').forEach(b=> b.addEventListener('click',()=> pickBBType(b.getAttribute('data-v'))));
    cqWrap.querySelectorAll('.fp-opt').forEach(b=> b.addEventListener('click',()=> pickCQType(b.getAttribute('data-v'))));
    btoWrap.querySelectorAll('.fp-opt').forEach(b=> b.addEventListener('click',()=> pickBToVal(b.getAttribute('data-v'))));
    paWrap.querySelectorAll('.fp-opt').forEach(b=> b.addEventListener('click',()=>{ pickPA=b.getAttribute('data-v'); done(); }));
    popupEl.querySelector('.fp-close').addEventListener('click', cancel);
    function onKey(e){
      const k=(e.key||''); const lo=k.toLowerCase();
      if(k==='Escape'){ e.stopImmediatePropagation(); e.preventDefault(); cancel(); return; }
      if(paRow.style.display!=='none'){ const d=PA_LIST.find(x=>x[2].toLowerCase()===lo); if(d){ e.preventDefault(); e.stopImmediatePropagation(); pickPA=d[0]; done(); return; } }
      if(btoRow.style.display!=='none' && k>='1' && k<='9'){ e.preventDefault(); e.stopImmediatePropagation(); pickBToVal(k); return; }
      if(cqRow.style.display!=='none'){ const d=CQ_DEFS.find(x=>x[1].toLowerCase()===lo); if(d){ e.preventDefault(); e.stopImmediatePropagation(); pickCQType(d[0]); return; } }
      { const d=BB_DEFS.find(x=>x[1].toLowerCase()===lo); if(d){ e.preventDefault(); e.stopImmediatePropagation(); pickBBType(d[0]); return; } }
    }
    document.addEventListener('keydown', onKey, true);
  });
}
async function classifyPitch(ev, geomInzone){
  let step=0;
  while(true){
    if(step===0){
      const pg = await pitchGroupVeloModal(ev);
      if(pg===null){ if(await confirmCancel()) return false; else continue; }
      ev.pitch_group=pg.group; ev.velo=pg.velo;
      if(pg.inzone!=null) ev.inzone=pg.inzone;
      step=1;
    } else {
      const info = await pitchInfoModal(ev, ev.inzone);
      if(info==='__back__'){ step=0; continue; }
      if(info===null){ if(await confirmCancel()) return false; else continue; }
      ev.location=info.location; ev.swing=info.swing; ev.ball_strike=info.ball_strike||'';
      ev.result=info.result||[];
      ev.pa_outcome=info.pa_outcome||''; ev.contact_quality=info.contact_quality||''; ev.batted_ball=info.batted_ball||''; ev.batted_to=info.batted_to||'';
      if('hit_x' in info){ ev.hit_x=info.hit_x; ev.hit_y=info.hit_y; }
      else { ev.hit_x=null; ev.hit_y=null; }
      ev.play=evPlayLabel(ev);
      return true;
    }
  }
}

/* ----- strike zone click -> log + classify ----- */
async function strikeZoneClick(e){
  const sess=getCurrentSession();
  if (!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  if (!(await ensureClockRunningOrAsk(sess))) return;
  ensureSessionCounters(sess);
  const arect = szArea.getBoundingClientRect();
  const px = Math.max(0, Math.min(100, ((e.clientX - arect.left)/arect.width)*100));
  const py = Math.max(0, Math.min(100, ((e.clientY - arect.top)/arect.height)*100));
  const zrect = szZone.getBoundingClientRect();
  const r = 10;
  const nx = Math.max(zrect.left, Math.min(e.clientX, zrect.right));
  const ny = Math.max(zrect.top, Math.min(e.clientY, zrect.bottom));
  const inzone = Math.hypot(e.clientX-nx, e.clientY-ny) <= r;
  const team=sess.teams[state.currentSide];
  const ev={ id:allocEventId(sess), timecode_ms:Math.round(computeSessionElapsedMs(sess)),
    player:team.selectedHitter||'', player_id:playerIdFor(sess,team.selectedHitter),
    pitcher:team.selectedPitcher||'', pitcher_id:playerIdFor(sess,team.selectedPitcher),
    pitch_x:px, pitch_y:py, inzone:inzone,
    pitch_group:'', velo:'', location:(inzone?'InZone':'OutOfZone'), swing:'', pa_outcome:'', contact_quality:'', batted_ball:'', batted_to:'',
    result:[], ball_strike:'', bad_data:'NO', notes:{}, contact:'', play:'' };
  sess.events.push(ev); saveAll(); renderLog(); renderStrikeZone(); updatePitcherCountBadges();
  const ok = await classifyPitch(ev, inzone);
  if(!ok){
    const i = sess.events.indexOf(ev);
    if(i>=0) sess.events.splice(i,1);
    selState.idx=null; selState.whole=false;
    saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges();
    return;
  }
  ev.contact = evContact(ev) ? (ev.contact||1) : '';
  ev.play = evPlayLabel(ev);
  // Default selection: select the just-logged pitch unless it resolved a play.
  if (evIsPlay(ev)){ selState.idx=null; selState.whole=false; }
  else { selState.idx=sess.events.indexOf(ev); selState.whole=false; }
  saveAll(); renderLog(); renderStrikeZone(); renderSzDesc(); updatePitcherCountBadges();
  showToast('Pitch #'+ev.id+' '+(inzone?'(In Zone)':'(Out of Zone)')+' - '+msToToastTime(ev.timecode_ms));
}
/* The WHOLE Strike Zone card is a click target (not just the inner zone box).
   Tap (short press) anywhere - including on an existing circle - scores a NEW
   pitch at that spot. To SELECT an existing circle (open its options), press
   and hold on it for 1.5s. */
const szCardEl = document.querySelector('.sz-card');
if (szCardEl){
  let holdTimer=null, holdFired=false, holdCircleIdx=null, downX=0, downY=0;
  function cancelHold(){ if (holdTimer){ clearTimeout(holdTimer); holdTimer=null; } }
  szCardEl.addEventListener('pointerdown', (e)=>{
    if (e.target.closest('button,input,select,a,textarea,label')) return;
    holdFired=false; holdCircleIdx=null; downX=e.clientX; downY=e.clientY;
    const circle=e.target.closest('.sz-circle');
    if (circle){
      const idx=parseInt(circle.dataset.idx,10);
      if (!isNaN(idx)){
        holdCircleIdx=idx;
        cancelHold();
        holdTimer=setTimeout(()=>{ holdTimer=null; holdFired=true; openOptionsModal(idx); }, 500);
      }
    }
  });
  szCardEl.addEventListener('pointermove', (e)=>{ if (holdTimer && Math.hypot(e.clientX-downX, e.clientY-downY) > 12) cancelHold(); });
  szCardEl.addEventListener('pointerup', (e)=>{
    if (e.target.closest('button,input,select,a,textarea,label')) return;
    cancelHold();
    if (holdFired){ holdFired=false; return; }   // hold already opened the selection
    strikeZoneClick(e);                          // short tap -> score a new pitch at this spot
  });
  szCardEl.addEventListener('pointercancel', cancelHold);
  szCardEl.addEventListener('pointerleave', cancelHold);
}

/* ===== Active Matchup quick-add (same behavior as the Players lineup add) ===== */
const amAddPitcherInput = $('am-add-pitcher');
const amAddPitcherBtn = $('am-add-pitcher-btn');
const amAddHitterInput = $('am-add-hitter');
const amAddHitterBtn = $('am-add-hitter-btn');
if (amAddPitcherBtn) amAddPitcherBtn.addEventListener('click', ()=>{ addPlayer('pitcher', amAddPitcherInput.value); amAddPitcherInput.value=''; });if (amAddHitterBtn) amAddHitterBtn.addEventListener('click', ()=>{ addPlayer('hitter', amAddHitterInput.value); amAddHitterInput.value=''; });
const editPlayersBtn = $('edit-players-btn');
if (editPlayersBtn) editPlayersBtn.addEventListener('click', ()=> editPlayersModal());
const syncIdsBtn = $('sync-ids-btn');
if (syncIdsBtn) syncIdsBtn.addEventListener('click', ()=> syncIds());
function hotkeysHelpModal(){
  const row=(k,d)=>'<div class="hkh-row"><span class="hkh-key">'+k+'</span><span class="hkh-desc">'+d+'</span></div>';
  const sect=(t,rows)=>'<div class="hkh-sect"><div class="hkh-title">'+t+'</div>'+rows+'</div>';
  const html=
    sect('Strike Zone', row('Tap','Score a new pitch at that spot')+row('Press-hold 0.5s','Select / edit the pitch under the cursor'))
    +sect('Velo &amp; Pitch Group (step 1)', row('N','No Velo Registered')+row('F','Fastball')+row('B','Breaking Ball')+row('O','OffSpeed')+row('Enter','Next'))
    +sect('Pitch Info (step 2)', row('i','InPlay')+row('w','Whiff')+row('t','Take')+row('f','Foul'))
    +sect('Batted Ball Type', row('G','Groundball')+row('L','Linedrive')+row('F','Flyball')+row('P','Popup'))
    +sect('Contact Quality', row('B','Bunt')+row('W','Weak')+row('A','Avg')+row('H','Hard'))
    +sect('Batted To', row('1-9','Fielder position the ball was hit to'))
    +sect('PA Outcome', row('1','1B')+row('2','2B')+row('3','3B')+row('4','HR')+row('O','OUT')+row('F','FC')+row('E','E')+row('D','DP')+row('B','SACB')+row('S','SACF'));
  showModal({ title:'Hotkeys', html:'<div class="hkh-wrap">'+html+'</div>', buttons:[{label:'Close',value:'close',className:'btn'}] });
}
const hotkeysHelpBtn = $('hotkeys-help-btn');
if (hotkeysHelpBtn) hotkeysHelpBtn.addEventListener('click', ()=> hotkeysHelpModal());
if (amAddPitcherInput){
  amAddPitcherInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ amAddPitcherBtn.click(); e.preventDefault(); }});
  amAddPitcherInput.addEventListener('blur', ()=> amAddPitcherInput.value=titleCaseName(amAddPitcherInput.value));
  attachPlayerSearch(amAddPitcherInput, (name,id)=> addDbPlayer('pitcher', name, id));
}
if (amAddHitterInput){
  amAddHitterInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ amAddHitterBtn.click(); e.preventDefault(); }});
  amAddHitterInput.addEventListener('blur', ()=> amAddHitterInput.value=titleCaseName(amAddHitterInput.value));
  attachPlayerSearch(amAddHitterInput, (name,id)=> addDbPlayer('hitter', name, id));
}

function init(){
  loadAll();
  if (!state.sessions || state.sessions.length===0){ const s=buildDefaultSession('Event 1', new Date().toISOString().slice(0,10)); state.sessions=[s]; state.currentSessionId=s.id; saveAll(); }
  if (!state.currentSessionId) state.currentSessionId=state.sessions[0].id;
  state.sessions.forEach(s=>{ ensureSessionClock(s); ensureSessionCounters(s); ensureWorkout(s); });
  state.compactNames = window.innerWidth < 420;
  window.addEventListener('resize', ()=>{ const compact=window.innerWidth<420; if (compact!==state.compactNames){ state.compactNames=compact; renderPlayerLists(); renderDefenseLists(); renderBPList(); }});
  initAllFloating();
  renderAll();
  setInterval(()=>{ const s=getCurrentSession(); if (s && s.clock && s.clock.running) updateClockDisplay(); }, 100);
  setInterval(()=> saveAll(), 1500);
  window.addEventListener('beforeunload', ()=> saveAll());
  window.addEventListener('keydown', (e)=>{ if (e.code==='Space'){ const tag=document.activeElement && document.activeElement.tagName; if (tag!=='INPUT' && tag!=='TEXTAREA' && tag!=='SELECT') e.preventDefault(); }});
}
init();