/* Radio Latina · Portal web (Fase 2: diseño elaborado + datos reales en vivo)
 * Reproductor con 2123 emisoras (stations.json) + chat Firebase (mismo modelo que la app).
 * Regla de Jeremy: en salas privadas, SOLO premium puede ENVIAR
 * (doc premium_uids/{uid} en Firestore); los gratis leen y ven el aviso.
 */
(function () {
'use strict';

/* ---------- helpers ---------- */
function el(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];}); }
var toastTimer=null;
function toast(msg){ var t=el('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(function(){t.classList.remove('show');},3200); }
function flagImg(cc, name){ cc=String(cc||'').toLowerCase(); if(!cc) return ''; return '<img class="flag" src="assets/flags/'+cc+'.svg" alt="'+esc(name||cc.toUpperCase())+'" loading="lazy" onerror="this.remove()">'; }
var SVG_LOCK='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
var SVG_CROWN='<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M2.5 7.5 7 10.5 12 4l5 6.5 4.5-3L19.5 19h-15L2.5 7.5z"/></svg>';
var SVG_GLOBE='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
var SVG_MOON='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
var SVG_SUN='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

/* ---------- degradados por género ---------- */
var GENRE_GRADS=[
  [/tropical/, 'linear-gradient(135deg,#F59E0B,#B45309)'],
  [/salsa/, 'linear-gradient(135deg,#FB923C,#B45309)'],
  [/noticia|news/, 'linear-gradient(135deg,#3b82f6,#1e40af)'],
  [/romántica|romantica/, 'linear-gradient(135deg,#F59E0B,#FACC15)'],
  [/pop/, 'linear-gradient(135deg,#22d3ee,#8b5cf6)'],
  [/rock/, 'linear-gradient(135deg,#8b5cf6,#312e81)'],
  [/regional/, 'linear-gradient(135deg,#22c55e,#15803d)'],
  [/variada|general/, 'linear-gradient(135deg,#14b8a6,#0ea5e9)'],
  [/80/, 'linear-gradient(135deg,#e879f9,#7c3aed)'],
  [/urbana|reggaet/, 'linear-gradient(135deg,#FACC15,#92400E)']
];
function genreGrad(g){ g=String(g||'').toLowerCase(); for(var i=0;i<GENRE_GRADS.length;i++){ if(GENRE_GRADS[i][0].test(g)) return GENRE_GRADS[i][1]; } return 'linear-gradient(135deg,#FACC15,#92400E)'; }
function initials(n){ var stop=new Set(['radio','fm','am','stereo','estereo','la','el','de','del','los','las','y','en']); var w=String(n||'?').trim().split(/\s+/).filter(function(p){ return p&&!stop.has(p.toLowerCase()); }); var b=w.length?w:String(n||'?').trim().split(/\s+/).filter(Boolean); return (b.length>=2?(b[0][0]+b[1][0]):b[0].slice(0,2)).toUpperCase(); }

/* ---------- estado ---------- */
var STATIONS=[], FAVS={};
try{ FAVS=JSON.parse(localStorage.getItem('rl_favs')||'{}'); }catch(e){ FAVS={}; }
var current=null, audio=el('audio');
var filters={q:'',country:'',city:'',genre:'',favs:false};
var gridLimit=300, lastFiltered=[];

/* ---------- navegación ---------- */
function go(name){
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var sec=el('sec-'+name); if(sec) sec.classList.add('active');
  document.querySelectorAll('[data-nav]').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-nav')===name); });
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='chat') initChat();
}
document.querySelectorAll('[data-nav]').forEach(function(b){ b.addEventListener('click',function(){ go(b.getAttribute('data-nav')); }); });

/* ---------- tarjetas ---------- */
/* Normalización de rutas de logo: el coordinador corregirá stations.json
 * (reporte-emisoras pendiente); mientras tanto el portal no muestra rotos. */
var LOGO_FIX={'assets/marca-d3.png':'assets/logos/d3-apoyo-512.png','logos/el-sol.png':''};
function fixedLogo(s){ var l=s.logo||''; return LOGO_FIX.hasOwnProperty(l)?LOGO_FIX[l]:l; }
function logoHTML(s){
  var grad=genreGrad(s.genre);
  var logo=fixedLogo(s);
  if(logo){ return '<div class="station-art" style="background:'+grad+'"><img src="'+esc(logo)+'" alt="" loading="lazy" onerror="this.remove()"></div>'; }
  return '<div class="station-art" style="background:'+grad+'"></div>';
}
/* Frecuencia en el nombre («96.1 FM», «1230 AM»): se muestra aparte y se
   quita del nombre visible para que las tarjetas no repitan el dato; si al
   quitarla el nombre quedaría de menos de 4 letras («La 91.1 FM»), se deja
   el nombre completo y no se muestra la frecuencia aparte. */
function stationFreq(name){
  var m=String(name||'').match(/(\d{2,3}(?:[.,]\d)?)\s*(FM|AM)\b/i);
  if(!m) return '';
  return m[1].replace(',','.')+' '+m[2].toUpperCase();
}
function stationDisplayName(s){
  var f=stationFreq(s.name), n=String(s.name||'');
  if(!f) return n;
  var sin=n.replace(/(\d{2,3}(?:[.,]\d)?)\s*(FM|AM)\b/i,'').replace(/\s{2,}/g,' ').replace(/\s*[-\u2013\u2014]\s*$/,'').trim();
  return sin.length>=4?sin:n;
}
function cardHTML(s){
  var fav=FAVS[s.name]?' on':'';
  var playing=current&&current.name===s.name?'<span class="station-playing">🔊 Sonando</span>':'';
  var freq=stationFreq(s.name), disp=stationDisplayName(s);
  var freqTag=(freq&&disp!==s.name)?'<span class="station-freq">'+esc(freq)+'</span>':'';
  return '<button class="station-card" data-st="'+esc(s.name)+'">'+
    '<span class="fav-btn'+fav+'" data-fav="'+esc(s.name)+'" title="Favorita">♥</span>'+
    '<span class="share-btn" data-share="'+esc(s.name)+'" title="Compartir" role="button" tabindex="0">↗</span>'+
    playing+logoHTML(s)+
    '<span class="station-play"><span class="pp">▶</span></span>'+
    '<span class="genre-tag">'+esc(s.genre||'Radio')+'</span>'+
    '<span class="station-info"><b>'+esc(disp)+'</b>'+freqTag+'<span>'+esc(s.city||s.country||'')+'</span><span class="live-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E676" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="13" r="1.6" fill="#00E676" stroke="none"/><path d="M12 15v6"/><path d="M8.2 9.2a5.4 5.4 0 0 1 7.6 0"/><path d="M5.8 6.8a8.8 8.8 0 0 1 12.4 0"/></svg></span></span>'+
  '</button>';
}
function findStation(name){ for(var i=0;i<STATIONS.length;i++) if(STATIONS[i].name===name) return STATIONS[i]; return null; }

function renderGridList(){
  var list=lastFiltered, grid=el('grid');
  grid.innerHTML=list.slice(0,gridLimit).map(cardHTML).join('');
  el('gridEmpty').hidden=list.length>0;
  el('radioCount').textContent=list.length+(list.length===1?' emisora':' emisoras')+(list.length>gridLimit?' (mostrando '+gridLimit+' de '+list.length+')':'');
  var more=el('gridMore');
  if(list.length>gridLimit){ more.hidden=false; more.textContent='Ver más ('+gridLimit+' de '+list.length+')'; }
  else { more.hidden=true; }
  bindCards(grid);
}
function applyFilters(){
  var q=filters.q.trim().toLowerCase();
  lastFiltered=STATIONS.filter(function(s){
    if(filters.favs && !FAVS[s.name]) return false;
    if(filters.country && s.country!==filters.country) return false;
    if(filters.city && s.city!==filters.city) return false;
    if(filters.genre && String(s.genre||'').toLowerCase()!==filters.genre) return false;
    if(q){ var hay=(s.name+' '+(s.city||'')+' '+(s.country||'')).toLowerCase(); if(hay.indexOf(q)===-1) return false; }
    return true;
  });
  gridLimit=300;
  renderGridList();
}
el('gridMore').addEventListener('click',function(){ gridLimit+=300; renderGridList(); });
function bindCards(root){
  root.querySelectorAll('[data-fav]').forEach(function(b){
    b.addEventListener('click',function(e){
      e.stopPropagation();
      var n=b.getAttribute('data-fav');
      if(FAVS[n]){ delete FAVS[n]; b.classList.remove('on'); } else { FAVS[n]=1; b.classList.add('on'); toast('♥ Agregada a favoritas'); }
      try{ localStorage.setItem('rl_favs',JSON.stringify(FAVS)); }catch(e2){}
      if(filters.favs) applyFilters();
    });
  });
  root.querySelectorAll('.station-card').forEach(function(c){
    c.addEventListener('click',function(){ var s=findStation(c.getAttribute('data-st')); if(s) playStation(s); });
  });
  root.querySelectorAll('[data-share]').forEach(function(b){
    function go2(){ var s=findStation(b.getAttribute('data-share')); if(s) shareStation(s); }
    b.addEventListener('click',function(e){ e.stopPropagation(); go2(); });
    b.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); e.stopPropagation(); go2(); } });
  });
}
function markPlaying(){
  document.querySelectorAll('.station-card').forEach(function(c){
    var on=current&&c.getAttribute('data-st')===current.name;
    var tag=c.querySelector('.station-playing'); if(tag) tag.remove();
    if(on){ var sp=document.createElement('span'); sp.className='station-playing'; sp.textContent='🔊 Sonando'; c.appendChild(sp); }
  });
}

/* ---------- reproductor ---------- */
var histTimer=null;
function playStation(s){
  current=s;
  el('pbLogo').src=fixedLogo(s);
  el('pbLogo').onerror=function(){ this.style.visibility='hidden'; };
  el('pbLogo').style.visibility=fixedLogo(s)?'visible':'hidden';
  el('pbName').textContent=s.name;
  el('pbSub').textContent=(s.city?s.city+', ':'')+(s.country||'')+' · '+(s.genre||'Radio');
  var ab=el('pbAdsBadge');
  if(ab){ ab.hidden=!(window.RL_hasProgrammaticAds&&window.RL_hasProgrammaticAds(s.stream)); }
  el('playerbar').hidden=false;
  setPlayingUI(true);
  audio.src=s.stream;
  audio.play().catch(function(){ onStreamError(s); });
  markPlaying();
  if(typeof rlGlobeShowTuned==='function') rlGlobeShowTuned(s);
  if(histTimer) clearTimeout(histTimer);
  var me=s;
  histTimer=setTimeout(function(){ if(current===me) histPush(me); },10000);
  renderResume();
  if('mediaSession' in navigator){ try{ navigator.mediaSession.metadata=new MediaMetadata({title:s.name,artist:'Radio Latina',album:(s.city||'')+' '+(s.country||'')}); }catch(e){} }
}
function onStreamError(s){
  setPlayingUI(false);
  toast('⚠️ No se pudo conectar con "'+s.name+'". Prueba con otra emisora.');
}
function setPlayingUI(playing){
  el('pbToggle').textContent=playing?'⏸':'▶';
  el('pbToggle').setAttribute('aria-label',playing?'Pausar':'Reproducir');
  el('pbEq').classList.toggle('paused',!playing);
}
el('pbToggle').addEventListener('click',function(){
  if(!current) return;
  if(audio.paused){ audio.play().catch(function(){ onStreamError(current); }); setPlayingUI(true); }
  else{ audio.pause(); setPlayingUI(false); }
});
el('pbClose').addEventListener('click',function(){ audio.pause(); audio.removeAttribute('src'); current=null; el('playerbar').hidden=true; markPlaying(); if(typeof rlGlobeClearTuned==='function') rlGlobeClearTuned(); });
audio.addEventListener('error',function(){ if(current) onStreamError(current); });
audio.addEventListener('playing',function(){ setPlayingUI(true); });
audio.addEventListener('pause',function(){ setPlayingUI(false); });

/* ================= TEMPORIZADOR DE APAGADO (Premium; gratis 2 usos/día) =================
   Regla del dueño (igual que la app): Premium ilimitado; gratis 2 usos por
   día. El cupo se descuenta solo al iniciar una cuenta real, nunca al
   cancelar. Al tercer uso gratis se abre el modal Premium. */
var SLEEP_KEY='rl_sleep_ends', SLEEP_USES_KEY='rl_timer_uses', rlSleepEndsAt=0, rlSleepTimer=null, rlSleepPoll=null;
function timerUsesToday(){
  try{ var d=JSON.parse(localStorage.getItem(SLEEP_USES_KEY)||'null')||{day:'',n:0}; return d.day===new Date().toDateString()?(d.n||0):0; }catch(e){ return 0; }
}
function bumpTimerUse(){
  try{ localStorage.setItem(SLEEP_USES_KEY, JSON.stringify({day:new Date().toDateString(), n:timerUsesToday()+1})); }catch(e){}
}
function sleepRemaining(){ return rlSleepEndsAt>0?Math.max(0,rlSleepEndsAt-Date.now()):0; }
function setSleep(minutes){
  cancelSleep(false);
  rlSleepEndsAt=Date.now()+minutes*60000;
  try{ localStorage.setItem(SLEEP_KEY,String(rlSleepEndsAt)); }catch(e){}
  rlSleepTimer=setTimeout(fireSleep,minutes*60000);
  ensureSleepPoll(); refreshSleepUI();
  toast('⏱️ La radio se detendrá en '+minutes+' min.');
}
function fireSleep(){
  rlSleepEndsAt=0; rlSleepTimer=null;
  try{ localStorage.removeItem(SLEEP_KEY); }catch(e){}
  audio.pause(); setPlayingUI(false);
  refreshSleepUI();
  toast('⏱️ Temporizador cumplido: la reproducción se detuvo.');
}
function cancelSleep(notify){
  rlSleepEndsAt=0;
  if(rlSleepTimer){ clearTimeout(rlSleepTimer); rlSleepTimer=null; }
  try{ localStorage.removeItem(SLEEP_KEY); }catch(e){}
  refreshSleepUI();
  if(notify) toast('⏱️ Temporizador cancelado.');
}
function refreshSleepUI(){
  var rem=sleepRemaining(), mins=Math.ceil(rem/60000);
  var badge=el('tmBadge');
  badge.hidden=!(rem>0); badge.textContent=rem>0?mins+'′':'';
  el('tmStatus').textContent=rem>0?('Activo: la reproducción se detendrá en '+mins+' min.'):(premiumCache===true?'Premium: temporizador ilimitado.':('Gratis: te quedan '+Math.max(0,2-timerUsesToday())+' de 2 usos del temporizador hoy.'));
  el('tmCancel').hidden=!(rem>0);
}
function ensureSleepPoll(){
  if(rlSleepPoll) return;
  rlSleepPoll=setInterval(function(){
    if(sleepRemaining()>0){ refreshSleepUI(); }
    else { clearInterval(rlSleepPoll); rlSleepPoll=null; refreshSleepUI(); }
  },30000);
}
function initSleepPresets(){
  var box=el('tmPresets');
  if(box.children.length) return;
  [15,30,45,60,90].forEach(function(m){
    var b=document.createElement('button');
    b.className='chip'; b.type='button'; b.setAttribute('data-m',m); b.textContent=m+' min';
    b.addEventListener('click',async function(){
      var prem=false; try{ prem=await rlIsPremiumWeb(); }catch(e){ prem=false; }
      if(!prem&&timerUsesToday()>=2){
        toast('⏱️ Temporizador Premium: el plan gratis lo usa 2 veces al día y ya usaste las 2 de hoy. Con Premium es ilimitado.');
        openPremium(); return;
      }
      if(!prem) bumpTimerUse();
      setSleep(m);
    });
    box.appendChild(b);
  });
}
el('pbTimer').addEventListener('click',function(){ initSleepPresets(); refreshSleepUI(); openModal('timerModal'); });
el('tmClose').addEventListener('click',function(){ closeModal('timerModal'); });
el('tmCancel').addEventListener('click',function(){ cancelSleep(true); });

