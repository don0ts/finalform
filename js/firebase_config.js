/* =============================================================================
   One place for the Firebase project settings + the client SDK versions.
   Every page loads this BEFORE it starts Firebase, so the keys never have to be
   pasted in twice and a bad/blank key can never leave a page stuck on
   "Connecting…" without an explanation.
   ============================================================================= */
(function(){
  window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyDzxseQexlbv0onZH2l5PHNDa5ZKFv5Kz8",
    authDomain: "cubsentry.web.app",
    projectId: "cubsentry",
    storageBucket: "cubsentry.firebasestorage.app",
    messagingSenderId: "929110932897",
    appId: "1:929110932897:web:1d91596a2787084a085fe0"
  };
  // Same versions everywhere (the modular SDK is used by Home / Status, the
  // compat build by Logger / Charting / Stats).
  window.FIREBASE_SDK_MODULAR = "10.12.2";
  window.FIREBASE_SDK_COMPAT  = "10.12.2";

  // Called with ('ok'|'bad', message) so a page can show a real reason instead
  // of spinning forever on "Connecting…".
  window.fbConnState = function(kind, message){
    var el = document.getElementById('connState');
    if(el){ el.textContent = message; el.setAttribute('data-state', kind === 'ok' ? 'connected' : 'offline'); }
    var sub = document.getElementById('connSub');
    if(sub){ sub.textContent = message; sub.style.color = kind === 'ok' ? '#22c55e' : '#f87171'; }
  };
})();
