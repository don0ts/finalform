/* =============================================================================
   Stats site — live read of charting events from Firestore.
   Subscribes to the "ChartingSessions" collection (written by the charting
   recorder) and exposes the sessions on window so loadState() in
   charting-stats.js can use them. Falls back to local storage until the first
   snapshot arrives, and if Firestore is unavailable / blocked by rules.
   ============================================================================= */
(function(){
  var firebaseConfig = {
    apiKey: "AIzaSyDzxseQexlbv0onZH2l5PHNDa5ZKFv5Kz8",
    authDomain: "cubsentry.web.app",
    projectId: "cubsentry",
    storageBucket: "cubsentry.firebasestorage.app",
    messagingSenderId: "929110932897",
    appId: "1:929110932897:web:1d91596a2787084a085fe0"
  };
  var CHARTING_COLLECTION = 'ChartingSessions';

  window._dbSessions = [];
  window._dbReady = false;

  var db = null;
  try {
    if (window.firebase && firebase.initializeApp) {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
    }
  } catch (err) { console.error('Firebase init failed (stats)', err); }

  // Re-render whichever stats tab is currently visible once new data arrives.
  function refreshStats(){
    var active = document.querySelector('.stab-panel.active');
    var id = active ? active.id : '';
    try {
      if (id === 'stab-hbox' && typeof renderHitterBox === 'function') renderHitterBox();
      else if (id === 'stab-pbox' && typeof renderPitcherBox === 'function') renderPitcherBox();
      else if (id === 'stab-stats' && typeof render === 'function') render();
      else if (id === 'stab-pstats' && typeof renderPitcherStats === 'function') renderPitcherStats();
      else if (id === 'stab-spray' && typeof renderSpray === 'function') renderSpray();
      else if (id === 'stab-pviz' && typeof renderPitcherViz === 'function') renderPitcherViz();
    } catch (e) { console.warn('refreshStats error', e); }
  }
  window.refreshStats = refreshStats;

  if (db) {
    try {
      db.collection(CHARTING_COLLECTION).onSnapshot(function(snap){
        var arr = [];
        snap.forEach(function(doc){
          var d = doc.data() || {};
          if (!d.id) d.id = doc.id;
          if (!Array.isArray(d.events)) d.events = [];
          arr.push(d);
        });
        arr.sort(function(a, b){ return String(b.date || '').localeCompare(String(a.date || '')); });
        window._dbSessions = arr;
        window._dbReady = true;
        refreshStats();
      }, function(err){
        console.warn('ChartingSessions snapshot failed; using local storage', err);
      });
    } catch (e) { console.warn('ChartingSessions subscribe error', e); }
  }
})();