/* ================= MODO DÍA/NOCHE (+automático) ================= */
var THEME_KEY='rl_theme';
function applyTheme(id){
  try{ localStorage.setItem(THEME_KEY,id); }catch(e){}
  var eff=id;
  if(id==='auto'){ eff=(window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark'; }
  if(eff==='light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  var b=el('themeBtn'); if(b) b.innerHTML=(eff==='light')?SVG_SUN:SVG_MOON;
}
el('themeBtn').addEventListener('click',function(){
  var isLight=document.documentElement.getAttribute('data-theme')==='light';
  applyTheme(isLight?'dark':'light');
});
if(window.matchMedia&&matchMedia('(prefers-color-scheme: light)').addEventListener){
  matchMedia('(prefers-color-scheme: light)').addEventListener('change',function(){
    try{ if(localStorage.getItem(THEME_KEY)==='auto') applyTheme('auto'); }catch(e){}
  });
}

/* ================= COMPARTIR + DEEP LINK ================= */
function rlSlug(nombre,ciudad){
  return (String(nombre||'')+' '+String(ciudad||'')).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function stationURL(s){ return location.origin+location.pathname+'?emisora='+rlSlug(s.name,s.city); }
async function shareStation(s){
  var text='Estoy escuchando '+s.name+' en Radio Latina';
  var url=stationURL(s);
  try{
    if(navigator.share){ await navigator.share({title:text,text:text,url:url}); }
    else if(navigator.clipboard&&navigator.clipboard.writeText){ await navigator.clipboard.writeText(text+' '+url); toast('🔗 Enlace copiado'); }
    else { window.prompt('Copia el enlace:',text+' '+url); }
  }catch(e){ /* el usuario canceló */ }
}
el('pbShare').addEventListener('click',function(){ if(current) shareStation(current); });
function openDeepLink(){
  var slug=null;
  try{ slug=new URLSearchParams(location.search).get('emisora'); }catch(e){}
  if(!slug) return;
  var s=null;
  for(var i=0;i<STATIONS.length;i++){ if(rlSlug(STATIONS[i].name,STATIONS[i].city)===slug){ s=STATIONS[i]; break; } }
  if(!s){ toast('Esa emisora ya no está disponible.'); return; }
  filters.q=s.name; el('q').value=s.name;
  filters.country=''; filters.city=''; filters.genre=''; filters.favs=false;
  el('fGenre').value=''; el('cityRow').hidden=true;
  syncCountryChips(); go('radio'); applyFilters();
  try{ playStation(s); toast('Abriendo '+s.name); }catch(e){}
  setTimeout(function(){ var c=document.querySelector('#grid .station-card'); if(c) c.scrollIntoView({behavior:'smooth',block:'center'}); },350);
}

/* ================= HISTORIAL + SEGUIR ESCUCHANDO ================= */
var HIST_KEY='rl_history', HIST_MAX=20;
function histLoad(){ try{ return JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); }catch(e){ return []; } }
function histSave(h){ try{ localStorage.setItem(HIST_KEY,JSON.stringify(h)); }catch(e){} }
function histPush(s){
  if(!s||!s.name) return;
  var h=histLoad().filter(function(x){ return !(x.name===s.name&&x.city===(s.city||'')); });
  h.unshift({name:s.name,city:s.city||'',logo:fixedLogo(s),stream:s.stream||'',ts:Date.now()});
  histSave(h.slice(0,HIST_MAX));
  renderResume(); renderHistoryRow();
}
function timeAgo(ts){
  var m=Math.floor((Date.now()-ts)/60000);
  if(m<1) return 'ahora mismo';
  if(m<60) return 'hace '+m+' min';
  var h=Math.floor(m/60);
  return h<24?('hace '+h+' h'):('hace '+Math.floor(h/24)+' d');
}
function renderResume(){
  var card=el('resumeCard'); if(!card) return;
  var last=histLoad()[0];
  var show=!!(last&&(!current||last.name!==current.name));
  card.hidden=!show;
  if(show) el('resumeName').textContent=last.name+(last.city?' · '+last.city:'');
}
function renderHistoryRow(){
  var box=el('historyRow'); if(!box) return;
  var h=histLoad().slice(0,10);
  el('historySec').hidden=!h.length;
  box.innerHTML=h.map(function(x){
    var art=x.logo?'<img src="'+esc(x.logo)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<span class="hist-init">'+esc(initials(x.name))+'</span>';
    return '<button class="hist-chip" data-hn="'+esc(x.name)+'">'+art+'<span class="hist-name">'+esc(x.name)+'</span><small>'+esc(timeAgo(x.ts))+'</small></button>';
  }).join('');
  box.querySelectorAll('[data-hn]').forEach(function(b){ b.addEventListener('click',function(){ var s=findStation(b.getAttribute('data-hn')); if(s) playStation(s); }); });
}
el('resumeGo').addEventListener('click',function(){
  var last=histLoad()[0];
  var s=last&&findStation(last.name);
  if(s) playStation(s);
});

/* ================= CANAL OFICIAL DE AVISOS =================
   Mensajes amarillos con ✕ (como la app): se cierran solo por sesión y
   reaparecen al reabrir la página. Nada se guarda como «leído» en
   localStorage; los cerrados en esta sesión viven solo en memoria. */
var AVISOS_URLS=['./avisos.json','https://radiolatinapp.github.io/avisos.json'];
var LS_AVISOS='rl_avisos', avisosCerrados={};
function avisosLS(k,fb){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):fb; }catch(e){ return fb; } }
function avisosSave(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function loadAvisos(){
  var cached=avisosLS(LS_AVISOS,[]);
  (function next(i){
    if(i>=AVISOS_URLS.length){ renderAvisos(cached); updateAvisosBadge(cached); return; }
    fetch(AVISOS_URLS[i],{cache:'no-store'}).then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(j){
      var list=(j&&Array.isArray(j.avisos))?j.avisos:[];
      avisosSave(LS_AVISOS,list); renderAvisos(list); updateAvisosBadge(list);
    }).catch(function(){ next(i+1); });
  })(0);
}
function updateAvisosBadge(list){
  list=list||avisosLS(LS_AVISOS,[]);
  var n=0, i;
  for(i=0;i<list.length;i++){ if(list[i]&&list[i].id&&!avisosCerrados[list[i].id]) n++; }
  var b=el('badge-avisos'); if(!b) return;
  b.textContent=n>99?'99+':String(n); b.hidden=!(n>0);
}
function renderAvisos(list){
  var box=el('lista-avisos'); if(!box) return;
  if(!list||!list.length){ box.innerHTML='<p class="avisos-vacio">No hay avisos por ahora. Vuelve pronto.</p>'; return; }
  box.innerHTML=list.map(function(a){
    if(!a||!a.id||avisosCerrados[a.id]) return '';
    var cta='';
    if(a.accion&&a.accion.tipo){
      var t=String(a.accion.tipo).toLowerCase();
      if(t==='pais') cta='<button type="button" class="aviso-cta" data-accion="pais">Ver emisoras →</button>';
      else if(t==='emisora') cta='<button type="button" class="aviso-cta" data-accion="emisora">Escuchar →</button>';
    }
    return '<article class="aviso-msg" data-aviso="'+esc(a.id)+'">'+
      '<button type="button" class="aviso-close" data-cerrar="'+esc(a.id)+'" aria-label="Cerrar aviso">✕</button>'+
      (a.fecha?'<div class="aviso-fecha">'+esc(a.fecha)+'</div>':'')+
      '<h3 class="aviso-titulo">'+esc(a.titulo||'Aviso')+'</h3>'+
      (a.texto?'<p class="aviso-texto">'+esc(a.texto)+'</p>':'')+cta+'</article>';
  }).join('');
  box.querySelectorAll('[data-cerrar]').forEach(function(b){
    b.addEventListener('click',function(){
      var id=b.getAttribute('data-cerrar'); avisosCerrados[id]=1;
      var card=b.closest('.aviso-msg'); if(card) card.style.display='none';
      updateAvisosBadge();
    });
  });
  box.querySelectorAll('[data-accion]').forEach(function(b){
    b.addEventListener('click',function(){
      var card=b.closest('.aviso-msg'), id=card?card.getAttribute('data-aviso'):'';
      var list=avisosLS(LS_AVISOS,[]), a=null, i;
      for(i=0;i<list.length;i++){ if(list[i]&&list[i].id===id){ a=list[i]; break; } }
      if(a&&a.accion) resolveAvisoAction(a.accion);
    });
  });
}
function resolveAvisoAction(acc){
  try{
    if(!acc||!acc.tipo) return;
    var t=String(acc.tipo).toLowerCase(), v=String(acc.valor==null?'':acc.valor).trim(), i, s;
    if(t==='pais'&&v){
      filters.country=v; filters.city=''; filters.genre=''; filters.favs=false; filters.q='';
      el('fGenre').value=''; el('q').value='';
      var ff=el('fFavs'); if(ff) ff.setAttribute('aria-pressed','false');
      syncCountryChips(); renderCities(v);
      go('radio'); applyFilters();
    } else if(t==='emisora'&&v){
      var vl=v.toLowerCase(); s=null;
      for(i=0;i<STATIONS.length;i++){ if(String(STATIONS[i].name||'').toLowerCase()===vl){ s=STATIONS[i]; break; } }
      if(!s) for(i=0;i<STATIONS.length;i++){ if(String(STATIONS[i].name||'').toLowerCase().indexOf(vl)!==-1){ s=STATIONS[i]; break; } }
      if(s) playStation(s);
    }
  }catch(e){ /* cero botones muertos */ }
}



/* ---------- cobertura por país (sección Inicio) ---------- */
function buildCoverage(){
  var grid=el('coverageGrid'); if(!grid||!STATIONS.length) return;
  var by={};
  STATIONS.forEach(function(s){ if(!s.country) return; (by[s.country]=by[s.country]||[]).push(s); });
  var names=Object.keys(by).sort();
  grid.innerHTML=names.map(function(c){
    var list=by[c];
    var ex=list.slice(0,3).map(function(x){ return '<b>'+esc(x.name)+'</b>'; }).join(' · ');
    return '<button class="coverage-card" data-country="'+esc(c)+'"><span class="coverage-head">'+flagImg(countryCode(c), c)+'<span class="coverage-country">'+esc(c)+'</span><span class="coverage-count">'+list.length+' emisoras</span></span><span class="coverage-examples">'+ex+'</span></button>';
  }).join('');
  grid.querySelectorAll('.coverage-card').forEach(function(card){
    card.addEventListener('click',function(){ selectCountry(card.getAttribute('data-country')); go('radio'); });
  });
}

/* ---------- carga del catálogo ---------- */
function initCatalog(){
  fetch('stations.json').then(function(r){ return r.json(); }).then(function(d){
    STATIONS=d||[];
    el('statStations').textContent=STATIONS.length.toLocaleString('es-CO');
    var countries={}; d.forEach(function(s){ if(s.country) countries[s.country]=1; });
    var clist=Object.keys(countries).sort();
    el('statCountries').textContent=clist.length;
    var cc=el('countryChips');
    cc.innerHTML='<button class="chip active" data-c="">'+SVG_GLOBE+' Todas</button>'+clist.map(function(c){return '<button class="chip" data-c="'+esc(c)+'">'+flagImg(countryCode(c), c)+' '+esc(c)+'</button>';}).join('');
    cc.querySelectorAll('.chip').forEach(function(ch){ ch.addEventListener('click',function(){ selectCountry(ch.getAttribute('data-c')); }); });
    buildCoverage();
    if(typeof rlGlobeSetStations==='function') rlGlobeSetStations();
    var genres={}; d.forEach(function(s){ var g=String(s.genre||'').toLowerCase(); if(g) genres[g]=s.genre; });
    var fg=el('fGenre');
    Object.keys(genres).sort().forEach(function(g){ var o=document.createElement('option'); o.value=g; o.textContent=genres[g]; fg.appendChild(o); });
    var gc=el('genreChips');
    var topGenres=['General','Variada','Pop latino','Noticias','Tropical','Salsa','Rock','Regional','Romántica','80s'];
    gc.innerHTML=topGenres.map(function(g){return '<button class="chip" data-g="'+esc(g.toLowerCase())+'">'+esc(g)+'</button>';}).join('');
    gc.querySelectorAll('.chip').forEach(function(ch){ ch.addEventListener('click',function(){ filters.country=''; filters.city=''; resetRefine(); filters.genre=ch.getAttribute('data-g'); fg.value=filters.genre; syncCountryChips(); renderCities(''); go('radio'); applyFilters(); }); });
    // destacadas
    var featNames=['Olímpica Stereo Armenia 96.1 FM','Caracol Radio Bogotá','LOS40 Cali','La Kalle Bogotá','Blu Radio','La Mejor 97.7 Ciudad de México','Radio Mitre Buenos Aires','BioBio Chile Santiago'];
    var feat=[];
    featNames.forEach(function(n){ var s=findStation(n); if(s) feat.push(s); });
    if(feat.length<8){ for(var i=0;i<STATIONS.length&&feat.length<8;i++){ if(feat.indexOf(STATIONS[i])===-1) feat.push(STATIONS[i]); } }
    var fr=el('featuredRow'); fr.innerHTML=feat.map(cardHTML).join(''); bindCards(fr);
    applyFilters();
    openDeepLink();
  }).catch(function(){ el('radioCount').textContent='No se pudo cargar el catálogo.'; });
}
function countryCode(c){ var m={'Colombia':'CO','México':'MX','Argentina':'AR','Perú':'PE','Chile':'CL','República Dominicana':'DO','Puerto Rico':'PR','Ecuador':'EC','Venezuela':'VE','España':'ES','Estados Unidos':'US','Uruguay':'UY','Paraguay':'PY','Bolivia':'BO','Guatemala':'GT','El Salvador':'SV','Honduras':'HN','Nicaragua':'NI','Costa Rica':'CR','Panamá':'PA','Brasil':'BR','Cuba':'CU'}; return m[c]||''; }

/* Limpia los refinamientos (género, favoritas, búsqueda) para que cada
 * selección de país/ciudad/género empiece de cero y no se combine en silencio. */
function resetRefine(){
  filters.genre=''; filters.favs=false; filters.q='';
  var fg=el('fGenre'); if(fg) fg.value='';
  var q=el('q'); if(q) q.value='';
  var ff=el('fFavs'); if(ff) ff.setAttribute('aria-pressed','false');
}
/* ---------- explorar país → ciudades ---------- */
function syncCountryChips(){
  el('countryChips').querySelectorAll('.chip').forEach(function(x){ x.classList.toggle('active',x.getAttribute('data-c')===filters.country); });
}
function selectCountry(c){
  filters.country=c; filters.city='';
  resetRefine();
  syncCountryChips(); renderCities(c); applyFilters();
}
function citiesOfCountry(country){
  var map={};
  STATIONS.forEach(function(s){ if(s.country===country&&s.city) map[s.city]=(map[s.city]||0)+1; });
  return Object.keys(map).sort(function(a,b){ return a.localeCompare(b,'es'); }).map(function(c){ return {name:c,count:map[c]}; });
}
function renderCities(country){
  var row=el('cityRow');
  if(!country){ row.hidden=true; filters.city=''; return; }
  var cities=citiesOfCountry(country);
  row.hidden=false;
  el('crumbs').innerHTML='<b>'+esc(country)+'</b>'+(filters.city?'<span>›</span><span>'+esc(filters.city)+'</span>':'')+'<button class="linklike" id="crumbClear" title="Quitar filtro de ciudad">✕</button>';
  var cc=el('cityChips');
  cc.innerHTML='<button class="chip'+(filters.city?'':' active')+'" data-city="">Todas las ciudades</button>'+
    cities.map(function(c){ return '<button class="chip'+(filters.city===c.name?' active':'')+'" data-city="'+esc(c.name)+'">'+esc(c.name)+' · '+c.count+'</button>'; }).join('');
  cc.querySelectorAll('.chip').forEach(function(ch){ ch.addEventListener('click',function(){ filters.city=ch.getAttribute('data-city'); resetRefine(); renderCities(country); applyFilters(); }); });
  el('crumbClear').addEventListener('click',function(){
    if(filters.city){ filters.city=''; renderCities(country); applyFilters(); }
    else { selectCountry(''); }
  });
}

el('q').addEventListener('input',function(){ filters.q=el('q').value; applyFilters(); });
el('fGenre').addEventListener('change',function(){ filters.genre=el('fGenre').value; applyFilters(); });
el('fFavs').addEventListener('click',function(){ filters.favs=!filters.favs; el('fFavs').setAttribute('aria-pressed',filters.favs); applyFilters(); });
function heroGo(){ var v=el('heroSearch').value; el('q').value=v; filters.q=v; go('radio'); applyFilters(); }
el('heroSearchGo').addEventListener('click',heroGo);
el('heroSearch').addEventListener('keydown',function(e){ if(e.key==='Enter') heroGo(); });

/* ================= FIREBASE + CHAT (modelo app 1.9.19) ================= */
var auth=null, db=null, storage=null, fbReady=false, signInPromise=null, fbInitPromise=null, chatStarted=false;
var NICK_KEY='rl_chat_nick', SEXO_KEY='rl_chat_sexo', PAIS_KEY='rl_chat_pais', BLOCKED_KEY='rl_blocked';
var MY_ROOMS_KEY='rl_my_rooms', MAX_TEXT=200;
var unsub=null, roomUnsub=null, currentRoom=null;
var _lastMsgAt=0, _lastRoomMsgAt=0, premiumCache=null;
var BAD_WORDS=['pendejo','idiota','estupido','maldito','cabron','mierda','carajo','joder','puta','coño','verga','chingar','boludo','pelotudo','gilipollas','imbecil'];
var ROOM_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ', ROOM_CODE_LEN=6;
var PAISES=[['AF','Afganistán'],['AL','Albania'],['DE','Alemania'],['AD','Andorra'],['AO','Angola'],['AI','Anguila'],['AG','Antigua y Barbuda'],['SA','Arabia Saudita'],['DZ','Argelia'],['AR','Argentina'],['AM','Armenia'],['AW','Aruba'],['AU','Australia'],['AT','Austria'],['AZ','Azerbaiyán'],['BS','Bahamas'],['BD','Bangladés'],['BB','Barbados'],['BH','Baréin'],['BE','Bélgica'],['BZ','Belice'],['BJ','Benín'],['BM','Bermudas'],['BY','Bielorrusia'],['BO','Bolivia'],['BQ','Bonaire'],['BA','Bosnia y Herzegovina'],['BW','Botsuana'],['BR','Brasil'],['BN','Brunéi'],['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],['BT','Bután'],['CV','Cabo Verde'],['KH','Camboya'],['CM','Camerún'],['CA','Canadá'],['QA','Catar'],['TD','Chad'],['CL','Chile'],['CN','China'],['CY','Chipre'],['VA','Ciudad del Vaticano'],['CO','Colombia'],['KM','Comoras'],['CG','Congo'],['CD','Congo (RDC)'],['KP','Corea del Norte'],['KR','Corea del Sur'],['CI','Costa de Marfil'],['CR','Costa Rica'],['HR','Croacia'],['CU','Cuba'],['CW','Curazao'],['DK','Dinamarca'],['DM','Dominica'],['EC','Ecuador'],['EG','Egipto'],['SV','El Salvador'],['AE','Emiratos Árabes Unidos'],['ER','Eritrea'],['SK','Eslovaquia'],['SI','Eslovenia'],['ES','España'],['US','Estados Unidos'],['EE','Estonia'],['SZ','Esuatini'],['ET','Etiopía'],['PH','Filipinas'],['FI','Finlandia'],['FJ','Fiyi'],['FR','Francia'],['GA','Gabón'],['GM','Gambia'],['GE','Georgia'],['GH','Ghana'],['GI','Gibraltar'],['GD','Granada'],['GR','Grecia'],['GL','Groenlandia'],['GP','Guadalupe'],['GU','Guam'],['GT','Guatemala'],['GF','Guayana Francesa'],['GG','Guernsey'],['GN','Guinea'],['GQ','Guinea Ecuatorial'],['GW','Guinea-Bisáu'],['GY','Guyana'],['HT','Haití'],['HN','Honduras'],['HK','Hong Kong'],['HU','Hungría'],['IN','India'],['ID','Indonesia'],['IQ','Irak'],['IR','Irán'],['IE','Irlanda'],['IM','Isla de Man'],['NF','Isla Norfolk'],['IS','Islandia'],['KY','Islas Caimán'],['CC','Islas Cocos'],['CK','Islas Cook'],['FO','Islas Feroe'],['FK','Islas Malvinas'],['MP','Islas Marianas del Norte'],['MH','Islas Marshall'],['PN','Islas Pitcairn'],['SB','Islas Salomón'],['TC','Islas Turcas y Caicos'],['VG','Islas Vírgenes Británicas'],['VI','Islas Vírgenes de EE. UU.'],['IL','Israel'],['IT','Italia'],['JM','Jamaica'],['JP','Japón'],['JE','Jersey'],['JO','Jordania'],['KZ','Kazajistán'],['KE','Kenia'],['KG','Kirguistán'],['KI','Kiribati'],['XK','Kosovo'],['KW','Kuwait'],['LA','Laos'],['LS','Lesoto'],['LV','Letonia'],['LB','Líbano'],['LR','Liberia'],['LY','Libia'],['LI','Liechtenstein'],['LT','Lituania'],['LU','Luxemburgo'],['MO','Macao'],['MG','Madagascar'],['MY','Malasia'],['MW','Malaui'],['MV','Maldivas'],['ML','Malí'],['MT','Malta'],['MA','Marruecos'],['MQ','Martinica'],['MU','Mauricio'],['MR','Mauritania'],['YT','Mayotte'],['MX','México'],['FM','Micronesia'],['MD','Moldavia'],['MC','Mónaco'],['MN','Mongolia'],['ME','Montenegro'],['MS','Montserrat'],['MZ','Mozambique'],['MM','Myanmar'],['NA','Namibia'],['NR','Nauru'],['NP','Nepal'],['NI','Nicaragua'],['NE','Níger'],['NG','Nigeria'],['NU','Niue'],['NO','Noruega'],['NC','Nueva Caledonia'],['NZ','Nueva Zelanda'],['OM','Omán'],['NL','Países Bajos'],['PK','Pakistán'],['PW','Palaos'],['PS','Palestina'],['PA','Panamá'],['PG','Papúa Nueva Guinea'],['PY','Paraguay'],['PE','Perú'],['PF','Polinesia Francesa'],['PL','Polonia'],['PT','Portugal'],['PR','Puerto Rico'],['GB','Reino Unido'],['CF','República Centroafricana'],['CZ','República Checa'],['DO','República Dominicana'],['RE','Reunión'],['RW','Ruanda'],['RO','Rumania'],['RU','Rusia'],['EH','Sáhara Occidental'],['WS','Samoa'],['AS','Samoa Americana'],['BL','San Bartolomé'],['KN','San Cristóbal y Nieves'],['SM','San Marino'],['MF','San Martín'],['PM','San Pedro y Miquelón'],['VC','San Vicente y las Granadinas'],['SH','Santa Elena'],['LC','Santa Lucía'],['ST','Santo Tomé y Príncipe'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leona'],['SG','Singapur'],['SX','Sint Maarten'],['SY','Siria'],['SO','Somalia'],['LK','Sri Lanka'],['ZA','Sudáfrica'],['SD','Sudán'],['SS','Sudán del Sur'],['SE','Suecia'],['CH','Suiza'],['SR','Surinam'],['TH','Tailandia'],['TW','Taiwán'],['TZ','Tanzania'],['TJ','Tayikistán'],['TL','Timor Oriental'],['TG','Togo'],['TK','Tokelau'],['TO','Tonga'],['TT','Trinidad y Tobago'],['TN','Túnez'],['TM','Turkmenistán'],['TR','Turquía'],['TV','Tuvalu'],['UA','Ucrania'],['UG','Uganda'],['UY','Uruguay'],['UZ','Uzbekistán'],['VU','Vanuatu'],['VE','Venezuela'],['VN','Vietnam'],['WF','Wallis y Futuna'],['YE','Yemen'],['DJ','Yibuti'],['ZM','Zambia'],['ZW','Zimbabue']];

function fbInit(){
  if(fbReady) return Promise.resolve(true);
  if(fbInitPromise) return fbInitPromise; /* race-safe 2026-09-27: un init en vuelo lo comparten todos (patrón signInPromise) */
  fbInitPromise=fetch('firebase-config.json').then(function(r){ return r.json(); }).then(function(cfg){
    try{ firebase.initializeApp(cfg); }catch(e){ if(String((e&&e.code)||'').indexOf('duplicate-app')===-1) throw e; }
    auth=firebase.auth(); db=firebase.firestore(); storage=firebase.storage();
    fbReady=true; return true;
  }).catch(function(){ fbInitPromise=null; toast('⚠️ No se pudo conectar con el chat.'); return false; });
  return fbInitPromise;
}
function ensureSignedIn(){
  if(!fbReady) return Promise.resolve(false);
  if(auth.currentUser) return Promise.resolve(true);
  if(signInPromise) return signInPromise;
  signInPromise=auth.signInAnonymously().then(function(){ return true; }).catch(function(){ signInPromise=null; toast('⚠️ No se pudo iniciar sesión de chat.'); return false; });
  return signInPromise;
}
function rlChatProfile(){ return { nick:localStorage.getItem(NICK_KEY)||'', sexo:localStorage.getItem(SEXO_KEY)||'', pais:localStorage.getItem(PAIS_KEY)||'' }; }
function rlNeedProfile(){ var p=rlChatProfile(); return !(p.nick&&p.sexo&&p.pais); }
/* Países del catálogo (22): la bandera del chat solo vale si el código es
   uno de estos; cualquier otro código (p. ej. GI, SZ, EE del idioma del
   navegador) o un mensaje sin país muestra la bandera de Colombia. */
var RL_CATALOGO_PAISES={AR:1,BO:1,BR:1,CL:1,CO:1,CR:1,CU:1,DO:1,EC:1,ES:1,GT:1,HN:1,MX:1,NI:1,PA:1,PE:1,PR:1,PY:1,SV:1,US:1,UY:1,VE:1};
function rlChatFlag(p){ var c=String(p||'').toUpperCase(); if(!RL_CATALOGO_PAISES[c]) c='CO'; return flagImg(c); }
function rlDetectCountry(){ var l=(navigator.language||'es').split('-')[1]; var c=(l||'CO').toUpperCase(); return RL_CATALOGO_PAISES[c]?c:'CO'; }
function sexIcon(s){ return s==='F'?'♀':(s==='M'?'♂':''); }
function rlTodayKey(){ var d=new Date(); return 'rl_chat_limite_'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function rlMsgsToday(){ return parseInt(localStorage.getItem(rlTodayKey())||'0',10); }
function rlCountMsg(){ try{ localStorage.setItem(rlTodayKey(),String(rlMsgsToday()+1)); }catch(e){} }
async function rlIsPremiumWeb(){
  if(premiumCache!==null) return premiumCache;
  premiumCache=false;
  try{ if(!(await ensureSignedIn())) return false;
    /* 1.9.22 (Tarea 2, B2 - Tiger): la web verifica el uid VINCULADO (localStorage),
     * no el anónimo del navegador (nunca coincide con el de la app). Lee el booleano. */
    var linkUid=null; try{ linkUid=localStorage.getItem('rl_premium_uid'); }catch(e){}
    if(!linkUid) return false;
    var doc=await db.collection('premium_uids').doc(linkUid).get();
    premiumCache=doc.exists&&doc.data().premium===true;
  }catch(e){ premiumCache=false; }
  return premiumCache;
}
async function rlCanChat(){ if(await rlIsPremiumWeb()) return true; return rlMsgsToday()<10; }
function hasBadWord(t){ var low=' '+String(t).toLowerCase()+' '; for(var i=0;i<BAD_WORDS.length;i++){ if(low.indexOf(BAD_WORDS[i])>=0) return true; } return false; }
function getBlocked(){ try{ return JSON.parse(localStorage.getItem(BLOCKED_KEY)||'[]'); }catch(e){ return []; } }
function formatTime(ts){ try{ if(ts&&typeof ts.toDate==='function') return ts.toDate().toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}); }catch(e){} return ''; }
function msgHTML(d, mine){
  var data=d.data()||{};
  var nick=data.apodo||data.nickname||'Oyente';
  var isOwn=nick===mine;
  var time=formatTime(data.createdAt);
  var flag=rlChatFlag(data.pais)+' ';
  var sx=data.sexo?' '+sexIcon(String(data.sexo)):'';
  /* Susurro premium: solo autor y destinatario ven el texto real */
  var esSusurro=!!data.esSusurro, paraNick=data.susurroPara||'';
  var puedoVer=!esSusurro||isOwn||paraNick===mine;
  var txt=puedoVer?(data.texto||data.text||''):'🔒 Mensaje privado';
  var susTag=esSusurro?'<span class="chat-susurro-tag">🔒 '+(puedoVer?('Privado · '+esc(paraNick)):'Privado')+'</span>':'';
  var acts='';
  if(d._room==='general'){
    acts='<div class="chat-msg-actions"><button class="chat-flag" data-action="report" data-id="'+esc(d.id)+'" data-nick="'+esc(nick)+'">Reportar</button>'+
      '<button class="chat-flag" data-action="invite">Invitar</button>'+
      (isOwn?'':'<button class="chat-flag" data-action="block" data-nick="'+esc(nick)+'">Bloquear</button>')+
      (isOwn?'':'<button class="chat-flag" data-action="whisper" data-nick="'+esc(nick)+'">🔒 Privado</button>')+'</div>';
  }
  return '<div class="chat-msg'+(isOwn?' own':'')+'"><div class="chat-msg-head"><b><span class="avatar">'+esc(initials(nick))+'</span>'+flag+esc(nick)+sx+'</b>'+(time?'<span>'+esc(time)+'</span>':'')+susTag+'</div><p>'+esc(txt)+'</p>'+acts+'</div>';
}

