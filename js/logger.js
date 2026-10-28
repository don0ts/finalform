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
        const list = snap.docs.map(d => { const data=d.data(); return { id:playerDocId(data, d.id), docId:d.id, name:playerDocName(data, d.id) }; });
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
function searchPlayers(term){
  const t = String(term||'').trim().toLowerCase();
  return loadPlayerCache().then(list => {
    if (!t) return list.slice(0, 12); // list is already alphabetical
    const scored = [];
    for (const p of list){
      let r = matchRank(p.name, t);
      // also match by player_id so typing an ID finds the player
      // also match by player_id (and the raw Firestore doc id, in case a
      // merged/edited player's doc id differs from its player_id field) so
      // typing an ID finds the player either way
      const idCandidates = [p.id, p.docId].filter(v=> v!=null && v!=='').map(v=> String(v).toLowerCase());
      for (const idStr of idCandidates){
        let ir = -1;
        if (idStr === t) ir = 0;            // exact id
        else if (idStr.startsWith(t)) ir = 1; // id prefix
        else if (idStr.indexOf(t) >= 0) ir = 3; // id contains
        if (ir >= 0) r = (r < 0) ? ir : Math.min(r, ir);
      }
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
  // the id that was explicitly linked to this player (via the search picker,
  // an "name #id" add, Edit Players, or the "Sync IDs" button). Use Sync IDs
  // to pull/refresh ids from the live Players collection on demand.
  const stored = sess.playerIds[name];
  return (stored!=null && stored!=='') ? String(stored) : '';
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

/* Parse a manually typed Add-field value that may bundle a jersey/player ID with
   the name. Accepted formats (id token = digits, optional leading #):
     "John Smith #23"  "John Smith 23"  "23 John Smith"  "#23 John Smith"
     "John Smith"       "23"  "#23"
   Returns { name, id } with the name title-cased. When only an id is given we
   try to resolve the name from the live player cache. */
function parseNameAndId(raw){
  let s = String(raw||'').trim();
  if (!s) return { name:'', id:'' };
  let id = '', m;
  if ((m = s.match(/^#?(\d+)\s+(.+)$/))){ id = m[1]; s = m[2].trim(); }
  else if ((m = s.match(/^(.+?)\s+#?(\d+)$/))){ s = m[1].trim(); id = m[2]; }
  else if ((m = s.match(/^#?(\d+)$/))){ id = m[1]; s = ''; }
  let name = titleCaseName(s);
  if (!name && id){
    const hit = _playerCache.find(p => String(p.id) === String(id) || String(p.docId) === String(id));
    name = hit ? hit.name : id; // fall back to the raw id if the DB has no match
  }
  return { name, id };
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
    buttons.forEach(b => { const btn = document.createElement('button'); btn.textContent = b.label; btn.className = b.className || 'btn'; if (opts.gridCols && b.fullWidth) btn.style.gridColumn='1 / -1'; btn.addEventListener('click', ()=>{ modalRoot.style.display = 'none'; resolve(b.value); }); row.appendChild(btn); });
    modal.appendChild(row);
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
function pickerModal(title, options){
  const buttons = options.map(o => ({ label:o, value:o, className:'btn' }));
  buttons.push({ label:'Cancel', value:'__cancel__', className:'btn ghost', fullWidth:true });
  // lay the options out in rows of 5 (e.g. 10 -> 5+5, 9 -> 5+4); Cancel gets its own full-width row
  return showModal({ title, html:'<div class="muted-note" style="margin-bottom:2px">Choose one</div>', buttons, gridCols:5 }).then(res => (res==='__cancel__'||res==null) ? null : res);
}

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
let floatState = { left:null, top:null, size:96 };

/* DOM refs */
const sessionSelect = $('session-select');
const createSessionBtn = $('create-session-btn');
const clearLogBtn = $('clear-log-btn');
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

const addPitcherInput = $('add-pitcher');
const addPitcherBtn = $('add-pitcher-btn');
const pitchersList = $('pitchers-list');
const addHitterInput = $('add-hitter');
const addHitterBtn = $('add-hitter-btn');
const hittersList = $('hitters-list');

const logList = $('log-list');
const floatBtn = $('float-log-btn');
const floatContactBtn = $('float-contact-btn');
const floatPlayBtn = $('float-play-btn');
const floatWorkoutBtn = $('float-workout-btn');
const floatStartBtn = $('float-start-btn');

const chkPitchLog = $('chk-pitch-log');
const chkContactLog = $('chk-contact-log');
const chkPlayLog = $('chk-play-log');

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
function updatePitcherCountBadges(){
  const sess = getCurrentSession(); if (!sess) return;
  const team = sess.teams[state.currentSide];
  team.pitchers.forEach((p, idx) => {
    const badge = pitchersList.querySelector('.player-row:nth-child('+(idx+1)+') .pitcher-count');
    if (badge){ const newText = '('+countPitcherEvents(sess,p)+')'; if (badge.textContent !== newText){ badge.textContent=newText; badge.classList.remove('badge-pop'); void badge.offsetWidth; badge.classList.add('badge-pop'); } }
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
    left.appendChild(role); left.appendChild(name); left.appendChild(badge);

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
}

/* ===== GAME log ===== */
function renderLog(){
  const sess = getCurrentSession();
  logList.innerHTML = '';
  if (!sess) return;
  ensureSessionCounters(sess);
  sess.events.slice().reverse().forEach((ev, revIdx) => {
    const idx = sess.events.length - 1 - revIdx;
    const item = document.createElement('div'); item.className = 'log-item';
    const left = document.createElement('div'); left.className = 'log-left';
    const main = document.createElement('div'); main.textContent = '#'+(idx+1)+' \u2014 '+msToLabel(ev.timecode_ms); main.style.fontWeight='700';
    const meta = document.createElement('div'); meta.className='log-meta';
    let metaText = (ev.player||'')+' vs '+(ev.pitcher||'')+'  \u00b7  '+(ev.bad_data||'NO');
    if (ev.contact) metaText += '  \u00b7  C:'+ev.contact;
    if (ev.play) metaText += '  \u00b7  P:'+ev.play;
    meta.textContent = metaText;
    left.appendChild(main); left.appendChild(meta);
    const actions = document.createElement('div');
    const opts = document.createElement('button'); opts.className='btn small'; opts.textContent='Options';
    opts.addEventListener('click', ()=> openOptionsModal(idx));
    actions.appendChild(opts);
    item.appendChild(left); item.appendChild(actions); logList.appendChild(item);
  });
}

/* ===== GAME options modal ===== */
async function openOptionsModal(index){
  const sess = getCurrentSession(); if (!sess) return;
  const ev = sess.events[index];
  const allHitters = Array.from(new Set(sess.teams.top.hitters.concat(sess.teams.bot.hitters)));
  const allPitchers = Array.from(new Set(sess.teams.top.pitchers.concat(sess.teams.bot.pitchers)));
  const html = '<div style="display:flex;flex-direction:column;gap:8px">'
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
  const res = await showModal({ title:'Options', html, buttons:[{label:'Save',value:'save',className:'btn'},{label:'Delete',value:'delete',className:'btn warn'},{label:'Cancel',value:'cancel',className:'btn ghost'}] });
  if (res==='cancel' || !res) return;
  if (res==='delete'){ const c = await showModal({ title:'Delete entry?', message:'Delete this log entry?', buttons:[{label:'Delete',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if (!c) return; sess.events.splice(index,1); saveAll(); renderLog(); updatePitcherCountBadges(); return; }
  if (res==='save'){ const hh=$('modal-hitter').value, pp=$('modal-pitcher').value, late=$('modal-late').checked, early=$('modal-early').checked; ev.player=hh; ev.pitcher=pp; ev.notes={late,early}; ev.bad_data = late ? 'YES_LATE' : early ? 'YES_EARLY' : 'YES_FIX'; saveAll(); renderLog(); updatePitcherCountBadges(); return; }
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
  // Prefer the live cache (snapshot listener) when it has loaded. Match either
  // the player_id field or the raw Firestore doc id, so an ID belonging to a
  // player that was merged/edited (doc id ≠ player_id field) is still detected.
  if(Array.isArray(_playerCache) && _playerCache.length && _playerCache.some(pl=> String(pl.id)===String(id) || String(pl.docId)===String(id))) return true;
  try{ const doc=await _db.collection(COLLECTION).doc(String(id)).get(); return !!(doc && doc.exists); }
  catch(e){ return false; }
}
async function editPlayersModal(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'Edit Players', message:'Start or select a session first.', buttons:[{label:'OK',value:true}]}); return; }
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
    // Detect the existing DB record even if it was merged/edited: match the
    // stored id against either the player_id field or the Firestore doc id,
    // then fall back to a name match. Use the real doc id to load the profile.
    let hit=null;
    if(id){ hit=_playerCache.find(pl=> String(pl.id)===String(id) || String(pl.docId)===String(id)); }
    if(!hit){ hit=_playerCache.find(pl=>pl.name && pl.name.toLowerCase()===name.toLowerCase()); }
    if(hit){ id=hit.id; }
    const docId=hit ? (hit.docId||hit.id) : id;
    idEl.value=id||''; posEl.value=''; clsEl.value=''; batEl.value=''; thrEl.value=''; dobEl.value='';
    if(id && _db){ st.textContent='Loading profile\u2026';
      try{ const doc=await _db.collection(COLLECTION).doc(String(docId)).get();
        if(doc && doc.exists){ const d=doc.data()||{};
          posEl.value=d.position||d.pos||''; clsEl.value=d.class||d.year||d.grade||'';
          batEl.value=(d.bats||d.bat||'').toString().charAt(0).toUpperCase(); thrEl.value=(d.throws||d.throw||'').toString().charAt(0).toUpperCase();
          dobEl.value=d.dob||d.birthdate||d.birth_date||''; st.textContent='Loaded from database.';
        } else { st.textContent='No database profile yet — fill and save to create.'; }
      }catch(e){ st.textContent='Could not load profile (offline?).'; }
    } else { st.textContent = _db? 'No ID yet — add one and save to create a profile.' : 'Database offline — lineup update only.'; }
  }
  playerSel.addEventListener('change', ()=>fillForm(playerSel.value));
  fillForm(lineup.length?lineup[0]:'__new__');
  if(lineup.length) playerSel.value=lineup[0];
  const res=await p;
  if(res!=='save') return;
  const oldKey=playerSel.value;
  const newName=$('ep-name').value.trim();
  const id=$('ep-id').value.trim();
  if(!newName){ await showModal({title:'Edit Players', message:'Please enter a player name.', buttons:[{label:'OK',value:true}]}); return; }
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
  await showModal({ title:'Edit Players', message:msg, buttons:[{label:'OK',value:true}] });
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
  const _defSeq = {}; const _defNum = new Map();
  d.events.forEach(ev=>{ _defNum.set(ev, (_defSeq[ev.position] = (_defSeq[ev.position]||0) + 1)); });
  d.events.slice().reverse().forEach((ev)=>{
    const idx = d.events.indexOf(ev);
    const item = document.createElement('div'); item.className='log-item';
    const left = document.createElement('div'); left.className='log-left';
    const main = document.createElement('div'); main.style.fontWeight='700'; main.textContent='#'+_defNum.get(ev)+' \u2014 '+msToLabel(ev.timecode_ms);
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
    const main = document.createElement('div'); main.style.fontWeight='700'; main.textContent='#'+(idx+1)+' \u2014 '+msToLabel(ev.timecode_ms);
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
    const main=document.createElement('div'); main.style.fontWeight='700'; main.textContent='#'+(idx+1)+' \u2014 '+msToLabel(ev.timecode_ms);
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
  const rows=sess.workout.dash.events.map((e,i)=>[i+1,e.timecode_ms,e.player,(playerIdFor(sess,e.player)||e.player_id),(e.bad_data||'NO')].map(csvEscape).join(','));
  return header+'\n'+rows.join('\n')+(rows.length?'\n':'');
}
function exportDash(){
  const sess=getCurrentSession(); if(!sess) return;
  const en=sanitizeEventName(sess.name);
  exportStopAndStore(s=>buildDashCsv(s), en+'_60YD_Dash', '60YD Dash CSV', s=>{ s.workout.dash.events=[]; });
}
function addDashPlayer(raw){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const dh=sess.workout.dash; if(!String(raw||'').trim()) return; const {name, id}=parseNameAndId(raw); if(!name) return;
  if(!dh.players.includes(name)) dh.players.push(name); dh.selectedPlayer=name; if (id) assignPlayerId(name, id); saveAll(); renderDashList();
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
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,PITCHER,PITCHER_ID,PLAY,BAD_DATA';
  const rows = sess.events.map((e, i) => [i+1, e.timecode_ms, e.player, (playerIdFor(sess,e.player)||e.player_id), e.pitcher, (playerIdFor(sess,e.pitcher)||e.pitcher_id), (e.play||''), (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildPlaysCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,PITCHER,PITCHER_ID,PLAY,BAD_DATA';
  const rows = sess.events.filter(e => e.play).map((e, i) => [i+1, e.timecode_ms, e.player, (playerIdFor(sess,e.player)||e.player_id), e.pitcher, (playerIdFor(sess,e.pitcher)||e.pitcher_id), (e.play||''), (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildDefenseCsv(sess, group){
  const pos = DEF_POS[group];
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,POSITION,BAD_DATA';
  const rows = sess.workout.defense.events.filter(e => e.position===pos).map((e, i) => [i+1, e.timecode_ms, e.player, (playerIdFor(sess,e.player)||e.player_id), e.position, (e.bad_data||'NO')].map(csvEscape).join(','));
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildAllDefenseCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,POSITION,BAD_DATA';
  const posSeq = {};
  const rows = sess.workout.defense.events.map(e => { const n = (posSeq[e.position] = (posSeq[e.position]||0) + 1); return [n, e.timecode_ms, e.player, (playerIdFor(sess,e.player)||e.player_id), e.position, (e.bad_data||'NO')].map(csvEscape).join(','); });
  return header + '\n' + rows.join('\n') + (rows.length?'\n':'');
}
function buildBPCsv(sess){
  const header = 'LOG_ID,TIMECODE_MS,PLAYER,PLAYER_ID,ANGLE,BAD_DATA';
  const rows = sess.workout.bp.events.map((e, i) => [i+1, e.timecode_ms, e.player, (playerIdFor(sess,e.player)||e.player_id), e.angle, (e.bad_data||'NO')].map(csvEscape).join(','));
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
/* plain pause (no confirm) used by export flow */
function pauseClock(){ const sess=getCurrentSession(); if(!sess) return; ensureSessionClock(sess); if (sess.clock.running && sess.clock.startTimestamp) sess.clock.elapsedBefore=computeSessionElapsedMs(sess); sess.clock.running=false; sess.clock.startTimestamp=null; saveAll(); renderClockButtons(); updateClockDisplay(); }
/* plain reset (no confirm) used by export flow */
function resetClock(){ const sess=getCurrentSession(); if(!sess) return; ensureSessionClock(sess); sess.clock.running=false; sess.clock.elapsedBefore=0; sess.clock.startTimestamp=null; saveAll(); renderClockButtons(); updateClockDisplay(); }
/* floating start-clock button */
function floatStartClicked(){ const sess=getCurrentSession(); if(!sess){ showToast('Create/select an event first'); return; } flashElement(floatStartBtn); if (sess.clock && sess.clock.running){ showToast('Clock already running'); return; } startClockCurrent(); showToast('Clock started'); }

/* ===== GAME float logging ===== */
async function floatLogClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  if (!(await ensureClockRunningOrAsk(sess))) return;
  const team=sess.teams[state.currentSide];
  const ev={ id:sess.nextId++, timecode_ms:Math.round(computeSessionElapsedMs(sess)), type:'', mph:'', player:team.selectedHitter||'', player_id:playerIdFor(sess, team.selectedHitter), pitcher:team.selectedPitcher||'', pitcher_id:playerIdFor(sess, team.selectedPitcher), bad_data:'NO', notes:{}, contact:'', play:'' };
  sess.events.push(ev); saveAll(); renderLog(); updatePitcherCountBadges();
  flashElement(floatBtn); showToast('Logged #'+sess.events.length+' - '+msToToastTime(ev.timecode_ms));
}
async function floatContactClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  if (!(await ensureClockRunningOrAsk(sess))) return;
  ensureSessionCounters(sess);
  const team=sess.teams[state.currentSide];
  const ev={ id:sess.nextId++, timecode_ms:Math.round(computeSessionElapsedMs(sess)), type:'', mph:'', player:team.selectedHitter||'', player_id:playerIdFor(sess, team.selectedHitter), pitcher:team.selectedPitcher||'', pitcher_id:playerIdFor(sess, team.selectedPitcher), bad_data:'NO', notes:{}, contact:sess.nextContactId++, play:'' };
  sess.events.push(ev); saveAll(); renderLog(); updatePitcherCountBadges();
  flashElement(floatContactBtn); showToast('Contact #'+ev.contact+' - '+msToToastTime(ev.timecode_ms), 'contact');
}
async function floatPlayClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  if (!(await ensureClockRunningOrAsk(sess))) return;
  ensureSessionCounters(sess);
  const team=sess.teams[state.currentSide];
  // Send the log immediately, capturing the timecode at the moment Play is clicked.
  const ev={ id:sess.nextId++, timecode_ms:Math.round(computeSessionElapsedMs(sess)), type:'', mph:'', player:team.selectedHitter||'', player_id:playerIdFor(sess, team.selectedHitter), pitcher:team.selectedPitcher||'', pitcher_id:playerIdFor(sess, team.selectedPitcher), bad_data:'NO', notes:{}, contact:'', play:'' };
  sess.events.push(ev); saveAll(); renderLog(); updatePitcherCountBadges();
  flashElement(floatPlayBtn); showToast('Play logged #'+sess.events.length+' - '+msToToastTime(ev.timecode_ms), 'play');
  // Then show the pickers and fill this same log with what was picked.
  // Step 1: result
  const result = await pickerModal('Play result', ['1B','2B','3B','HR','OUT','E','BB','HBP','KS','KL']);
  if (result===null) return;
  // Results that don't need a fielder position or contact type.
  const NO_DETAIL = ['BB','HBP','KS','KL'];
  let playStr;
  if (NO_DETAIL.includes(result)){
    playStr = result;
  } else {
    // Step 2: fielder number
    const num = await pickerModal('Fielder', ['1','2','3','4','5','6','7','8','9']);
    if (num===null) return;
    // Step 3: contact
    const contactLabel = await pickerModal('Contact', ['Soft','Medium','Hard']);
    if (contactLabel===null) return;
    playStr = result+'_'+num+'_'+contactLabel.toUpperCase();
  }
  ev.play = playStr; saveAll(); renderLog(); updatePitcherCountBadges();
  showToast('Play '+playStr+' - '+msToToastTime(ev.timecode_ms), 'play');
}

/* ===== WORKOUT float logging ===== */
async function floatWorkoutClicked(){
  const sess=getCurrentSession(); if(!sess){ await showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]}); return; }
  ensureWorkout(sess);
  if (!(await ensureClockRunningOrAsk(sess))) return;
  if (state.workoutSection==='dash'){
    const dh=sess.workout.dash;
    if (!dh.selectedPlayer){ showToast('Select a runner first'); return; }
    const ev={ id:dh.nextId++, timecode_ms:Math.round(computeSessionElapsedMs(sess)), player:dh.selectedPlayer, player_id:playerIdFor(sess, dh.selectedPlayer), bad_data:'NO' };
    dh.events.push(ev); saveAll(); renderDashLog();
    flashElement(floatWorkoutBtn); showToast('Logged #'+dh.events.length+' 60YD - '+msToToastTime(ev.timecode_ms), 'store-toast');
  } else if (state.workoutSection==='defense'){
    const d=sess.workout.defense;
    if (!d.selectedPlayer){ showToast('Select a player first'); return; }
    const pos = DEF_POS[d.selectedGroup] || 'OF';
    const ev={ id:d.nextId++, timecode_ms:Math.round(computeSessionElapsedMs(sess)), player:d.selectedPlayer, player_id:playerIdFor(sess, d.selectedPlayer), position:pos, bad_data:'NO' };
    d.events.push(ev); saveAll(); renderDefenseLog();
    flashElement(floatWorkoutBtn); showToast('Logged #'+d.events.filter(e=>e.position===pos).length+' '+pos+' - '+msToToastTime(ev.timecode_ms), 'store-toast');
  } else {
    const b=sess.workout.bp;
    if (!b.selectedPlayer){ showToast('Select a player first'); return; }
    const ev={ id:b.nextId++, timecode_ms:Math.round(computeSessionElapsedMs(sess)), player:b.selectedPlayer, player_id:playerIdFor(sess, b.selectedPlayer), angle:(b.angle||'S'), bad_data:'NO' };
    b.events.push(ev); saveAll(); renderBPLog();
    flashElement(floatWorkoutBtn); showToast('Logged #'+b.events.length+' '+ev.angle+' - '+msToToastTime(ev.timecode_ms), 'store-toast');
  }
}

/* ===== add players ===== */
function addPlayer(type, raw){
  const sess=getCurrentSession(); if(!sess) return showModal({title:'No session',message:'Create/select an event first.',buttons:[{label:'OK',value:true}]});
  const team=sess.teams[state.currentSide]; if(!String(raw||'').trim()) return; const {name, id}=parseNameAndId(raw); if(!name) return;
  if (type==='pitcher'){ if(!team.pitchers.includes(name)) team.pitchers.push(name); team.selectedPitcher=name; }
  else { if(!team.hitters.includes(name)) team.hitters.push(name); team.selectedHitter=name; }
  if (id) assignPlayerId(name, id);
  saveAll(); renderPlayerLists(); updatePitcherCountBadges();
}
function addDefensePlayer(group, raw){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const d=sess.workout.defense; if(!String(raw||'').trim()) return; const {name, id}=parseNameAndId(raw); if(!name) return;
  if (!d[group].includes(name)) d[group].push(name); d.selectedGroup=group; d.selectedPlayer=name;
  if (id) assignPlayerId(name, id);
  saveAll(); renderDefenseLists();
}
function addBPPlayer(raw){
  const sess=getCurrentSession(); if(!sess) return; ensureWorkout(sess);
  const b=sess.workout.bp; if(!String(raw||'').trim()) return; const {name, id}=parseNameAndId(raw); if(!name) return;
  if (!b.players.includes(name)) b.players.push(name); b.selectedPlayer=name;
  if (id) assignPlayerId(name, id);
  saveAll(); renderBPList();
}

/* ===== clear log (game only) ===== */
async function clearLog(){ const sess=getCurrentSession(); if(!sess) return; const ok=await showModal({title:'Clear Log',message:'Clear all Game entries for this event?',buttons:[{label:'Clear',value:true,className:'btn warn'},{label:'Cancel',value:false,className:'btn ghost'}]}); if(!ok) return; sess.events=[]; sess.nextId=1; sess.nextContactId=1; sess.nextPlayId=1; saveAll(); renderLog(); updatePitcherCountBadges(); }

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
  const isGame = state.activeTab==='game';
  floatBtn.style.display = (isGame && chkPitchLog.checked) ? 'flex' : 'none';
  floatContactBtn.style.display = (isGame && chkContactLog.checked) ? 'flex' : 'none';
  floatPlayBtn.style.display = (isGame && chkPlayLog.checked) ? 'flex' : 'none';
  floatWorkoutBtn.style.display = isGame ? 'none' : 'flex';
  floatStartBtn.style.display = 'flex';
}

/* ===== tab + section switching ===== */
function setActiveTab(tab){
  state.activeTab = tab; saveAll();
  tabGame.classList.toggle('active', tab==='game');
  tabWorkout.classList.toggle('active', tab==='workout');
  gameTab.style.display = tab==='game' ? '' : 'none';
  workoutTab.style.display = tab==='workout' ? '' : 'none';
  clockHint.textContent = tab==='game' ? 'Game: Top/Bot lineups, pitchers then hitters.' : 'Workout: Defense (OF/IF/C) and Batting Practice. EXPORT stores a CSV below.';
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
  floatWorkoutBtn.textContent = 'Log';
  const c = sec==='dash' ? 'var(--dash-orange)' : sec==='defense' ? 'var(--of-green)' : 'var(--bp-teal)';
  floatWorkoutBtn.style.background = c;
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
    else if (stateKey==='play') floatPlayClicked();
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
  initDraggableFloat(floatBtn, 'pitch', 18, 18);
  initDraggableFloat(floatContactBtn, 'contact', 130, 18);
  initDraggableFloat(floatPlayBtn, 'play', 242, 18);
  initDraggableFloat(floatWorkoutBtn, 'workout', 18, 18);
  initDraggableFloat(floatStartBtn, 'start', Math.max(18, window.innerWidth-76), 18);
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
sessionSelect.addEventListener('change', (e)=>{ state.currentSessionId=e.target.value; saveAll(); renderAll(); });
createSessionBtn.addEventListener('click', async ()=>{
  const html='<div style="display:flex;flex-direction:column;gap:8px"><input id="sess-name" placeholder="Event name" /><input id="sess-date" type="date" value="'+new Date().toISOString().slice(0,10)+'" /></div>';
  const res=await showModal({ title:'Create Event', html, buttons:[{label:'Create',value:'create',className:'btn'},{label:'Cancel',value:'cancel',className:'btn ghost'}]});
  if (res!=='create') return;
  const nm=$('sess-name').value.trim(), dt=$('sess-date').value.trim();
  if (!nm||!dt) return showModal({title:'Missing',message:'Please provide name and date.',buttons:[{label:'OK',value:true}]});
  const s=buildDefaultSession(nm, dt); state.sessions.push(s); state.currentSessionId=s.id; saveAll(); renderAll();
});
clearLogBtn.addEventListener('click', clearLog);
const editPlayersBtn = $('edit-players-btn');
if (editPlayersBtn) editPlayersBtn.addEventListener('click', editPlayersModal);
const syncIdsBtn = $('sync-ids-btn');
if (syncIdsBtn) syncIdsBtn.addEventListener('click', syncIds);
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
startBtn.addEventListener('click', ()=>{ startClockCurrent(); renderClockButtons(); });
pauseBtn.addEventListener('click', ()=>{ pauseClockCurrent().then(()=> renderClockButtons()); });
resetBtn.addEventListener('click', ()=>{ resetClockCurrent().then(()=> renderClockButtons()); });
chkPitchLog.addEventListener('change', ()=>{ updateFloatingButtonVisibility(); saveAll(); });
chkContactLog.addEventListener('change', ()=>{ updateFloatingButtonVisibility(); saveAll(); });
chkPlayLog.addEventListener('change', ()=>{ updateFloatingButtonVisibility(); saveAll(); });

/* ===== render all + init ===== */
function renderAll(){
  const sess=getCurrentSession(); if (sess) ensureWorkout(sess);
  renderSessionSelect(); renderPlayerLists(); renderLog();
  renderDefenseLists(); renderBPList(); renderDashList(); renderDefenseLog(); renderBPLog(); renderDashLog(); renderCsvStorage();
  updateClockDisplay(); renderClockButtons();
  if (sideTop && sideBot){ sideTop.classList.toggle('active', state.currentSide==='top'); sideBot.classList.toggle('active', state.currentSide==='bot'); }
  if (sess){ const a=sess.workout.bp.angle||'S'; angleSide.checked=(a==='S'); angleBehind.checked=(a==='BH'); }
  setActiveTab(state.activeTab||'game');
  setWorkoutSection(state.workoutSection||'dash');
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