/* ---------- sala general ---------- */
function subscribeGeneral(){
  if(unsub||!db) return;
  var meta=el('chatMeta');
  try{
    unsub=db.collection('rooms/general/messages').orderBy('createdAt','desc').limit(60)
      .onSnapshot(function(snap){
        var docs=[]; snap.forEach(function(d){ d._room='general'; docs.push(d); });
        renderGeneral(docs.reverse());
        noteWhisper(docs);
        if(meta) meta.textContent='Sala general · '+(rlChatProfile().nick||'Oyente');
      },function(){ if(meta) meta.textContent='No se pudieron cargar los mensajes.'; });
  }catch(e){ if(meta) meta.textContent='No se pudieron cargar los mensajes.'; }
}
function renderGeneral(docs){
  var box=el('chatMessages'); if(!box) return;
  var blocked=getBlocked(), mine=rlChatProfile().nick;
  var nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  var vis=docs.filter(function(d){ var n=(d.data()||{}).apodo||''; return blocked.indexOf(n)===-1; });
  box.innerHTML=vis.length?vis.map(function(d){return msgHTML(d,mine);}).join(''):'<div class="chat-empty">Sé la primera persona en saludar en la sala. 👋</div>';
  if(nearBottom) box.scrollTop=box.scrollHeight;
}
async function sendGeneral(){
  var input=el('chatInput');
  var text=(input.value||'').trim().slice(0,MAX_TEXT);
  if(!text){ toast('Escribe un mensaje antes de enviarlo.'); return; }
  if(rlNeedProfile()){ openProfile(); toast('👤 Primero crea tu perfil del chat.'); return; }
  if(!(await rlCanChat())){ toast('💬 Llegaste a tus 10 mensajes de hoy. Con Premium hablas sin límites.'); openPremium(); return; }
  var now=Date.now();
  if(now-_lastMsgAt<3000){ toast('Espera un momento antes de enviar otro mensaje.'); return; }
  if(hasBadWord(text)){ toast('Tu mensaje contiene palabras no permitidas.'); return; }
  if(!(await ensureSignedIn())) return;
  var prof=rlChatProfile();
  try{
    await db.collection('rooms/general/messages').add({ texto:text, apodo:prof.nick||'Oyente', sexo:prof.sexo||'X', pais:prof.pais||rlDetectCountry(), createdAt:firebase.firestore.FieldValue.serverTimestamp() });
    _lastMsgAt=now; rlCountMsg(); input.value='';
  }catch(e){ toast('No se pudo enviar tu mensaje. Inténtalo de nuevo.'); }
}
/* ---------- susurro premium (privado en la sala general) ---------- */
var seenWhisper={};
function noteWhisper(docs){
  var mine=rlChatProfile().nick||'';
  docs.forEach(function(d){
    var data=d.data()||{}, ya=seenWhisper[d.id];
    seenWhisper[d.id]=1;
    if(ya) return;
    if(data.esSusurro&&data.susurroPara===mine&&(data.apodo||'')!==mine){
      toast('🔒 '+(data.apodo||'Alguien')+' te susurró en privado.');
    }
  });
}
async function sendWhisper(targetNick){
  if(!targetNick) return;
  if(!(await rlIsPremiumWeb())){ openPremium(); toast('👑 Solo Premium puede enviar mensajes privados.'); return; }
  if(rlNeedProfile()){ openProfile(); toast('👤 Primero crea tu perfil del chat.'); return; }
  var text=window.prompt('Mensaje privado para '+targetNick+':','');
  if(text==null) return;
  text=String(text).trim().slice(0,MAX_TEXT);
  if(!text){ toast('Escribe un mensaje antes de enviarlo.'); return; }
  var now=Date.now();
  if(now-_lastMsgAt<3000){ toast('Espera un momento antes de enviar otro mensaje.'); return; }
  if(hasBadWord(text)){ toast('Tu mensaje contiene palabras no permitidas.'); return; }
  if(!(await ensureSignedIn())) return;
  var prof=rlChatProfile();
  try{
    await db.collection('rooms/general/messages').add({ texto:text, apodo:prof.nick||'Oyente', sexo:prof.sexo||'X', pais:prof.pais||rlDetectCountry(), esSusurro:true, susurroPara:targetNick, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
    _lastMsgAt=now;
    toast('🔒 Privado enviado a '+targetNick+'.');
  }catch(e){ toast(e && e.code==='permission-denied' ? '👑 El servidor no reconoce este navegador como Premium. Cierra y abre el chat de nuevo.' : 'No se pudo enviar tu mensaje. Inténtalo de nuevo.'); }
}
el('chatForm').addEventListener('submit',function(e){ e.preventDefault(); sendGeneral(); });
el('chatMessages').addEventListener('click',async function(e){
  var t=e.target.closest?e.target.closest('[data-action]'):null; if(!t) return;
  var action=t.getAttribute('data-action'), nick=t.getAttribute('data-nick')||'';
  if(action==='block'&&nick){
    var list=getBlocked(); if(list.indexOf(nick)===-1) list.push(nick);
    try{ localStorage.setItem(BLOCKED_KEY,JSON.stringify(list)); }catch(e2){}
    toast('Bloqueaste a '+nick+'. Ya no verás sus mensajes.');
    if(unsub){ try{unsub();}catch(e3){} unsub=null; } subscribeGeneral();
  }
  if(action==='invite'){ openInviteModal(); return; }
  if(action==='whisper'){ sendWhisper(nick); return; }
  if(action==='report'){
    var mid=t.getAttribute('data-id'); if(!mid) return;
    if(!window.confirm('¿Reportar este mensaje como inapropiado?')) return;
    if(!(await ensureSignedIn())) return;
    try{ await db.collection('reports').add({ messageId:mid, room:'general', reporterUid:auth.currentUser?auth.currentUser.uid:null, createdAt:firebase.firestore.FieldValue.serverTimestamp() }); toast('Reporte enviado. Gracias por cuidar la comunidad.'); }
    catch(e4){ toast('No se pudo enviar el reporte.'); }
  }
});

/* ---------- invitar a sala privada (desde la sala general) ---------- */
function openInviteModal(){
  var list=myRooms(), box=el('inviteRooms');
  box.innerHTML=list.length?list.map(function(r){
    return '<button class="room-item" data-icode="'+esc(r.code)+'"><span class="ric">'+SVG_LOCK+'</span><span><span class="room-item-name">'+esc(r.nombre)+'</span><span class="room-item-code">CÓDIGO '+esc(r.code)+'</span></span><span class="linklike">Copiar</span></button>';
  }).join(''):'<div class="chat-empty">Aún no tienes salas privadas. Crea una en la pestaña "Salas privadas". 🔑</div>';
  box.querySelectorAll('[data-icode]').forEach(function(b){ b.addEventListener('click',function(){
    var code=b.getAttribute('data-icode');
    function done(){ toast('📨 Código copiado: '+code+'. Pégalo en el chat para invitar.'); }
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(code).then(done).catch(done); } else { done(); }
    closeModal('inviteModal');
  }); });
  openModal('inviteModal');
}
el('inviteClose').addEventListener('click',function(){ closeModal('inviteModal'); });

/* ---------- salas privadas ---------- */
function myRooms(){ try{ return JSON.parse(localStorage.getItem(MY_ROOMS_KEY)||'[]'); }catch(e){ return []; } }
function saveMyRoom(code,nombre){ var l=myRooms().filter(function(r){return r.code!==code;}); l.unshift({code:code,nombre:nombre}); try{localStorage.setItem(MY_ROOMS_KEY,JSON.stringify(l.slice(0,50)));}catch(e){} }
function forgetMyRoom(code){ try{localStorage.setItem(MY_ROOMS_KEY,JSON.stringify(myRooms().filter(function(r){return r.code!==code;})));}catch(e){} }
function renderMyRooms(){
  var box=el('myRooms'), list=myRooms();
  box.innerHTML=list.length?list.map(function(r){
    return '<button class="room-item" data-room="'+esc(r.code)+'" data-rname="'+esc(r.nombre)+'"><span class="ric">'+SVG_LOCK+'</span><span><span class="room-item-name">'+esc(r.nombre)+'</span><span class="room-item-code">CÓDIGO '+esc(r.code)+'</span></span></button>';
  }).join(''):'<div class="chat-empty">Aún no tienes salas privadas. Crea una o únete con un código. 🔑</div>';
  box.querySelectorAll('.room-item').forEach(function(b){ b.addEventListener('click',function(){ openRoom(b.getAttribute('data-room'),b.getAttribute('data-rname')); }); });
}
function genCode(){
  var out='';
  try{ var c=window.crypto||window.msCrypto, rnd=new Uint32Array(ROOM_CODE_LEN); c.getRandomValues(rnd);
    for(var i=0;i<ROOM_CODE_LEN;i++) out+=ROOM_ALPHABET.charAt(rnd[i]%ROOM_ALPHABET.length);
  }catch(e){ for(var j=0;j<ROOM_CODE_LEN;j++) out+=ROOM_ALPHABET.charAt(Math.floor(Math.random()*ROOM_ALPHABET.length)); }
  return out;
}
el('createRoomBtn').addEventListener('click',async function(){
  if(!(await rlIsPremiumWeb())){ openPremium(); toast('👑 Solo Premium puede crear salas privadas.'); return; }
  if(rlNeedProfile()){ openProfile(); toast('👤 Primero crea tu perfil del chat.'); return; }
  var name=window.prompt('Nombre de la sala privada:','Mi sala');
  if(name==null) return;
  name=String(name).replace(/[<>&"']/g,'').trim().slice(0,40);
  if(name.length<3){ toast('El nombre debe tener al menos 3 caracteres.'); return; }
  if(!(await ensureSignedIn())) return;
  var uid=auth.currentUser.uid, code=genCode(), tries=0;
  try{
    var snap=await db.collection('roomCodes').doc(code).get();
    while(snap.exists&&tries<5){ code=genCode(); snap=await db.collection('roomCodes').doc(code).get(); tries++; }
    if(snap.exists){ toast('No se pudo generar un código único. Inténtalo de nuevo.'); return; }
  }catch(e){ toast('Revisa tu conexión e inténtalo de nuevo.'); return; }
  var nowT=firebase.firestore.FieldValue.serverTimestamp(), prof=rlChatProfile();
  var batch=db.batch();
  batch.set(db.collection('rooms').doc(code),{code:code,nombre:name,ownerUid:uid,createdAt:nowT});
  batch.set(db.collection('roomCodes').doc(code),{code:code,nombre:name,ownerUid:uid,createdAt:nowT});
  batch.set(db.collection('rooms').doc(code).collection('members').doc(uid),{nick:prof.nick||'Oyente',role:'owner',joinedAt:nowT});
  try{ await batch.commit(); }catch(e2){ toast('No se pudo crear la sala.'); return; }
  saveMyRoom(code,name); renderMyRooms();
  toast('🎉 Sala creada. Tu código de invitación es '+code+'.');
  openRoom(code,name);
});
el('joinRoomBtn').addEventListener('click',async function(){
  var raw=window.prompt('Código de invitación (6 letras):','');
  if(raw==null) return;
  var code=String(raw).toUpperCase().replace(/[^A-Z]/g,'').slice(0,6);
  if(code.length!==6){ toast('El código debe tener 6 letras.'); return; }
  if(!(await ensureSignedIn())) return;
  try{
    var doc=await db.collection('roomCodes').doc(code).get();
    if(!doc.exists){ toast('No existe una sala con ese código.'); return; }
    var data=doc.data()||{}, uid=auth.currentUser.uid, prof=rlChatProfile();
    await db.collection('rooms').doc(code).collection('members').doc(uid).set({ nick:prof.nick||'Oyente', role:'member', joinedAt:firebase.firestore.FieldValue.serverTimestamp() });
    saveMyRoom(code,data.nombre||'Sala privada'); renderMyRooms();
    toast('Te uniste a la sala '+(data.nombre||'privada')+'.');
    openRoom(code,data.nombre||'Sala privada');
  }catch(e){ toast('No se pudo unir a la sala. Inténtalo de nuevo.'); }
});
function roomMessagesRef(code){ return db.collection('rooms').doc(code).collection('messages'); }
function openRoom(code,nombre){
  closeRoom();
  currentRoom={code:code,nombre:nombre};
  el('roomName').textContent=nombre; el('roomCode').textContent='CÓDIGO '+code;
  el('roomView').hidden=false;
  el('roomDeleteBtn').hidden=true;
  db.collection('rooms').doc(code).get().then(function(d){
    var data=d.data()||{};
    if(auth.currentUser&&data.ownerUid===auth.currentUser.uid&&currentRoom&&currentRoom.code===code){ el('roomDeleteBtn').hidden=false; }
  }).catch(function(){});
  subscribeRoom(code);
  el('roomView').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function subscribeRoom(code){
  var box=el('roomMsgs');
  try{
    roomUnsub=roomMessagesRef(code).orderBy('createdAt','desc').limit(60).onSnapshot(function(snap){
      var docs=[], mine=rlChatProfile().nick; snap.forEach(function(d){ docs.push(d); });
      var nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
      box.innerHTML=docs.length?docs.reverse().map(function(d){return msgHTML(d,mine);}).join(''):'<div class="chat-empty">Aún no hay mensajes en esta sala. ¡Saluda primero! 👋</div>';
      if(nearBottom) box.scrollTop=box.scrollHeight;
    },function(){ toast('Esta sala ya no está disponible.'); closeRoomView(); });
  }catch(e){ toast('No se pudieron cargar los mensajes de la sala.'); }
}
function closeRoom(){ if(roomUnsub){ try{roomUnsub();}catch(e){} roomUnsub=null; } currentRoom=null; }
function closeRoomView(){ closeRoom(); el('roomView').hidden=true; }
el('roomClose').addEventListener('click',closeRoomView);
el('roomForm').addEventListener('submit',async function(e){
  e.preventDefault();
  if(!currentRoom) return;
  var input=el('roomInput'), text=(input.value||'').trim().slice(0,MAX_TEXT);
  if(!text){ toast('Escribe un mensaje antes de enviarlo.'); return; }
  /* REGLA JEREMY: solo premium ENVÍA en privados */
  if(!(await rlIsPremiumWeb())){ openPremium(); toast('👑 Solo Premium puede enviar mensajes privados.'); return; }
  if(!(await rlCanChat())){ toast('💬 Llegaste a tus 10 mensajes de hoy.'); openPremium(); return; }
  var now=Date.now();
  if(now-_lastRoomMsgAt<3000){ toast('Espera un momento antes de enviar otro mensaje.'); return; }
  if(hasBadWord(text)){ toast('Tu mensaje contiene palabras no permitidas.'); return; }
  if(!(await ensureSignedIn())) return;
  var prof=rlChatProfile();
  try{
    await roomMessagesRef(currentRoom.code).add({ texto:text, apodo:prof.nick||'Oyente', sexo:prof.sexo||'X', pais:prof.pais||rlDetectCountry(), uid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
    _lastRoomMsgAt=now; rlCountMsg(); input.value='';
  }catch(err){ toast(err && err.code==='permission-denied' ? '👑 El servidor no reconoce este navegador como Premium. Cierra y abre el chat de nuevo.' : 'No se pudo enviar tu mensaje. Inténtalo de nuevo.'); }
});
el('roomInviteBtn').addEventListener('click',function(){
  if(!currentRoom) return;
  var code=currentRoom.code;
  function done(){ toast('📨 Comparte este código: '+code); }
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(code).then(done).catch(done); } else done();
});
el('roomLeaveBtn').addEventListener('click',async function(){
  if(!currentRoom) return;
  if(!window.confirm('¿Salir de esta sala privada? Ya no verás sus mensajes.')) return;
  if(!(await ensureSignedIn())) return;
  try{ await db.collection('rooms').doc(currentRoom.code).collection('members').doc(auth.currentUser.uid).delete(); }
  catch(e){ toast('No se pudo salir de la sala.'); return; }
  forgetMyRoom(currentRoom.code); closeRoomView(); renderMyRooms(); toast('Saliste de la sala.');
});
el('roomDeleteBtn').addEventListener('click',async function(){
  if(!currentRoom) return;
  if(!window.confirm('¿Eliminar esta sala privada? Se borrarán sus mensajes y el código dejará de funcionar.')) return;
  if(!(await ensureSignedIn())) return;
  var code=currentRoom.code;
  toast('Eliminando sala…');
  try{
    for(var i=0;i<20;i++){
      var ms=await roomMessagesRef(code).limit(400).get();
      if(ms.empty) break;
      var b=db.batch(); ms.forEach(function(d){ b.delete(d.ref); }); await b.commit();
      if(ms.size<400) break;
    }
    var mm=await db.collection('rooms').doc(code).collection('members').get();
    var b2=db.batch(); mm.forEach(function(d){ b2.delete(d.ref); });
    b2.delete(db.collection('roomCodes').doc(code)); b2.delete(db.collection('rooms').doc(code));
    await b2.commit();
  }catch(e){ toast('No se pudo eliminar la sala.'); return; }
  forgetMyRoom(code); closeRoomView(); renderMyRooms(); toast('Sala eliminada.');
});

/* ---------- tabs del chat ---------- */
el('tabGeneral').addEventListener('click',function(){
  el('tabGeneral').classList.add('active'); el('tabPriv').classList.remove('active');
  el('paneGeneral').hidden=false; el('panePriv').hidden=true;
});
el('tabPriv').addEventListener('click',function(){
  el('tabPriv').classList.add('active'); el('tabGeneral').classList.remove('active');
  el('panePriv').hidden=false; el('paneGeneral').hidden=true; renderMyRooms();
});

/* ---------- modales ---------- */
function openModal(id){ el(id).hidden=false; }
function closeModal(id){ el(id).hidden=true; }
document.querySelectorAll('.modal').forEach(function(m){ m.addEventListener('click',function(e){ if(e.target===m) m.hidden=true; }); });
function openProfile(){
  var p=rlChatProfile();
  el('pfNick').value=p.nick; el('pfSexo').value=p.sexo||'X';
  var sel=el('pfPais');
  if(!sel.options.length){ PAISES.forEach(function(pc){ var o=document.createElement('option'); o.value=pc[0]; o.textContent=pc[0]+' · '+pc[1]; sel.appendChild(o); }); }
  sel.value=p.pais||rlDetectCountry();
  openModal('profileModal');
}
el('profileBtn').addEventListener('click',openProfile);
el('pfCancel').addEventListener('click',function(){ closeModal('profileModal'); });
el('pfSave').addEventListener('click',function(){
  var nick=el('pfNick').value.trim().slice(0,16);
  if(nick.length<3){ toast('El apodo debe tener al menos 3 caracteres.'); return; }
  try{
    localStorage.setItem(NICK_KEY,nick); localStorage.setItem(SEXO_KEY,el('pfSexo').value); localStorage.setItem(PAIS_KEY,el('pfPais').value);
  }catch(e){}
  closeModal('profileModal'); toast('👤 Perfil guardado. ¡Bienvenido, '+nick+'!');
  if(unsub){ try{unsub();}catch(e2){} unsub=null; } subscribeGeneral();
});
function openPremium(){ openModal('premiumModal'); }
el('gatePremiumBtn').addEventListener('click',openPremium);
el('infoPremiumBtn').addEventListener('click',openPremium);
el('pmClose').addEventListener('click',function(){ closeModal('premiumModal'); });

/* 1.9.22 (Tarea 2, B2 - Tiger): vincular compra premium de la app con código de 6 letras. */
el('linkCodeBtn').addEventListener('click',async function(){
  var msg=el('linkCodeMsg'); msg.hidden=false;
  var code=((el('linkCodeInput').value)||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length!==6){ msg.textContent='El código tiene 6 caracteres.'; return; }
  msg.textContent='Verificando…';
  try{
    if(!(await fbInit())){ msg.textContent='Sin conexión. Intenta de nuevo.'; return; }
    await ensureSignedIn();
    var d=await db.collection('premium_codes').doc(code).get();
    if(!d.exists){ msg.textContent='Código no válido. Revísalo en la app.'; return; }
    var uid=d.data().uid;
    var p=await db.collection('premium_uids').doc(uid).get();
    if(!p.exists||p.data().premium!==true){ msg.textContent='Ese código ya no es premium.'; return; }
    try{ localStorage.setItem('rl_premium_uid',uid); }catch(e){}
    premiumCache=true;
    await rlAlignPremiumUid(uid); /* FIX-PREMIUM-ALIGN: alinea uid anonimo con premium */
    msg.textContent='✅ Premium vinculado. Ya puedes enviar mensajes privados.';
    toast('👑 Premium vinculado');
  }catch(e){ msg.textContent='No se pudo verificar. Intenta de nuevo.'; }
});

/* ---------- donaciones: enviar comprobante (FIX 2026-11-14) ----------
   Canal de envío: correo (mailto a ricomoralesjeremy@gmail.com, el correo
   del proyecto: a NINGÚN otro correo está autorizado que llegue el
   comprobante). En el sitio NO hay número de WhatsApp publicado, así que
   no se inventa ninguno: el reclamo se guarda en este navegador
   (localStorage) y se envía por el correo que se abre ya lleno; la captura
   se adjunta a mano en ese correo (un mailto no adjunta archivos). Si donó
   más de US$ 2,50, el dueño lo activa Premium 12 meses. */
var RC_LAST_BODY='';
function rcBuildBody(){
  var m=el('rcMethod').value, amt=parseFloat(el('rcAmount').value)||0;
  var ref=el('rcRef').value.trim(), code=(el('rcCode').value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  var shot=el('rcShot').files&&el('rcShot').files[0]?el('rcShot').files[0].name:'(sin captura)';
  var d=new Date();
  return 'Comprobante de donación — Radio Latina\n'
    +'Método: '+m+'\n'
    +'Monto: US$ '+amt.toFixed(2)+'\n'
    +'Referencia: '+(ref||'(sin referencia)')+'\n'
    +'Código de la app: '+(code||'(sin código)')+'\n'
    +'Captura: '+shot+'\n'
    +'Fecha: '+d.toLocaleString('es-CO')+'\n'
    +(amt>2.50?'\nMonto mayor a US$ 2,50: activar Premium por 12 meses.':'\nMonto de US$ 2,50 o menos: no alcanza para Premium (tiene que ser más de US$ 2,50).');
}
function rcValidate(){
  var msg=el('rcMsg');
  var amt=parseFloat(el('rcAmount').value);
  if(!(amt>0)){ msg.hidden=false; msg.textContent='Escribe el monto que donaste.'; return false; }
  if(!el('rcRef').value.trim()){ msg.hidden=false; msg.textContent='Escribe la referencia o el número de transacción.'; return false; }
  msg.hidden=true; msg.textContent='';
  return true;
}
el('receiptBtn').addEventListener('click',function(){ el('rcMsg').hidden=true; openModal('receiptModal'); });
el('rcCancel').addEventListener('click',function(){ closeModal('receiptModal'); });
el('rcCopy').addEventListener('click',function(){
  if(!rcValidate()) return;
  var body=rcBuildBody(); RC_LAST_BODY=body;
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(body).then(function(){ toast('Texto del comprobante copiado'); }).catch(function(){ toast('No se pudo copiar'); }); }
  else toast('Copia el texto a mano');
});
el('rcSend').addEventListener('click',function(){
  if(!rcValidate()) return;
  var body=rcBuildBody(); RC_LAST_BODY=body;
  var amt=parseFloat(el('rcAmount').value)||0;
  try{
    var list=[]; try{ list=JSON.parse(localStorage.getItem('rl_receipt_claims')||'[]'); }catch(e){ list=[]; }
    list.unshift({method:el('rcMethod').value,amount:amt,ref:el('rcRef').value.trim(),code:(el('rcCode').value||'').toUpperCase().replace(/[^A-Z0-9]/g,''),shot:el('rcShot').files&&el('rcShot').files[0]?el('rcShot').files[0].name:'',at:Date.now()});
    localStorage.setItem('rl_receipt_claims',JSON.stringify(list.slice(0,20)));
  }catch(e){}
  var sub='Comprobante de donación Radio Latina — '+el('rcMethod').value+' US$ '+amt.toFixed(2);
  window.location.href='mailto:ricomoralesjeremy@gmail.com?subject='+encodeURIComponent(sub)+'&body='+encodeURIComponent(body);
  closeModal('receiptModal');
  toast(amt>2.50?'Comprobante enviado: adjunta la captura en el correo y te activamos Premium por 12 meses':'Comprobante enviado: gracias por donar');
});
/* ---------- Barra de apoyo (2026-11-14) ----------
   Sale UNA VEZ por sesión (al cargar), dura 10 s y se cierra sola (la
   barrita amarilla muestra lo que falta). La ✕ la quita antes; «Donar» la
   cierra y baja al bloque de donaciones del pie. Nada la vuelve a mostrar
   mientras se usa la página (ni cambiar de sección ni volver a Inicio)
   ni al recargar en la misma sesión (sessionStorage rl_support_seen). */
(function(){
  var bar=el('supportBar'); if(!bar) return;
  var seen=false; try{ seen=sessionStorage.getItem('rl_support_seen')==='1'; }catch(e){}
  if(seen){ bar.hidden=true; return; }
  try{ sessionStorage.setItem('rl_support_seen','1'); }catch(e){}
  var done=false, timer=null;
  function hide(){
    if(done) return; done=true;
    if(timer) clearTimeout(timer);
    bar.classList.add('hide');
    setTimeout(function(){ bar.hidden=true; },400);
  }
  timer=setTimeout(hide,10000);
  var x=el('supportClose'); if(x) x.addEventListener('click',hide);
  var d=el('supportDonate'); if(d) d.addEventListener('click',function(){
    hide();
    var f=el('donateFooter');
    if(f){
      setTimeout(function(){
        f.scrollIntoView({behavior:'smooth',block:'start'});
        f.classList.add('donate-flash');
        setTimeout(function(){ f.classList.remove('donate-flash'); },1800);
      },120);
    }
  });
})();
/* copiar correo de Zelle y número de Nequi */
document.addEventListener('click',function(e){
  var b=e.target.closest?e.target.closest('[data-copy]'):null; if(!b) return;
  var v=b.getAttribute('data-copy');
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(v).then(function(){ toast('Copiado: '+v); }).catch(function(){ toast(v); }); }
  else toast(v);
});

/* ---------- FIX-PREMIUM-ALIGN (Tiger 2026-09-27) ----------
   El link-code guarda en localStorage el uid DE LA APP, pero el navegador
   escribe con su uid ANONIMO. Las reglas exigen premium_uids/{request.auth.uid}.
   Esta funcion marca el uid propio del navegador tras validar el codigo. */
async function rlAlignPremiumUid(linkedUid){
  try{
    var luid = linkedUid || null;
    try{ luid = luid || localStorage.getItem('rl_premium_uid'); }catch(e){}
    if(!luid) return false; /* gratis sin vinculo: cero lecturas extra */
    if(!(await fbInit())) return false;
    await ensureSignedIn();
    var me = (typeof auth!=='undefined' && auth.currentUser) ? auth.currentUser.uid : null;
    if(!me) return false;
    var mine = await db.collection('premium_uids').doc(me).get();
    if(mine.exists && mine.data().premium === true) return true; /* ya alineado */
    var p = await db.collection('premium_uids').doc(luid).get();
    if(!p.exists || p.data().premium !== true) return false;
    await db.collection('premium_uids').doc(me).set({
      premium: true,
      vinculadoDe: luid,
      origen: 'web-link',
      creado: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  }catch(e){ return false; }
}

/* ---------- arranque del chat ---------- */
async function initChat(){
  if(chatStarted) return; chatStarted=true;
  var ok=await fbInit(); if(!ok) return;
  await ensureSignedIn();
  await rlAlignPremiumUid(null); /* FIX-PREMIUM-ALIGN: autocura navegadores ya vinculados */
  subscribeGeneral(); renderMyRooms();
}

/* ---------- init ---------- */
initCatalog();
rlInitGlobe();
rlInitSpaceFx();
rlInitGlobeFx();
/* tema guardado (el <head> ya lo aplicó para evitar flash; aquí se sincroniza el botón) */
(function(){ var t='auto'; try{ t=localStorage.getItem(THEME_KEY)||'auto'; }catch(e){} applyTheme(t); })();
/* temporizador: rearmar si sobrevivió una recarga */
(function(){
  try{
    var se=parseInt(localStorage.getItem(SLEEP_KEY)||'0',10);
    if(se>Date.now()){ rlSleepEndsAt=se; rlSleepTimer=setTimeout(fireSleep,se-Date.now()); ensureSleepPoll(); refreshSleepUI(); }
  }catch(e){}
})();
loadAvisos();
renderResume();
renderHistoryRow();

/* Contador de visitas del portal (footer). Va DENTRO del IIFE principal:
   usa fbInit()/db (no son globales). */
(function(){
  try{
    var el = document.getElementById('visitCount');
    if(!el || !window.firebase) return;
    fbInit().then(function(ok){
      if(!ok || !db) return;
      var ref = db.doc('estadisticas/visitas');
      /* La regla Firestore solo permite: crear con total==1, o actualizar con total==anterior+1.
         Por eso se lee primero y se escribe el valor literal (sin FieldValue.increment). */
      ref.get().then(function(s){
        if(!s.exists){ return ref.set({total: 1}).then(function(){ return 1; }); }
        var t = (s.data().total || 0) + 1;
        return ref.update({total: t}).then(function(){ return t; });
      }).then(function(t){
        el.textContent = '\uD83D\uDC65 ' + Number(t).toLocaleString('es-CO') + ' visitas';
      }).catch(function(){});
    });
  }catch(e){}
})();

/* BLOQUE 1B v3 — Envío del formulario "Agrega tu emisora" (portal).
   Pegar AL FINAL de app.js (una sola vez).
   v3: ya NO asume que db esté inicializado; llama a fbInit() (global en app.js)
   dentro del submit, así el botón funciona aunque el usuario nunca haya abierto el chat.
   Plan Spark (sin bucket): el logo por archivo no se sube; se guarda logo_url
   (la URL que pegó el dueño) o '' y el portal/app muestran un placeholder.
   Si en el futuro hay bucket Blaze: inicializar storage y subir a logos_pendientes/<id>.png */
(function(){
  var form=document.getElementById('ae-form');
  if(!form) return;
  if(form.dataset.aeWired) return;
  form.dataset.aeWired='1';
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var msg=document.getElementById('ae-msg');
    function v(id){ var el=document.getElementById(id); return el?el.value.trim():''; }
    var url=v('ae-url');
    if(/youtube\.com|youtu\.be|twitch\.tv|tiktok\.com/i.test(url)){
      msg.textContent='Necesitamos el link de audio directo, no el del video.';
      return;
    }
    var logoUrl=v('ae-logo-url');
    if(logoUrl && !/^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(logoUrl)){
      msg.textContent='La URL del logo no parece una imagen válida.';
      return;
    }
    msg.textContent='Enviando...';
    try{
      if(!(await fbInit())){ msg.textContent='Sin conexión. Intenta de nuevo.'; return; }
      var id='p'+Date.now().toString(36);
      var fileEl=document.getElementById('ae-logo');
      var file=fileEl&&fileEl.files?fileEl.files[0]:null;
      if(file && (file.type.indexOf('image/')!==0||file.size>2*1024*1024)){
        throw new Error('Logo inválido (imagen, máx 2MB).');
      }
      await db.collection('emisoras_pendientes').doc(id).set({
        nombre:v('ae-nombre'),
        stream_url:url,
        logo_url:logoUrl||'',
        pais:v('ae-pais'),
        ciudad:v('ae-ciudad'),
        genero:v('ae-genero'),
        estado:'pendiente',
        creado:firebase.firestore.FieldValue.serverTimestamp()
      });
      msg.textContent='¡Gracias! Tu emisora está en revisión.';
      form.reset();
    }catch(err){
      msg.textContent='Error: '+(err&&err.message?err.message:'desconocido');
    }
  });
})();
/* ===== PODCASTS v1 (dentro del IIFE principal: ve fbInit/db/toast/playStation) ===== */
/* ===== PODCASTS v1 — Espacio Podcasts aditivo (portal). Luz verde de Tiger 2026-09-27 ~02:22.
   Fix scope 2026-09-27 ~05:50 (causa raíz de Tiger): el bloque vive DENTRO del IIFE principal;
   antes era un IIFE hermano donde fbInit/db no existían -> ReferenceError tragado por el catch.
   Fix race fbInit 2026-09-27 (hipótesis de Tiger, verificada en el código): fbInit race-safe con promesa en
   vuelo (espeja el patrón signInPromise: "si hay un init en curso, devolverla") + cinturón contra duplicate-app;
   la promesa se reinicia en el catch para permitir reintento real; podLoaded=true solo tras éxito, así un
   fallo transitorio reintenta al siguiente clic en vez de dejar la sección en 0 para siempre.
   100% aditivo: no toca radio/chat/emisoras/premium. Logo D2 Rosa Fuego elegido por Jeremy.
   Datos: colección Firestore `podcasts` (solo aprobado==true). Sin aprobados -> estado vacío con CTA. NADA inventado.
   Plan Spark (sin Storage): portadas por URL (igual que logos de emisoras). Reglas Firestore: preparadas aparte,
   NO publicadas sin el OK directo de Jeremy (límite duro acordado con Tiger).
   Episodios: array `episodios` del doc (RSS parseado en la aprobación; refresco por script/Cloud Function).
   La reproducción reutiliza el reproductor actual (fase 1). */
  var PODCASTS=[], podQ='', podCat='';
  var POD_CATS=['Todos','Noticias','Deportes','Historia','Humor','Música','Misterio','Religiosos','Motivación','Otra'];
  var D2='assets/logos/podcast-d2-rosa-fuego.svg';
  var podLoaded=false;

  function pel(id){ return document.getElementById(id); }
  function pes(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function podInitials(t){ var w=String(t||'?').trim().split(/\s+/); return ((w[0]||'?').charAt(0)+(w[1]?w[1].charAt(0):'')).toUpperCase(); }

  function podCardHTML(p){
    var port=p.portada_url||'';
    var cover=port
      ? '<span class="pod-fallback">'+pes(podInitials(p.titulo))+'</span><img src="'+pes(port)+'" alt="" loading="lazy" onerror="this.remove()">'
      : '<span class="pod-fallback">'+pes(podInitials(p.titulo))+'</span>';
    var eps=(p.episodios&&p.episodios.length)?p.episodios.length:0;
    var meta=eps?(eps+(eps===1?' episodio':' episodios')):'Próximamente';
    return '<button class="pod-card" data-pod="'+pes(p.id)+'">'+
      '<span class="pod-cover">'+cover+
      '<span class="pod-play"><span class="pp">▶</span></span>'+
      '<span class="pod-cat">'+pes(p.categoria||'Podcast')+'</span></span>'+
      '<span class="pod-body"><b>'+pes(p.titulo)+'</b><small>'+pes(meta)+'</small></span>'+
    '</button>';
  }

  function applyPodFilters(){
    var q=podQ.trim().toLowerCase();
    var list=PODCASTS.filter(function(p){
      if(podCat&&podCat!=='Todos'&&String(p.categoria||'')!==podCat) return false;
      if(q&&(String(p.titulo||'')+' '+String(p.descripcion||'')).toLowerCase().indexOf(q)===-1) return false;
      return true;
    });
    var grid=pel('podGrid'), empty=pel('podEmpty');
    if(!grid||!empty) return;
    grid.innerHTML=list.map(podCardHTML).join('');
    empty.hidden=list.length>0;
    grid.querySelectorAll('.pod-card').forEach(function(c){
      c.addEventListener('click',function(){ openPodDetail(c.getAttribute('data-pod')); });
    });
  }

  function renderPodChips(){
    var box=pel('podCatChips'); if(!box||box.dataset.podWired) return; box.dataset.podWired='1';
    box.innerHTML='';
    POD_CATS.forEach(function(c,i){
      var b=document.createElement('button');
      b.className='chip'+(i===0?' active':''); b.type='button'; b.textContent=c;
      b.addEventListener('click',function(){
        podCat=(c==='Todos')?'':c;
        box.querySelectorAll('.chip').forEach(function(x){ x.classList.remove('active'); });
        b.classList.add('active');
        applyPodFilters();
      });
      box.appendChild(b);
    });
    var q=pel('pq');
    if(q&&!q.dataset.podWired){ q.dataset.podWired='1'; q.addEventListener('input',function(){ podQ=q.value; applyPodFilters(); }); }
  }

  async function loadPodcasts(){
    if(podLoaded) return;
    renderPodChips();
    try{
      if(!(await fbInit())) throw new Error('sin conexión');
      var snap=await db.collection('podcasts').where('aprobado','==',true).get();
      PODCASTS=[];
      snap.forEach(function(d){ var x=d.data()||{}; x.id=d.id; PODCASTS.push(x); });
      PODCASTS.sort(function(a,b){ return String(a.titulo||'').localeCompare(String(b.titulo||'')); });
      podLoaded=true; /* solo tras éxito: un fallo transitorio reintenta al siguiente clic (race fbInit 2026-09-27) */
    }catch(e){ if(window.console&&console.error)console.error('[podcasts] loadPodcasts:',e); PODCASTS=[]; }
    applyPodFilters();
  }

  function openPodDetail(id){
    var p=null; for(var i=0;i<PODCASTS.length;i++) if(PODCASTS[i].id===id) p=PODCASTS[i];
    if(!p) return;
    var d=pel('podDetail'); if(!d) return;
    pel('pdCover').src=p.portada_url||D2;
    pel('pdCover').onerror=function(){ this.onerror=null; this.src=D2; };
    pel('pdTitle').textContent=p.titulo||'';
    var eps=p.episodios||[];
    pel('pdMeta').textContent=(p.categoria||'Podcast')+(eps.length?(' · '+eps.length+(eps.length===1?' episodio':' episodios')):'');
    pel('pdDesc').textContent=p.descripcion||'';
    var box=pel('pdEps'); box.innerHTML='';
    if(!eps.length){ box.innerHTML='<p class="muted">Aún no hay episodios publicados para este podcast.</p>'; }
    eps.forEach(function(ep,i){
      var b=document.createElement('button');
      b.className='pod-ep'; b.type='button';
      b.innerHTML='<span class="ep-play">▶</span><span class="ep-info"><b>'+pes(ep.titulo||('Episodio '+(i+1)))+'</b><small>'+pes(ep.fecha||'')+(ep.duracion?(' · '+pes(ep.duracion)):'')+'</small></span>';
      (function(ep2){ b.addEventListener('click',function(){ playPodcastEpisode(p,ep2); }); })(ep);
      box.appendChild(b);
    });
    d.hidden=false;
    d.scrollIntoView({behavior:'smooth',block:'start'});
  }

  /* Reutiliza el reproductor actual (fase 1): el episodio es audio directo. */
  function playPodcastEpisode(p,ep){
    playStation({
      name:(p.titulo||'Podcast')+' · '+(ep.titulo||'Episodio'),
      stream:ep.audio,
      logo:p.portada_url||'',
      genre:'Podcast',
      city:'',
      country:p.categoria||'',
      _podcast:true
    });
    toast('🎙️ Reproduciendo: '+(ep.titulo||'Episodio'));
  }

  /* Navegación: cargar podcasts al abrir la página */
  document.querySelectorAll('[data-nav="podcasts"]').forEach(function(b){
    b.addEventListener('click',function(){ loadPodcasts(); });
  });
  var pdc=pel('podDetailClose');
  if(pdc) pdc.addEventListener('click',function(){ pel('podDetail').hidden=true; });

  /* Página "Agrega tu podcast" (misma pauta que "Agrega tu emisora") */
  function openAgregaPodcast(){
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    var sec=pel('agrega-podcast'); if(sec) sec.classList.add('active');
    document.querySelectorAll('[data-nav]').forEach(function(b){ b.classList.remove('active'); });
    var a=pel('navAgregaPod'); if(a) a.classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
    if(window.fbInit) fbInit();
  }
  ['podGoAgrega','podGoAgrega2'].forEach(function(id){
    var b=pel(id); if(b) b.addEventListener('click',openAgregaPodcast);
  });
  var nap=pel('navAgregaPod');
  if(nap) nap.addEventListener('click',function(e){ e.preventDefault(); openAgregaPodcast(); });

  /* Envío del formulario "Agrega tu podcast" (portal).
     Colección: podcasts_pendientes (Jeremy aprueba en 1 clic desde Pendientes).
     Plan Spark (sin Storage): portada por URL, igual que el logo de emisoras.
     RSS preferido o MP3 directo; YouTube/Twitch/TikTok rechazados (orden de Jeremy). */
  var form=pel('ap-form');
  if(form&&!form.dataset.apWired){
    form.dataset.apWired='1';
    form.addEventListener('submit',async function(e){
      e.preventDefault();
      var msg=pel('ap-msg');
      function v(id){ var x=pel(id); return x?x.value.trim():''; }
      var feed=v('ap-rss');
      if(/youtube\.com|youtu\.be|twitch\.tv|tiktok\.com/i.test(feed)){
        msg.textContent='Necesitamos el link del RSS o del MP3 directo, no el del video.';
        return;
      }
      var port=v('ap-portada-url');
      if(port&&!/^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(port)){
        msg.textContent='La URL de la portada no parece una imagen válida.';
        return;
      }
      msg.textContent='Enviando...';
      try{
        if(!(await fbInit())){ msg.textContent='Sin conexión. Intenta de nuevo.'; return; }
        var id='pod'+Date.now().toString(36);
        await db.collection('podcasts_pendientes').doc(id).set({
          titulo:v('ap-titulo'),
          rss_url:feed,
          portada_url:port||'',
          categoria:v('ap-categoria'),
          descripcion:v('ap-descripcion'),
          estado:'pendiente',
          creado:firebase.firestore.FieldValue.serverTimestamp()
        });
        msg.textContent='¡Gracias! Tu podcast está en revisión.';
        form.reset();
      }catch(err){ msg.textContent='Error: '+(err&&err.message?err.message:'desconocido'); }
    });
  }

/* FIX 2026-11-14 — el IIFE principal NO se cerraba aquí: el cierre prematuro
   dejaba fuera del ámbito a la sala, el globo y el menú (el/STATIONS/db no
   existían ahí) y el ReferenceError en rlInitGlobe abortaba todo app.js.
   El cierre se movió al final del archivo. */

(function(){
  var a=document.getElementById('navAgrega');
  if(!a) return;
  a.addEventListener('click',function(e){
    e.preventDefault();
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    var sec=document.getElementById('agrega-emisora');
    if(sec) sec.classList.add('active');
    document.querySelectorAll('[data-nav]').forEach(function(b){ b.classList.remove('active'); });
    a.classList.add('active');
    window.scrollTo({top:0,behavior:'smooth'});
    if(window.fbInit) fbInit();
  });
})();

/* ===== CONTADOR-ANIM v1: el número sube contando (0 -> N) al cargar =====
   Pegar AL FINAL de app.js (una sola vez). 100% aditivo: solo observa el
   #visitCount y anima cuando llega el número real. Si Firebase falla, no hace nada. */
(function(){
  var el=document.getElementById('visitCount');
  if(!el||!('MutationObserver' in window)||!window.requestAnimationFrame) return;
  var done=false;
  function fmt(n){ try{return Number(n).toLocaleString('es-CO');}catch(e){return String(n);} }
  function animate(to){
    var t0=null,dur=1100;
    function step(ts){
      if(!t0) t0=ts;
      var p=Math.min(1,(ts-t0)/dur),e=1-Math.pow(1-p,3);
      el.innerHTML='\uD83D\uDC65 <b class="vc-num">'+fmt(Math.round(to*e))+'</b> visitas';
      if(p<1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  new MutationObserver(function(){
    if(done) return;
    var m=el.textContent.match(/(\d[\d.]*)/);
    if(m){ done=true; animate(parseInt(m[1].replace(/\./g,''),10)||0); }
  }).observe(el,{childList:true,characterData:true,subtree:true});
})();


/* PREMIUM-UX v1 (JS) — Experiencia premium inmediata post-código. Pegar al FINAL de app.js (una sola vez). */
(function(){
  function applyPremiumTheme(){
    if(document.body.classList.contains('rl-premium')) return;
    document.body.classList.add('rl-premium');
    if(!document.getElementById('rlPremiumBadge')){
      var brand=document.querySelector('.topbar .brand');
      if(brand) brand.insertAdjacentHTML('afterend','<span id="rlPremiumBadge" class="rl-premium-badge">'+SVG_CROWN+' PREMIUM</span>');
    }
  }
  function premiumWelcome(){
    applyPremiumTheme();
    try{ if(typeof closeModal==='function') closeModal('premiumModal'); }catch(e){}
    if(document.getElementById('rlPremiumOverlay')) return;
    var ov=document.createElement('div');
    ov.id='rlPremiumOverlay';
    ov.innerHTML='<div class="rl-ov-card"><span class="rl-ov-crown">👑</span><h2>¡Ya eres <span>Premium</span>!</h2><p>Tu código quedó vinculado en este navegador.</p><p>Ya puedes enviar mensajes privados en el chat.</p><div class="rl-ov-tap">Toca para continuar</div></div>';
    function dismiss(){ if(!ov.parentNode) return; ov.classList.add('rl-ov-out'); setTimeout(function(){ ov.remove(); },320); }
    ov.addEventListener('click',dismiss);
    setTimeout(dismiss,4500);
    document.body.appendChild(ov);
  }
  /* El handler existente escribe "Premium vinculado" en #linkCodeMsg al vincular: lo observamos. */
  function watchLink(){
    var msg=document.getElementById('linkCodeMsg');
    if(!msg||!window.MutationObserver) return;
    new MutationObserver(function(){
      if(/premium vinculado/i.test(msg.textContent||'')) premiumWelcome();
    }).observe(msg,{childList:true,characterData:true,subtree:true});
  }
  /* Al cargar: si ya había un código vinculado y sigue vigente, recuperar el tema premium. */
  function restorePremium(){
    try{
      var uid=null; try{ uid=localStorage.getItem('rl_premium_uid'); }catch(e){}
      if(!uid||typeof rlIsPremiumWeb!=='function') return;
      rlIsPremiumWeb().then(function(ok){ if(ok) applyPremiumTheme(); }).catch(function(){});
    }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ watchLink(); restorePremium(); });
  else { watchLink(); restorePremium(); }

})();

/* ================= SALA DE EMISORA (portal) =================
 * Misma sala que la app: stableId = SHA-256("nombre|ciudad|codigo"),
 * 12 hex, prefijo st_. Ruta: salas_emisora/{stableId}/messages.
 * En el portal se usa Web Crypto (async); la app usa el puente nativo.
 * Ambos dan el mismo id para la misma emisora.
 */
function rlSalaStableId(station){
  var txt = (station.name||'') + '|' + (station.city||'') + '|' + (station.code||'');
  var data = new TextEncoder().encode(txt);
  return crypto.subtle.digest('SHA-256', data).then(function(hash){
    var hex = Array.prototype.map.call(new Uint8Array(hash), function(b){
      return ('0'+b.toString(16)).slice(-2);
    }).join('');
    return 'st_' + hex.slice(0, 12);
  }).catch(function(){ return null; });
}

var salaUnsub = null, currentSala = null;

/* FIX-SALA-PORTAL-VISIBLE 2026-09-27: la sala se abre como overlay modal
   VISIBLE sobre la vista actual, en el contexto de la emisora que suena.
   Jeremy: "tiene que ser visible, la gente no se va a poner a buscarlo".
   No se navega a otra sección: el usuario sigue donde estaba escuchando. */
function salaEnsureOverlay(){
  if(document.getElementById('salaOverlayCSS')) return;
  var st = document.createElement('style');
  st.id = 'salaOverlayCSS';
  st.textContent =
    '#salaBackdrop{position:fixed;inset:0;background:rgba(0,0,0,.65);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);z-index:9998;}'
    + '#salaView.sala-modal{position:fixed;z-index:9999;top:50%;left:50%;transform:translate(-50%,-50%);'
    + 'width:min(520px,calc(100vw - 32px));max-height:min(86vh,720px);display:flex;flex-direction:column;margin:0;}'
    + '#salaView.sala-modal #salaMsgs{flex:1;overflow-y:auto;min-height:220px;}';
  document.head.appendChild(st);
  var bd = document.createElement('div');
  bd.id = 'salaBackdrop';
  bd.hidden = true;
  bd.addEventListener('click', function(){ closeSalaView(); });
  document.body.appendChild(bd);
  /* FIX-TIGER #pbSala 2026-09-27: #salaView vive anidado en #panePriv
     (pestana oculta, display:none). Un position:fixed NO escapa de un
     ancestro con display:none, asi que el modal nunca se veia en el
     telefono. Se saca #salaView a nivel de body una sola vez. */
  var sv = document.getElementById('salaView');
  if(sv && sv.parentNode !== document.body) document.body.appendChild(sv);
}
function openSalaEmisora(stableId, nombre){
  closeSala();
  currentSala = {stableId: stableId, nombre: nombre};
  salaEnsureOverlay();
  var sv = el('salaView'), bd = el('salaBackdrop');
  sv.classList.add('sala-modal');
  el('salaName').textContent = nombre;
  if(bd) bd.hidden = false;
  sv.hidden = false;
  document.body.style.overflow = 'hidden';
  subscribeSala(stableId);
  setTimeout(function(){ try{ el('salaInput').focus(); }catch(e){} }, 120);
}
function subscribeSala(stableId){
  var box = el('salaMsgs');
  try{
    salaUnsub = db.collection('salas_emisora').doc(stableId).collection('messages')
      .orderBy('createdAt','desc').limit(60).onSnapshot(function(snap){
        var docs = [], mine = rlChatProfile().nick;
        snap.forEach(function(d){ docs.push(d); });
        var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        box.innerHTML = docs.length
          ? docs.reverse().map(function(d){ return msgHTML(d, mine); }).join('')
          : '<div class="chat-empty">Sé la primera persona en saludar en la sala. 👋</div>';
        if(nearBottom) box.scrollTop = box.scrollHeight;
      }, function(){ toast('No se pudo cargar la sala.'); closeSalaView(); });
  }catch(e){ toast('No se pudo cargar la sala.'); }
}
function closeSala(){
  if(salaUnsub){ try{ salaUnsub(); }catch(e){} salaUnsub = null; }
  currentSala = null;
}
function closeSalaView(){
  closeSala();
  var sv = el('salaView'), bd = el('salaBackdrop');
  sv.hidden = true;
  sv.classList.remove('sala-modal');
  if(bd) bd.hidden = true;
  document.body.style.overflow = '';
}
el('salaClose').addEventListener('click', closeSalaView);
el('salaForm').addEventListener('submit', async function(e){
  e.preventDefault();
  var text = el('salaInput').value.trim().slice(0, 500);
  if(!text || !currentSala) return;
  if(!(await ensureSignedIn())) return;
  try{
    var prof = rlChatProfile();
    await db.collection('salas_emisora').doc(currentSala.stableId).collection('messages').add({
      texto: text, apodo: prof.nick||'Oyente', sexo: prof.sexo||'X',
      pais: prof.pais||rlDetectCountry(), uid: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    el('salaInput').value = '';
  }catch(err){ toast('No se pudo enviar el mensaje.'); }
});

/* Botón "Sala en vivo" en el reproductor */
el('pbSala').addEventListener('click', function(){
  if(!current) return;
  var st = current;
  rlSalaStableId(st).then(function(sid){
    if(!sid){ toast('La sala estará disponible en un momento.'); return; }
    openSalaEmisora(sid, st.name || 'Sala en vivo');
  });
});

/* Puntos verdes: emisoras con actividad reciente en su sala */
var _salaVerdeCache = {};
function rlPintarSalasVerdes(){
  if(!db) return;
  document.querySelectorAll('.station-card').forEach(function(card){
    var name = card.getAttribute('data-st');
    var st = findStation(name);
    if(!st) return;
    rlSalaStableId(st).then(function(sid){
      if(!sid) return;
      var c = _salaVerdeCache[sid];
      var now = Date.now();
      if(c && now - c.ts < 60000){ if(c.n > 0) card.classList.add('tiene-sala'); return; }
      var hace = new Date(now - 10*60*1000);
      db.collection('salas_emisora').doc(sid).collection('messages')
        .where('createdAt','>',hace).limit(1).get().then(function(snap){
          _salaVerdeCache[sid] = {ts: now, n: snap.size};
          if(snap.size > 0) card.classList.add('tiene-sala');
          else card.classList.remove('tiene-sala');
        }).catch(function(){});
    });
  });
}

/* ================= GLOBO 3D EN VIVO (MapLibre + NASA GIBS Blue Marble) =================
   Globo real como el de la app: proyección globo, teselas Blue Marble de la NASA,
   puntos celestes por ciudad (desde stations.json) y marcador amarillo de la
   emisora que suena. Si la red externa falla, se muestra el respaldo honesto
   del index.html y nada se inventa. */
var RL_GLOBE_MAP=null, rlGlobeData=null, rlGlobeTunedMarker=null;
var rlGlobeSpinOn=false, rlGlobeSpinRaf=null, rlGlobeSpinLast=0, rlGlobeHoldUntil=0;
var rlGlobeVisible=true, rlGlobeInView=true, rlGlobeInitStarted=false, rlGlobeLoadTimer=null, rlGlobeTipTimer=null;

/* Centro de cada país (lon, lat) — respaldo cuando la ciudad no tiene coordenada propia. */
var RL_COUNTRY_CENTER={AR:[-63.6,-35.4],BO:[-63.6,-16.3],BR:[-51.9,-14.2],CL:[-70.7,-30.0],CO:[-74.3,4.6],CR:[-83.8,9.7],CU:[-79.5,21.5],DO:[-70.2,18.7],EC:[-78.5,-1.4],ES:[-3.7,40.2],GT:[-90.3,15.5],HN:[-86.8,15.2],MX:[-102.6,23.6],NI:[-85.2,12.9],PA:[-80.8,8.5],PE:[-75.0,-9.2],PR:[-66.6,18.2],PY:[-58.4,-23.4],SV:[-88.9,13.7],US:[-98.6,39.8],UY:[-56.0,-32.5],VE:[-66.6,6.4]};
/* Ciudades con más emisoras (lon, lat). Clave: "ciudad|código de país". */
var RL_CITY_COORDS={
'Ciudad de México|MX':[-99.13,19.43],'Bogotá|CO':[-74.08,4.71],'Lima|PE':[-77.04,-12.05],
'Santo Domingo|DO':[-69.90,18.47],'California|US':[-119.42,36.78],'São Paulo|BR':[-46.63,-23.55],
'Sao Paulo|BR':[-46.63,-23.55],'Sao Paulo (Brazil)|BR':[-46.63,-23.55],'Medellín|CO':[-75.57,6.24],
'Buenos Aires|AR':[-58.38,-34.60],'Cali|CO':[-76.52,3.45],'Cali, Valle del Cauca|CO':[-76.52,3.45],
'Madrid|ES':[-3.70,40.42],'Monterrey|MX':[-100.32,25.67],'Barranquilla|CO':[-74.80,11.00],
'Santiago|CL':[-70.67,-33.45],'San Salvador|SV':[-89.22,13.69],'Virginia|US':[-78.66,37.43],
'La Paz|BO':[-68.15,-16.50],'Manizales|CO':[-75.51,5.07],'Rio Grande do Sul|BR':[-51.23,-30.03],
'San José|CR':[-84.09,9.93],'Cochabamba|BO':[-66.16,-17.39],'Montevideo|UY':[-56.16,-34.90],
'Ciudad Autonoma de Buenos Aires|AR':[-58.38,-34.60],'Minas Gerais|BR':[-43.94,-19.92],
'Rio de Janeiro|BR':[-43.21,-22.91],'San Juan|PR':[-66.06,18.47],'Florida|US':[-81.76,28.63],
'Bucaramanga|CO':[-73.12,7.12],'Cartagena|CO':[-75.51,10.40],'Ibagué|CO':[-75.23,4.44],
'Nuevo León|MX':[-100.32,25.67],'Guadalajara|MX':[-103.35,20.67],'Cúcuta|CO':[-72.51,7.89],
'Pereira|CO':[-75.69,4.81],'Pichincha|EC':[-78.51,-0.22],'Ciudad de Guatemala|GT':[-90.51,14.63],
'Distrito Federal|MX':[-99.13,19.43],'Torreón|MX':[-103.44,25.54],'Tampico|MX':[-97.86,22.23],
'Concepción|CL':[-73.04,-36.82],'Baja California|MX':[-114.80,29.50],'Arequipa|PE':[-71.54,-16.41],
'New York|US':[-74.01,40.71],'Armenia|CO':[-75.68,4.54],'Montería|CO':[-75.88,8.75],
'Rosario|AR':[-60.65,-32.95],'Valparaíso|CL':[-71.63,-33.05],'San Luis Potosí|MX':[-100.98,22.15],
'Veracruz|MX':[-96.13,19.20],'Catalunya|ES':[2.17,41.39],'Neiva|CO':[-75.28,2.94],
'Popayán|CO':[-76.61,2.44],'Puerto Vallarta|MX':[-105.23,20.62],'Mexicali|MX':[-115.45,32.62],
'Puebla|MX':[-98.21,19.04],'Chihuahua|MX':[-106.08,28.63],'Aguascalientes|MX':[-102.30,21.88],
'azuay|EC':[-79.00,-2.90],'Amazonas|PE':[-77.87,-6.23],'Caracas|VE':[-66.90,10.49],
'Quito|EC':[-78.51,-0.22],'La Habana|CU':[-82.37,23.11],'Santa Fe|AR':[-60.70,-31.63],
'Asuncion|PY':[-57.64,-25.26],'Pasto|CO':[-77.28,1.21],'León|MX':[-101.68,21.12],
'Antioquia|CO':[-75.57,6.24],'Nariño|CO':[-77.28,1.21],'Villavicencio|CO':[-73.64,4.15],
'Córdoba(Argentina)|AR':[-64.18,-31.42],'Provincia de Buenos Aires|AR':[-57.95,-34.92],
'Distrito Federal|BR':[-47.88,-15.79],'Pernambuco|BR':[-34.90,-8.05],'Tunja|CO':[-73.36,5.54],
'Acapulco|MX':[-99.89,16.85],'Villahermosa|MX':[-92.93,17.99],'Querétaro|MX':[-100.39,20.59],
'Mazatlán|MX':[-106.41,23.25],'Ensenada|MX':[-116.60,31.87],'Ciudad Juárez|MX':[-106.49,31.74],
'Culiacán|MX':[-107.39,24.80],'Tijuana|MX':[-117.04,32.51],'Atacama|CL':[-70.33,-27.37],
'Santiago de los Caballeros|DO':[-70.70,19.45],'Málaga|ES':[-4.42,36.72]
};
function rlHashStr(s){ var h=2166136261; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0); }
function rlCityCoords(city,country,code){
  var key=(city||'')+'|'+(code||'');
  if(RL_CITY_COORDS.hasOwnProperty(key)) return RL_CITY_COORDS[key];
  var c=RL_COUNTRY_CENTER[code]||[-70,0];
  if(!city) return c;
  var h=rlHashStr(key);
  var dl=((h%1000)/1000-0.5)*7;
  var da=(((Math.floor(h/1000)%1000)/1000)-0.5)*5;
  return [c[0]+dl, Math.max(-56,Math.min(58,c[1]+da))];
}
/* Un punto por ciudad (con su conteo de emisoras): 462 puntos, liviano. */
function rlGlobeGeoJSON(){
  var groups={}, order=[];
  STATIONS.forEach(function(s){
    var k=(s.city||'')+'|'+(s.country||'')+'|'+(s.code||'');
    if(!groups[k]){ groups[k]={city:s.city||'',country:s.country||'',code:s.code||'',count:0}; order.push(k); }
    groups[k].count++;
  });
  var feats=order.map(function(k){
    var g=groups[k], ll=rlCityCoords(g.city,g.country,g.code);
    return {type:'Feature',geometry:{type:'Point',coordinates:ll},properties:{city:g.city,country:g.country,code:g.code,count:g.count,label:g.city||g.country}};
  });
  return {type:'FeatureCollection',features:feats};
}
function rlGlobeSetStations(){
  rlGlobeData=rlGlobeGeoJSON();
  if(RL_GLOBE_MAP&&RL_GLOBE_MAP.getSource('rl-stations')){ RL_GLOBE_MAP.getSource('rl-stations').setData(rlGlobeData); }
}
/* Ir a Radio filtrado por la ciudad tocada en el globo. */
function rlGoCity(country,city){
  filters.country=country||''; filters.city=city||'';
  resetRefine(); syncCountryChips(); renderCities(country||''); applyFilters(); go('radio');
}
function rlGlobeDot(a,b){
  function v(p){ var la=p.lat*Math.PI/180, lo=p.lng*Math.PI/180; return [Math.cos(la)*Math.cos(lo),Math.cos(la)*Math.sin(lo),Math.sin(la)]; }
  var A=v(a), B=v(b); return A[0]*B[0]+A[1]*B[1]+A[2]*B[2];
}
function rlGlobeUpdateTunedVisibility(){
  if(!rlGlobeTunedMarker||!RL_GLOBE_MAP) return;
  var dot=rlGlobeDot(RL_GLOBE_MAP.getCenter(), rlGlobeTunedMarker.getLngLat());
  rlGlobeTunedMarker.getElement().style.display=dot>0.02?'block':'none';
}
function rlGlobeShowTuned(s){
  if(!RL_GLOBE_MAP||!window.maplibregl||!s) return;
  var ll=rlCityCoords(s.city,s.country,s.code);
  if(!rlGlobeTunedMarker){
    var d=document.createElement('div'); d.className='globe-tuned-marker';
    rlGlobeTunedMarker=new maplibregl.Marker({element:d,anchor:'center'}).setLngLat(ll).addTo(RL_GLOBE_MAP);
  } else { rlGlobeTunedMarker.setLngLat(ll); }
  rlGlobeUpdateTunedVisibility();
}
function rlGlobeClearTuned(){
  if(rlGlobeTunedMarker){ try{ rlGlobeTunedMarker.remove(); }catch(e){} rlGlobeTunedMarker=null; }
}
function rlGlobeHold(){ rlGlobeHoldUntil=Date.now()+5000; }
function rlGlobeSpinTick(ts){
  if(!RL_GLOBE_MAP){ rlGlobeSpinRaf=null; return; }
  var now=ts||0;
  if(rlGlobeSpinOn&&rlGlobeVisible&&rlGlobeInView&&now>rlGlobeHoldUntil){
    var dt=Math.min(60,now-(rlGlobeSpinLast||now));
    rlGlobeSpinLast=now;
    var c=RL_GLOBE_MAP.getCenter();
    RL_GLOBE_MAP.setCenter([c.lng+dt*0.0012,c.lat]);
    rlGlobeUpdateTunedVisibility();
  } else { rlGlobeSpinLast=now; }
  rlGlobeSpinRaf=requestAnimationFrame(rlGlobeSpinTick);
}
function rlGlobeFail(){
  var fb=el('globeFallback'); if(fb) fb.hidden=false;
  var m=el('globeMap'); if(m) m.style.display='none';
  var tip=el('globeTip'); if(tip) tip.hidden=true;
}
function rlLoadScript(src){
  return new Promise(function(res,rej){
    var s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=function(){ rej(new Error('script')); };
    document.head.appendChild(s);
  });
}
/* Radio del disco terrestre en proyección globo: R = 512·2^zoom/(2π) px.
   Verificado en local: zoom 0.2 → disco ~187 px; zoom -0.1 → ~152 px
   (la Tierra pequeña del teléfono del dueño); zoom 0.6 → ~247 px, que
   RECORTA el globo en un mapa chico (se ve un mapa plano, no un mundo).
   El zoom automático pone el disco a ~87% del lado menor del mapa para
   que la Tierra llene su cuadro con el limbo visible, en cualquier ancho. */
function rlGlobeDiskZoom(){
  var m=el('globeMap'), z=0.2;
  if(m&&m.clientWidth>0&&m.clientHeight>0){
    var side=Math.min(m.clientWidth,m.clientHeight);
    z=Math.log(side*0.435*Math.PI*2/512)/Math.log(2);
    z=Math.max(-0.8,Math.min(1.4,z));
  }
  return z;
}

function rlInitGlobe(){
  if(rlGlobeInitStarted) return; rlGlobeInitStarted=true;
  var wrap=el('globeWrap'); if(!wrap) return;
  function start(){
    if(!window.maplibregl){ rlGlobeFail(); return; }
    var map;
    try{
      map=new maplibregl.Map({
        container:'globeMap',
        style:{
          version:8,
          sources:{
            'rl-blue-marble':{type:'raster',tiles:['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'],tileSize:256,maxzoom:8,attribution:'NASA Blue Marble / GIBS'},
            'rl-stations':{type:'geojson',data:{type:'FeatureCollection',features:[]}}
          },
          layers:[
            {id:'rl-blue-marble',type:'raster',source:'rl-blue-marble'},
            {id:'rl-halo',type:'circle',source:'rl-stations',paint:{'circle-radius':['+', ['interpolate',['linear'],['get','count'],1,2.2,10,2.8,40,3.6,80,4.2], 5],'circle-color':'#00F2FE','circle-opacity':0.16,'circle-blur':1}},
            {id:'rl-core',type:'circle',source:'rl-stations',paint:{'circle-radius':['interpolate',['linear'],['get','count'],1,2.2,10,2.8,40,3.6,80,4.2],'circle-color':'#00F2FE','circle-opacity':0.95,'circle-stroke-width':0.6,'circle-stroke-color':'#ffffff','circle-stroke-opacity':0.7}},
            {id:'rl-touch',type:'circle',source:'rl-stations',paint:{'circle-radius':16,'circle-color':'#ffffff','circle-opacity':0}}
          ]
        },
        center:[-70,10],
        zoom:rlGlobeDiskZoom(),
        minZoom:-1,
        maxZoom:6,
        attributionControl:{compact:true},
        cooperativeGestures:true,
        scrollZoom:false,
        dragRotate:true,
        touchZoomRotate:true,
        fadeDuration:0
      });
    }catch(e){ rlGlobeFail(); return; }
    RL_GLOBE_MAP=map;
    rlGlobeLoadTimer=setTimeout(function(){ if(!map.loaded()) rlGlobeFail(); },15000);
    map.on('load',function(){
      clearTimeout(rlGlobeLoadTimer);
      try{ map.setProjection({type:'globe'}); }catch(e){}
      try{ map.setSky({'sky-color':'#040914','horizon-color':'#0e2a5c','fog-color':'#040914','sky-horizon-blend':0.6,'horizon-fog-blend':0.6,'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,4,0.4]}); }catch(e){}
      if(rlGlobeData) map.getSource('rl-stations').setData(rlGlobeData);
      if(current) rlGlobeShowTuned(current);
      rlGlobeSpinOn=true; rlGlobeSpinLast=(window.performance&&performance.now)?performance.now():0;
      if(!rlGlobeSpinRaf) rlGlobeSpinRaf=requestAnimationFrame(rlGlobeSpinTick);
    });
    map.on('move',function(){ rlGlobeUpdateTunedVisibility(); });
    map.on('mousedown',rlGlobeHold); map.on('touchstart',rlGlobeHold); map.on('wheel',rlGlobeHold);
    map.on('dragstart',rlGlobeHold); map.on('zoomstart',rlGlobeHold);
    map.on('click','rl-touch',function(e){
      if(!e.features||!e.features.length) return;
      var p=e.features[0].properties;
      var tip=el('globeTip'); if(!tip) return;
      tip.textContent=(p.label||p.country)+' · '+p.count+(Number(p.count)===1?' emisora':' emisoras')+' →';
      tip.hidden=false;
      tip.onclick=function(){ tip.hidden=true; rlGoCity(p.country,p.city||''); };
      clearTimeout(rlGlobeTipTimer);
      rlGlobeTipTimer=setTimeout(function(){ tip.hidden=true; },6000);
    });
    map.on('mouseenter','rl-touch',function(){ map.getCanvas().style.cursor='pointer'; });
    map.on('mouseleave','rl-touch',function(){ map.getCanvas().style.cursor=''; });
  }
  function boot(){
    if(window.maplibregl){ start(); return; }
    var l=document.createElement('link'); l.rel='stylesheet'; l.href='https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.css'; document.head.appendChild(l);
    rlLoadScript('https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.js').then(start).catch(function(){ rlGlobeFail(); });
  }
  /* Carga perezosa: el globo arranca cuando se acerca a la vista. */
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(en){ if(en.isIntersecting){ try{ io.disconnect(); }catch(e){} boot(); } });
    },{rootMargin:'200px'});
    io.observe(wrap);
    var io2=new IntersectionObserver(function(es){
      es.forEach(function(en){ rlGlobeInView=en.isIntersecting; });
    });
    io2.observe(wrap);
  } else { boot(); }
  document.addEventListener('visibilitychange',function(){ rlGlobeVisible=!document.hidden; });
}

/* ================= UNIVERSO ALREDEDOR DEL GLOBO (capa espacial) =================
   Canvas #spaceFx detrás del contenido del hero: 2 satélites en órbita alrededor
   del globo emitiendo ondas de radio, 2 planetas a la deriva (1 en móvil) y
   estrellas tenues y escasas. A propósito con menos elementos que en la app
   para que se vea elegante y sin amontonar. pointer-events:none: jamás tapa
   el globo, la pastilla ni ningún control. Se pausa si la pestaña se oculta
   o el hero sale de la vista; con «reducir movimiento» queda una escena fija. */
function rlInitSpaceFx(){
  var cv=el('spaceFx'); if(!cv) return;
  var hero=cv.parentElement; if(!hero) return;
  var ctx=cv.getContext('2d'); if(!ctx) return;
  var reduced=false;
  try{ reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  var W=0,H=0,inView=true,raf=null,last=0,shootAt=9000;
  /* FIX 2026-11-14 — la órbita de AFUERA nunca se recorta tras la cabecera:
     al desplazar, el hero sube y el satélite y el planeta pasaban bajo la
     cabecera fija (.topbar, sticky) y se veían cortados por la mitad.
     Cada cuerpo se desvanece antes de llegar a ella: con su borde superior
     a HDR_ZONE (64 px) o más por debajo del borde inferior de la cabecera
     está entero (opacidad 1); cuando el borde toca la cabecera ya es
     invisible (opacidad 0). El satélite en móvil lleva halo de 34 px y el
     planeta en órbita sobresale r*1.2 con su luna; en escritorio los
     planetas a la deriva se desvanecen por su centro, porque su recorrido
     llega hasta 30 px del borde del hero y con el borde superior se
     apagarían en reposo. Se usa ctx.filter='opacity()' porque el satélite
     y el planeta tocan globalAlpha por dentro (envolverlos con
     globalAlpha no basta); si el navegador no lo soporta, el cuerpo se
     oculta de golpe al llegar a la cabecera. */
  var topbarEl=document.querySelector('.topbar');
  var filterOK=false; try{ filterOK=('filter' in ctx); }catch(e){}
  var HDR_ZONE=64;
  function hdrFadeTop(hrTop,hdrB,y,ext){ var f=(hrTop+y-ext-hdrB)/HDR_ZONE; return f<=0?0:(f>=1?1:f); }
  function hdrFadeCtr(hrTop,hdrB,y){ var f=(hrTop+y-hdrB)/HDR_ZONE; return f<=0?0:(f>=1?1:f); }
  function drawFaded(fade,fn){
    if(fade<=0) return;
    if(fade>=1){ fn(); return; }
    if(filterOK){ ctx.save(); ctx.filter='opacity('+fade.toFixed(3)+')'; fn(); ctx.restore(); }
    else if(fade>=0.5){ fn(); }
  }
  var stars=[],sats=[],planets=[],meteor=null,patch={cx:0,cy:0,r:0};
  function isMob(){ return window.innerWidth<=760; }
  function rnd(a,b){ return a+Math.random()*(b-a); }
  function build(){
    var mob=isMob(),i,n,wr=null;
    var wrap=el('globeWrap'),cx=W/2,cy=H/2,rx=W*0.42,ry=H*0.36;
    var hr=hero.getBoundingClientRect();
    var copyEl=hero.querySelector('.hero-copy');
    var copyR=copyEl?copyEl.getBoundingClientRect():null;
    if(wrap){
      wr=wrap.getBoundingClientRect();
      cx=wr.left-hr.left+wr.width/2; cy=wr.top-hr.top+wr.height/2;
      rx=Math.min(wr.width/2+64,W*0.48); ry=Math.min(wr.height/2+56,H*0.42);
    }
    /* FIX 2026-11-14 — el universo se centra en el PANEL del globo, no en
       el hero completo. Lo roto en móvil: el planeta iba a (W*0.88,H*0.05),
       arriba a la derecha del hero alto, separadísimo del mundo; la órbita
       del satélite era tan ancha (mitad del ancho + 64) que la tarjeta lo
       tapaba casi siempre y solo asomaba un fragmento en el borde; las
       estrellas, 18 en todo el hero y con alfa 0.10–0.32, no se veían.
       Ahora, en móvil: órbita pegada al panel (+22 px), satélite más
       grande, planeta orbitando el panel despacio y estrellas brillantes
       concentradas alrededor del panel. */
    if(mob){
      rx=wr?Math.min(wr.width/2+22,W*0.48):W*0.42;
      ry=wr?Math.min(wr.height/2+22,H*0.42):H*0.36;
      /* Órbita dentro del lienzo: que el satélite y el planeta no se
         recorten en los bordes del hero (en móvil el panel es a todo lo
         ancho y la órbita se salía por arriba y por los lados). */
      rx=Math.min(rx,Math.max(24,cx-22),Math.max(24,W-cx-22));
      ry=Math.min(ry,Math.max(24,cy-22),Math.max(24,H-cy-22));
      /* Estrellas SOLO donde se ven: en la franja de 110 px alrededor del
         panel, fuera de su rectángulo (las que caían detrás de la tarjeta
         eran invisibles). Con halo oscuro para que se vean también en
         tema claro. */
      stars=[];
      var wTop=wr?Math.max(0,wr.top-hr.top):0, wBot=wTop+(wr?wr.height:0);
      var wL=wr?Math.max(0,wr.left-hr.left):0, wR=wL+(wr?wr.width:0);
      /* Las estrellas tampoco caen sobre el texto (rectángulo de
         .hero-copy): solo en el espacio libre alrededor del panel. */
      var cL=copyR?copyR.left-hr.left:0, cR=copyR?copyR.right-hr.left:0;
      var cT=copyR?copyR.top-hr.top:0, cB=copyR?copyR.bottom-hr.top:0;
      var tries=0;
      while(stars.length<30&&tries<600){
        tries++;
        var sx2=rnd(4,W-4), sy2=rnd(Math.max(0,wTop-110),Math.min(H,wBot+110));
        if(sx2>wL-6&&sx2<wR+6&&sy2>wTop-6&&sy2<wBot+6) continue;
        if(copyR&&sx2>cL-6&&sx2<cR+6&&sy2>cT-6&&sy2<cB+6) continue;
        stars.push({x:sx2,y:sy2,r:rnd(0.9,2.2),p:rnd(0,6.28),s:rnd(0.4,1.1),a:rnd(0.3,0.65)});
      }
    }else{
      stars=[];
      n=46;
      for(i=0;i<n;i++) stars.push({x:rnd(0,W),y:rnd(0,H),r:rnd(0.5,1.4),p:rnd(0,6.28),s:rnd(0.4,1.1),a:rnd(0.10,0.32)});
    }
    /* Halo de cielo nocturno alrededor del panel: en tema claro las
       estrellas blancas no se verían sobre el fondo claro; este halo las
       hace visibles en los dos temas. Está detrás del contenido (el canvas
       es z-index 0) y se desvanece a transparente, sin tapar nada. */
    patch={cx:cx,cy:cy,r:Math.max(rx,ry)+60};
    /* FIX 2026-11-14 — la órbita de AFUERA NUNCA tapa el texto ni se
       esconde tras la cabecera: el recorrido queda en el espacio libre
       alrededor del panel. La órbita anterior, centrada en el hero, la
       recorría entera por detrás del texto (el satélite y el planeta
       pasaban sobre la pastilla y el párrafo) y su parte alta se metía
       bajo la cabecera fija al desplazar. Ahora el recorrido se calcula
       con los rectángulos reales del panel y del texto:
       - Móvil angosto, una columna (panel a todo lo ancho): el único
         espacio libre es el carril entre el panel y el texto (el gap
         del hero es de 92 px en CSS). La órbita es una elipse plana
         dentro de ese carril, siempre visible y entera, y el carril
         está ~460 px bajo el inicio del hero, así que solo llega a la
         cabecera cuando el panel ya se está yendo (desplazamiento
         normal, no un defecto).
       - Dos columnas: la órbita abraza el panel, con el radio recortado
         para no entrar en la columna del texto (30 px de margen por el
         cuerpo del satélite) ni subir hasta la cabecera (40 px). */
    var pL=wr?wr.left-hr.left:0, pR=wr?wr.right-hr.left:W;
    var pT=wr?wr.top-hr.top:0, pB=wr?wr.bottom-hr.top:H;
    var pCx=(pL+pR)/2, pCy=(pT+pB)/2;
    var singleCol=!!wr&&wr.width>W*0.72;
    var ocx=pCx, ocy=pCy, orx=rx, ory=ry;
    var laneTop=pB+6, laneBot=pB+6, textTop=copyR?copyR.top-hr.top:H;
    if(singleCol){
      laneTop=pB+6; laneBot=Math.max(laneTop+40,textTop-6);
      ocx=W/2; ocy=Math.round((laneTop+laneBot)/2);
      ory=Math.max(12,Math.min(22,(laneBot-laneTop)/2-22));
      orx=Math.max(24,Math.min(W/2-30,165));
    }else{
      var textRight=copyR?copyR.right-hr.left:0;
      ocx=pCx; ocy=pCy;
      orx=Math.max(24,Math.min(rx, pCx-(textRight+30), W-pCx-30));
      ory=Math.max(24,Math.min(ry, pCy-40, H-pCy-40));
    }
    sats=[
      {a:rnd(0,6.28),sp:0.055,rx:orx,ry:ory,cx:ocx,cy:ocy,wt:0,rings:[],col:'#00F2FE',sc:1},
      {a:rnd(0,6.28),sp:-0.042,rx:orx*0.86,ry:ory*0.86,cx:ocx,cy:ocy,wt:1.2,rings:[],col:'#FACC15',sc:0.85}
    ];
    if(mob) sats.length=1;
    planets=[];
    if(mob){
      /* Planeta (r 20) en la misma órbita, un poco por dentro que el
         satélite; en el carril el radio vertical deja margen para el
         cuerpo (r 20) y su luna sin salirse del carril, y el horizontal
         para los anillos (r*1.9) sin cortarse en el borde. */
      var pr=20, ringExt=pr*1.9+6;
      var prx=Math.max(24,Math.min(orx-20, W/2-ringExt-6));
      var pry=Math.max(10,ory-4);
      if(singleCol) pry=Math.min(pry,Math.max(10,(laneBot-laneTop)/2-24));
      planets.push({kind:'ringed',orb:true,a:rnd(0,6.28),sp:0.02,rx:prx,ry:pry,cx:ocx,cy:ocy,r:pr,ph:rnd(0,6.28)});
    }
    else{
      /* Planetas a la deriva, confinados a la columna del panel para que
         nunca crucen la columna del texto: derivan en vertical por la
         franja del panel (se esconden detrás de él al cruzarlo, como
         antes) y se ven enteros arriba y abajo de él. */
      var dBx0=Math.max(30,pL-8), dBx1=Math.min(W-30,pR+8);
      planets.push({kind:'ringed',x:Math.min(Math.max(W*0.07,dBx0),dBx1),y:H*0.86,r:30,vx:1.6,vy:-0.8,ph:rnd(0,6.28),bx0:dBx0,bx1:dBx1,by0:30,by1:H-30});
      planets.push({kind:'rocky',x:Math.min(Math.max(W*0.96,dBx0),dBx1),y:H*0.10,r:20,vx:-1.4,vy:0.9,ph:rnd(0,6.28),bx0:dBx0,bx1:dBx1,by0:30,by1:H-30});
    }
  }
  function resize(){
    var dpr=Math.min(window.devicePixelRatio||1,1.75);
    W=hero.clientWidth; H=hero.clientHeight;
    if(!W||!H) return;
    cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    build();
    if(reduced) draw(1000,0);
  }
  function glow(x,y,r,color,a){
    var g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,color); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalAlpha=a; ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill(); ctx.globalAlpha=1;
  }
  function terminator(x,y,r,ang){
    ctx.save();
    ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.clip();
    var g=ctx.createLinearGradient(x-Math.cos(ang)*r,y-Math.sin(ang)*r,x+Math.cos(ang)*r,y+Math.sin(ang)*r);
    g.addColorStop(0,'rgba(2,6,18,0)'); g.addColorStop(0.55,'rgba(2,6,18,0)'); g.addColorStop(1,'rgba(2,6,18,0.55)');
    ctx.fillStyle=g; ctx.fillRect(x-r,y-r,r*2,r*2);
    ctx.restore();
  }
  function drawPlanet(p,t){
    var x=p.x,y=p.y,r=p.r;
    /* Halo oscuro detrás del planeta en móvil (tema claro): sin él el
       planeta y sus anillos se pierden sobre el fondo claro. */
    if(isMob()) glow(x,y,r*2.4,'rgba(2,6,18,0.4)',0.6);
    if(p.kind==='ringed'){
      glow(x,y,r*2.6,'rgba(0,242,254,0.10)',0.5);
      ctx.save(); ctx.translate(x,y); ctx.rotate(-0.32);
      ctx.strokeStyle='rgba(214,186,138,0.55)'; ctx.lineWidth=r*0.28;
      ctx.beginPath(); ctx.ellipse(0,0,r*1.9,r*0.55,0,0,6.2832); ctx.stroke();
      ctx.strokeStyle='rgba(90,66,32,0.5)'; ctx.lineWidth=r*0.05;
      ctx.beginPath(); ctx.ellipse(0,0,r*1.55,r*0.45,0,0,6.2832); ctx.stroke();
      ctx.restore();
      var g=ctx.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r);
      g.addColorStop(0,'#f3e6c8'); g.addColorStop(0.45,'#d9b878'); g.addColorStop(0.8,'#a67c3d'); g.addColorStop(1,'#6b4d24');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.clip();
      ctx.fillStyle='rgba(255,244,214,0.28)'; ctx.fillRect(x-r,y-r*0.45,r*2,r*0.16);
      ctx.fillStyle='rgba(120,84,32,0.30)'; ctx.fillRect(x-r,y+r*0.08,r*2,r*0.14);
      ctx.fillStyle='rgba(255,244,214,0.18)'; ctx.fillRect(x-r,y+r*0.38,r*2,r*0.12);
      ctx.fillStyle='rgba(40,26,8,0.35)';
      ctx.beginPath(); ctx.ellipse(x,y+r*0.28,r*0.95,r*0.30,-0.32,0,6.2832); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.translate(x,y); ctx.rotate(-0.32);
      ctx.strokeStyle='rgba(226,198,150,0.75)'; ctx.lineWidth=r*0.28;
      ctx.beginPath(); ctx.ellipse(0,0,r*1.9,r*0.55,0,0,Math.PI); ctx.stroke();
      ctx.restore();
      var ma=t*0.0004+p.ph, mx=x+Math.cos(ma)*r*2.6, my=y+Math.sin(ma)*r*1.1;
      ctx.fillStyle='rgba(226,232,240,0.9)'; ctx.beginPath(); ctx.arc(mx,my,Math.max(1.5,r*0.09),0,6.2832); ctx.fill();
      terminator(x,y,r,2.4);
      glow(x,y,r*1.5,'rgba(250,204,21,0.08)',0.6);
    }else{
      glow(x,y,r*2.4,'rgba(249,115,22,0.10)',0.5);
      var g2=ctx.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r);
      g2.addColorStop(0,'#e8a37e'); g2.addColorStop(0.45,'#c05a30'); g2.addColorStop(0.8,'#8a3a1c'); g2.addColorStop(1,'#5e2410');
      ctx.fillStyle=g2; ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.clip();
      ctx.fillStyle='rgba(90,32,10,0.35)';
      ctx.beginPath(); ctx.ellipse(x-r*0.4,y+r*0.3,r*0.45,r*0.28,0.5,0,6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x+r*0.35,y-r*0.45,r*0.35,r*0.22,-0.4,0,6.2832); ctx.fill();
      var cr=[[-0.3,-0.15,0.20],[0.25,0.15,0.15],[0.05,-0.45,0.12],[-0.05,0.45,0.16]];
      for(var i=0;i<cr.length;i++){
        var cxp=x+cr[i][0]*r, cyp=y+cr[i][1]*r, crp=cr[i][2]*r;
        ctx.fillStyle='rgba(70,24,8,0.5)'; ctx.beginPath(); ctx.arc(cxp,cyp,crp,0,6.2832); ctx.fill();
        ctx.strokeStyle='rgba(255,220,190,0.35)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.arc(cxp,cyp,crp,Math.PI*0.9,Math.PI*1.7); ctx.stroke();
      }
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(x,y-r*0.82,r*0.55,r*0.22,0,0,6.2832); ctx.fill();
      ctx.restore();
      terminator(x,y,r,2.4);
    }
  }
  function drawSat(s,t,dt){
    var x=s.cx+Math.cos(s.a)*s.rx, y=s.cy+Math.sin(s.a)*s.ry, sc=s.sc*(isMob()?1.4:1);
    /* Halo oscuro detrás del satélite en móvil: en tema claro el fondo
       es claro y el satélite se pierde; el halo lo hace leer sobre
       fondo claro (en tema oscuro es invisible). */
    if(isMob()) glow(x,y,34,'rgba(2,6,18,0.5)',0.7);
    s.wt-=dt;
    if(s.wt<=0){ s.wt=2.4; s.rings.push({r:8,a:0.55}); }
    for(var i=s.rings.length-1;i>=0;i--){
      var rg=s.rings[i]; rg.r+=26*dt; rg.a-=0.30*dt;
      /* En móvil las ondas se quedan cortas (45 px) para no salirse del
         carril de la órbita y rozar el texto; en escritorio, 95 px. */
      if(rg.a<=0||rg.r>(isMob()?45:95)){ s.rings.splice(i,1); continue; }
      ctx.globalAlpha=rg.a*0.30; ctx.strokeStyle=s.col; ctx.lineWidth=5;
      ctx.beginPath(); ctx.arc(x,y,rg.r,0,6.2832); ctx.stroke();
      ctx.globalAlpha=rg.a; ctx.lineWidth=1.6;
      ctx.beginPath(); ctx.arc(x,y,rg.r,0,6.2832); ctx.stroke();
      ctx.globalAlpha=1;
    }
    ctx.save(); ctx.translate(x,y); ctx.rotate(Math.sin(s.a)*0.25); ctx.scale(sc,sc);
    ctx.fillStyle='#1e40af';
    ctx.fillRect(-17,-3,10,6); ctx.fillRect(7,-3,10,6);
    ctx.strokeStyle='rgba(147,197,253,0.7)'; ctx.lineWidth=0.6;
    ctx.strokeRect(-17,-3,10,6); ctx.strokeRect(7,-3,10,6);
    ctx.beginPath(); ctx.moveTo(-12,-3); ctx.lineTo(-12,3); ctx.moveTo(12,-3); ctx.lineTo(12,3); ctx.stroke();
    ctx.fillStyle='#d4a017'; ctx.fillRect(-7,-4.5,14,9);
    ctx.fillStyle='#facc15'; ctx.fillRect(-7,-4.5,14,2);
    ctx.fillStyle='#cbd5e1'; ctx.fillRect(7,-3,5,6);
    ctx.fillStyle='#0f172a'; ctx.beginPath(); ctx.arc(9.5,0,1.4,0,6.2832); ctx.fill();
    ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.arc(-9,-6,5,Math.PI*0.9,Math.PI*1.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-9,-1); ctx.lineTo(-7,-4.5); ctx.stroke();
    ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(2,-4.5); ctx.lineTo(4,-10); ctx.stroke();
    if(Math.sin(t*0.006)>0){ ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.arc(0,-6.5,1.8,0,6.2832); ctx.fill(); }
    ctx.fillStyle='#22c55e'; ctx.beginPath(); ctx.arc(17,0,1.2,0,6.2832); ctx.fill();
    ctx.restore();
  }
  function draw(t,dt){
    ctx.clearRect(0,0,W,H);
    var i;
    /* Posición del hero y borde inferior de la cabecera en este fotograma
       (para el desvanecimiento de la órbita antes de la cabecera). */
    var hrTop=hero.getBoundingClientRect().top;
    var hdrB=topbarEl?topbarEl.getBoundingClientRect().bottom:0;
    if(patch&&patch.r>0){
      var pg=ctx.createRadialGradient(patch.cx,patch.cy,0,patch.cx,patch.cy,patch.r);
      pg.addColorStop(0,'rgba(2,6,18,0.6)'); pg.addColorStop(0.6,'rgba(2,6,18,0.3)'); pg.addColorStop(1,'rgba(2,6,18,0)');
      ctx.fillStyle=pg; ctx.beginPath(); ctx.arc(patch.cx,patch.cy,patch.r,0,6.2832); ctx.fill();
    }
    var mobDraw=isMob();
    for(i=0;i<stars.length;i++){
      var st=stars[i], al=st.a*(0.6+0.4*Math.sin(t*0.001*st.s+st.p));
      if(mobDraw) glow(st.x,st.y,st.r*4.5,'rgba(2,6,18,0.55)',0.7);
      ctx.globalAlpha=Math.max(0.05,al); ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(st.x,st.y,st.r,0,6.2832); ctx.fill();
    }
    ctx.globalAlpha=1;
    for(i=0;i<planets.length;i++){
      var p=planets[i];
      if(p.orb){
        p.a+=p.sp*dt;
        p.x=p.cx+Math.cos(p.a)*p.rx; p.y=p.cy+Math.sin(p.a)*p.ry;
      }else{
        p.x+=p.vx*dt; p.y+=p.vy*dt;
        /* Los planetas a la deriva respetan sus límites propios (bx0/bx1/
           by0/by1): en escritorio es la columna del panel, para que
           nunca crucen la columna del texto. Sin límites propios, los
           de siempre (todo el hero). */
        var bx0=(p.bx0!=null?p.bx0:W*0.06), bx1=(p.bx1!=null?p.bx1:W*0.94);
        var by0=(p.by0!=null?p.by0:H*0.08), by1=(p.by1!=null?p.by1:H*0.92);
        if(p.x<bx0||p.x>bx1) p.vx*=-1;
        if(p.y<by0||p.y>by1) p.vy*=-1;
        p.x=Math.max(p.r+4,Math.min(W-p.r-4,p.x));
        p.y=Math.max(p.r+4,Math.min(H-p.r-4,p.y));
      }
      /* Desvanecer antes de la cabecera: el planeta en órbita, por su
         borde superior (luna incluida); el de la deriva, por su centro. */
      var pf=p.orb?hdrFadeTop(hrTop,hdrB,p.y,p.r*1.2+8):hdrFadeCtr(hrTop,hdrB,p.y);
      drawFaded(pf,function(){ drawPlanet(p,t); });
    }
    for(i=0;i<sats.length;i++){
      var s=sats[i];
      s.a+=s.sp*dt;
      /* La y del satélite es la misma que calcula drawSat; el halo en
         móvil sobresale 34 px y el cuerpo ~14 px en escritorio. */
      var sy=s.cy+Math.sin(s.a)*s.ry;
      drawFaded(hdrFadeTop(hrTop,hdrB,sy,isMob()?40:14),function(){ drawSat(s,t,dt); });
    }
    if(!isMob()){
      if(!meteor&&t>shootAt){
        meteor={x:rnd(W*0.35,W*0.95),y:rnd(0,H*0.25),vx:-340,vy:190,life:1};
        shootAt=t+rnd(14000,22000);
      }
      if(meteor){
        meteor.x+=meteor.vx*dt; meteor.y+=meteor.vy*dt; meteor.life-=dt*0.9;
        if(meteor.life<=0||meteor.x<-40||meteor.y>H+40){ meteor=null; }
        else{
          var mg=ctx.createLinearGradient(meteor.x,meteor.y,meteor.x-meteor.vx*0.28,meteor.y-meteor.vy*0.28);
          mg.addColorStop(0,'rgba(255,255,255,'+(0.9*meteor.life)+')');
          mg.addColorStop(1,'rgba(255,255,255,0)');
          ctx.strokeStyle=mg; ctx.lineWidth=1.6;
          ctx.beginPath(); ctx.moveTo(meteor.x,meteor.y);
          ctx.lineTo(meteor.x-meteor.vx*0.28,meteor.y-meteor.vy*0.28); ctx.stroke();
          ctx.fillStyle='rgba(255,255,255,'+(0.9*meteor.life)+')';
          ctx.beginPath(); ctx.arc(meteor.x,meteor.y,1.6,0,6.2832); ctx.fill();
        }
      }
    }
  }
  function frame(ts){
    raf=null;
    if(!inView||document.hidden) return;
    var dt=Math.min(0.05,((ts-last)/1000)||0.016); last=ts;
    draw(ts,dt);
    raf=requestAnimationFrame(frame);
  }
  function kick(){
    if(reduced||!inView||document.hidden||raf) return;
    last=(window.performance&&performance.now)?performance.now():0;
    raf=requestAnimationFrame(frame);
  }
  resize();
  if(reduced){ draw(1000,0); return; }
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){
      es.forEach(function(en){
        inView=en.isIntersecting;
        if(inView) kick();
      });
    }).observe(hero);
  }
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden) kick();
  });
  if('ResizeObserver' in window){
    new ResizeObserver(function(){ resize(); if(!reduced) kick(); }).observe(hero);
  }else{
    window.addEventListener('resize',function(){ resize(); if(!reduced) kick(); });
  }
  kick();
}

/* ================= UNIVERSO ADENTRO DEL CUADRO DEL GLOBO =================
   Canvas #globeFx DENTRO de #globeMap (recortado por su overflow:hidden y
   su border-radius): estrellas, 1 satélite en órbita y 1 planetita en una
   esquina, alrededor de la Tierra — NUNCA sobre ella. Todo se coloca fuera
   del disco (radio 512·2^zoom/(2π), el mismo zoom automático del globo) y
   el canvas va por DEBAJO de los controles de MapLibre (z-index 1) y con
   pointer-events:none: no tapa ni bloquea la Tierra, sus puntos, la
   pastilla, el marcador amarillo, la atribución ni ningún control. Se pausa
   si la pestaña se oculta o el mapa sale de la vista; con «reducir
   movimiento» queda una escena fija. */
function rlInitGlobeFx(){
  var cv=el('globeFx'); if(!cv) return;
  var box=el('globeMap'); if(!box) return;
  var ctx=cv.getContext('2d'); if(!ctx) return;
  var reduced=false;
  try{ reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  var W=0,H=0,diskR=0,inView=true,raf=null,last=0;
  var stars=[],sat=null,planet=null;
  function isMob(){ return window.innerWidth<=760; }
  function rnd(a,b){ return a+Math.random()*(b-a); }
  function build(){
    var mob=isMob(),i,tries;
    diskR=512*Math.pow(2,rlGlobeDiskZoom())/(2*Math.PI);
    var cx=W/2, cy=H/2;
    stars=[];
    var n=mob?14:26;
    for(i=0,tries=0;i<n&&tries<500;tries++){
      var x=rnd(4,W-4), y=rnd(4,H-4);
      var dx=x-cx, dy=y-cy;
      if(Math.sqrt(dx*dx+dy*dy)<diskR+10) continue;
      if(x>W-150&&y>H-44) continue; /* hueco para la atribución */
      stars.push({x:x,y:y,r:rnd(0.7,1.6),p:rnd(0,6.28),s:rnd(0.4,1.1),a:rnd(0.3,0.7)});
      i++;
    }
    var orbitR=Math.max(20,Math.min(diskR+16,Math.min(W,H)/2-6));
    /* FIX 2026-11-14 — el satélite rozaba la pastilla de atribución
       (abajo a la derecha): su cuerpo pasaba justo por el borde
       izquierdo de la pastilla. Se desplaza la órbita 6 px a la
       izquierda solo en móvil (cx-6) para que el cuerpo quede despejado
       de la pastilla en el punto bajo. */
    sat={a:rnd(0,6.28),sp:0.05,rx:orbitR,ry:orbitR*0.92,cx:cx-(mob?6:0),cy:cy,wt:0,rings:[],col:'#00F2FE',sc:mob?0.55:0.7};
    planet=null;
    var pr=mob?9:13, px0=26, py0=26;
    var pdx=px0-cx, pdy=py0-cy;
    if(Math.sqrt(pdx*pdx+pdy*pdy)>diskR+pr+8) planet={kind:'ringed',x:px0,y:py0,r:pr,ph:rnd(0,6.28)};
  }
  function resize(){
    var dpr=Math.min(window.devicePixelRatio||1,1.75);
    W=box.clientWidth; H=box.clientHeight;
    if(!W||!H) return;
    cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    build();
    if(reduced) draw(1000,0);
  }
  function glow(x,y,r,color,a){
    var g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,color); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.globalAlpha=a; ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill(); ctx.globalAlpha=1;
  }
  function drawPlanet(p,t){
    var x=p.x,y=p.y,r=p.r;
    glow(x,y,r*2.2,'rgba(250,204,21,0.10)',0.5);
    ctx.save(); ctx.translate(x,y); ctx.rotate(-0.32);
    ctx.strokeStyle='rgba(214,186,138,0.55)'; ctx.lineWidth=r*0.28;
    ctx.beginPath(); ctx.ellipse(0,0,r*1.9,r*0.55,0,0,6.2832); ctx.stroke();
    ctx.restore();
    var g=ctx.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r);
    g.addColorStop(0,'#f3e6c8'); g.addColorStop(0.45,'#d9b878'); g.addColorStop(0.8,'#a67c3d'); g.addColorStop(1,'#6b4d24');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,6.2832); ctx.fill();
    ctx.save(); ctx.translate(x,y); ctx.rotate(-0.32);
    ctx.strokeStyle='rgba(226,198,150,0.75)'; ctx.lineWidth=r*0.28;
    ctx.beginPath(); ctx.ellipse(0,0,r*1.9,r*0.55,0,0,Math.PI); ctx.stroke();
    ctx.restore();
  }
  function drawSat(s,t,dt){
    var x=s.cx+Math.cos(s.a)*s.rx, y=s.cy+Math.sin(s.a)*s.ry, sc=s.sc;
    s.wt-=dt;
    if(s.wt<=0){ s.wt=2.4; s.rings.push({r:6,a:0.55}); }
    for(var i=s.rings.length-1;i>=0;i--){
      var rg=s.rings[i]; rg.r+=20*dt; rg.a-=0.30*dt;
      if(rg.a<=0||rg.r>60){ s.rings.splice(i,1); continue; }
      ctx.globalAlpha=rg.a*0.30; ctx.strokeStyle=s.col; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(x,y,rg.r,0,6.2832); ctx.stroke();
      ctx.globalAlpha=rg.a; ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.arc(x,y,rg.r,0,6.2832); ctx.stroke();
      ctx.globalAlpha=1;
    }
    ctx.save(); ctx.translate(x,y); ctx.rotate(Math.sin(s.a)*0.25); ctx.scale(sc,sc);
    ctx.fillStyle='#1e40af';
    ctx.fillRect(-17,-3,10,6); ctx.fillRect(7,-3,10,6);
    ctx.strokeStyle='rgba(147,197,253,0.7)'; ctx.lineWidth=0.6;
    ctx.strokeRect(-17,-3,10,6); ctx.strokeRect(7,-3,10,6);
    ctx.fillStyle='#d4a017'; ctx.fillRect(-7,-4.5,14,9);
    ctx.fillStyle='#facc15'; ctx.fillRect(-7,-4.5,14,2);
    ctx.fillStyle='#cbd5e1'; ctx.fillRect(7,-3,5,6);
    ctx.strokeStyle='#e5e7eb'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.arc(-9,-6,5,Math.PI*0.9,Math.PI*1.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-9,-1); ctx.lineTo(-7,-4.5); ctx.stroke();
    if(Math.sin(t*0.006)>0){ ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.arc(0,-6.5,1.8,0,6.2832); ctx.fill(); }
    ctx.fillStyle='#22c55e'; ctx.beginPath(); ctx.arc(17,0,1.2,0,6.2832); ctx.fill();
    ctx.restore();
  }
  function draw(t,dt){
    ctx.clearRect(0,0,W,H);
    var i;
    for(i=0;i<stars.length;i++){
      var st=stars[i], al=st.a*(0.6+0.4*Math.sin(t*0.001*st.s+st.p));
      ctx.globalAlpha=Math.max(0.05,al); ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(st.x,st.y,st.r,0,6.2832); ctx.fill();
    }
    ctx.globalAlpha=1;
    if(planet) drawPlanet(planet,t);
    if(sat){ sat.a+=sat.sp*dt; drawSat(sat,t,dt); }
  }
  function frame(ts){
    raf=null;
    if(!inView||document.hidden) return;
    var dt=Math.min(0.05,((ts-last)/1000)||0.016); last=ts;
    draw(ts,dt);
    raf=requestAnimationFrame(frame);
  }
  function kick(){
    if(reduced||!inView||document.hidden||raf) return;
    last=(window.performance&&performance.now)?performance.now():0;
    raf=requestAnimationFrame(frame);
  }
  resize();
  if(reduced){ draw(1000,0); return; }
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){
      es.forEach(function(en){
        inView=en.isIntersecting;
        if(inView) kick();
      });
    }).observe(box);
  }
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden) kick();
  });
  if('ResizeObserver' in window){
    new ResizeObserver(function(){ resize(); if(!reduced) kick(); }).observe(box);
  }else{
    window.addEventListener('resize',function(){ resize(); if(!reduced) kick(); });
  }
  kick();
}

/* ================= MENÚ MÓVIL (hamburguesa) ================= */
(function(){
  var btn=el('menuBtn'), nav=el('mobileNav');
  if(!btn||!nav) return;
  function close(){ nav.hidden=true; btn.setAttribute('aria-expanded','false'); }
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    var open=nav.hidden;
    nav.hidden=!open;
    btn.setAttribute('aria-expanded',String(open));
  });
  nav.addEventListener('click',function(e){ if(e.target.closest('[data-nav],a')) close(); });
  document.addEventListener('click',function(e){
    if(!nav.hidden&&!nav.contains(e.target)&&e.target!==btn&&!btn.contains(e.target)) close();
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') close(); });
})();

/* FIX 2026-11-14 — cierre del IIFE principal (abierto en la línea 6).
   Estaba en la línea 1174 y dejaba fuera del ámbito a la sala de emisora,
   el globo 3D y el menú móvil: el/STATIONS/db no existían ahí, rlInitGlobe
   lanzaba «el is not defined» y abortaba todo app.js (globo negro, menú
   muerto, resto del script sin ejecutar). */
})();
