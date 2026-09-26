/* Radio Latina · Portal web (Fase 2: diseño elaborado + datos reales en vivo)
 * Reproductor con 2123 emisoras + chat Firebase (mismo modelo que la app 1.9.19).
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
function flagEmoji(cc){ try{ return String(cc).replace(/./g,function(ch){ return String.fromCodePoint(127397+ch.charCodeAt(0)); }); }catch(e){ return ''; } }

/* ---------- degradados por género ---------- */
var GENRE_GRADS=[
  [/tropical/, 'linear-gradient(135deg,#f59e0b,#E11D48)'],
  [/salsa/, 'linear-gradient(135deg,#fb923c,#E11D48)'],
  [/noticia|news/, 'linear-gradient(135deg,#3b82f6,#1e40af)'],
  [/romántica|romantica/, 'linear-gradient(135deg,#E11D48,#fb7185)'],
  [/pop/, 'linear-gradient(135deg,#22d3ee,#8b5cf6)'],
  [/rock/, 'linear-gradient(135deg,#8b5cf6,#312e81)'],
  [/regional/, 'linear-gradient(135deg,#22c55e,#15803d)'],
  [/variada|general/, 'linear-gradient(135deg,#14b8a6,#0ea5e9)'],
  [/80/, 'linear-gradient(135deg,#e879f9,#7c3aed)'],
  [/urbana|reggaet/, 'linear-gradient(135deg,#f43f5e,#7c2d12)']
];
function genreGrad(g){ g=String(g||'').toLowerCase(); for(var i=0;i<GENRE_GRADS.length;i++){ if(GENRE_GRADS[i][0].test(g)) return GENRE_GRADS[i][1]; } return 'linear-gradient(135deg,#E11D48,#7c2d12)'; }
function initials(name){ var w=String(name||'?').trim().split(/\s+/); return (w[0].charAt(0)+(w[1]?w[1].charAt(0):'')).toUpperCase(); }

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
  if(logo){ return '<div class="station-art" style="background:'+grad+'"><img src="'+esc(logo)+'" alt="" loading="lazy" onerror="this.outerHTML=\'<span class=&quot;art-fallback&quot;>'+esc(initials(s.name))+'</span>\'"></div>'; }
  return '<div class="station-art" style="background:'+grad+'"><span class="art-fallback">'+esc(initials(s.name))+'</span></div>';
}
function cardHTML(s){
  var fav=FAVS[s.name]?' on':'';
  var playing=current&&current.name===s.name?'<span class="station-playing">🔊 Sonando</span>':'';
  return '<button class="station-card" data-st="'+esc(s.name)+'">'+
    '<span class="fav-btn'+fav+'" data-fav="'+esc(s.name)+'" title="Favorita">♥</span>'+
    '<span class="share-btn" data-share="'+esc(s.name)+'" title="Compartir" role="button" tabindex="0">↗</span>'+
    playing+logoHTML(s)+
    '<span class="station-play"><span class="pp">▶</span></span>'+
    '<span class="genre-tag">'+esc(s.genre||'Radio')+'</span>'+
    '<span class="station-info"><b>'+esc(s.name)+'</b><span>'+esc(s.city?s.city+', ':'')+esc(s.country||'')+'</span></span>'+
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
el('pbClose').addEventListener('click',function(){ audio.pause(); audio.removeAttribute('src'); current=null; el('playerbar').hidden=true; markPlaying(); });
audio.addEventListener('error',function(){ if(current) onStreamError(current); });
audio.addEventListener('playing',function(){ setPlayingUI(true); });
audio.addEventListener('pause',function(){ setPlayingUI(false); });

/* ================= TEMPORIZADOR DE APAGADO (gratis en web) ================= */
var SLEEP_KEY='rl_sleep_ends', rlSleepEndsAt=0, rlSleepTimer=null, rlSleepPoll=null;
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
  el('tmStatus').textContent=rem>0?('Activo: la reproducción se detendrá en '+mins+' min.'):'';
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
    b.addEventListener('click',function(){ setSleep(m); });
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
  var b=el('themeBtn'); if(b) b.textContent=(eff==='light')?'☀️':'🌙';
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

/* ================= CANAL OFICIAL DE AVISOS ================= */
var AVISOS_URLS=['./avisos.json','https://radiolatinapp.github.io/avisos.json'];
var LS_AVISOS='rl_avisos', LS_LEIDOS='rl_avisos_leidos';
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
  var leidos=avisosLS(LS_LEIDOS,[]), n=0, i;
  for(i=0;i<list.length;i++){ if(list[i]&&list[i].id&&leidos.indexOf(list[i].id)===-1) n++; }
  var b=el('badge-avisos'); if(!b) return;
  b.textContent=n>99?'99+':String(n); b.hidden=!(n>0);
}
function renderAvisos(list){
  var box=el('lista-avisos'); if(!box) return;
  var leidos=avisosLS(LS_LEIDOS,[]);
  if(!list||!list.length){ box.innerHTML='<p class="avisos-vacio">No hay avisos por ahora. Vuelve pronto.</p>'; return; }
  box.innerHTML=list.map(function(a){
    if(!a||!a.id) return '';
    var leido=leidos.indexOf(a.id)!==-1, cta='';
    if(a.accion&&a.accion.tipo){
      var t=String(a.accion.tipo).toLowerCase();
      if(t==='pais') cta='<div class="aviso-cta">Ver emisoras →</div>';
      else if(t==='emisora') cta='<div class="aviso-cta">Escuchar →</div>';
    }
    return '<article class="aviso-card'+(leido?' leido':'')+'" data-aviso="'+esc(a.id)+'" role="button" tabindex="0">'+
      (a.fecha?'<div class="aviso-fecha">'+esc(a.fecha)+'</div>':'')+
      '<h3 class="aviso-titulo">'+esc(a.titulo||'Aviso')+'</h3>'+
      (a.texto?'<p class="aviso-texto">'+esc(a.texto)+'</p>':'')+cta+'</article>';
  }).join('');
  box.querySelectorAll('[data-aviso]').forEach(function(c){
    function open(){ openAviso(c.getAttribute('data-aviso')); }
    c.addEventListener('click',open);
    c.addEventListener('keydown',function(ev){ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); open(); } });
  });
}
function openAviso(id){
  var list=avisosLS(LS_AVISOS,[]), a=null, i;
  for(i=0;i<list.length;i++){ if(list[i]&&list[i].id===id){ a=list[i]; break; } }
  if(a){ var leidos=avisosLS(LS_LEIDOS,[]); if(leidos.indexOf(id)===-1){ leidos.push(id); avisosSave(LS_LEIDOS,leidos); } }
  renderAvisos(list); updateAvisosBadge(list);
  if(a&&a.accion) resolveAvisoAction(a.accion);
}
function resolveAvisoAction(acc){
  try{
    if(!acc||!acc.tipo) return;
    var t=String(acc.tipo).toLowerCase(), v=String(acc.valor==null?'':acc.valor).trim(), i, s;
    if(t==='pais'&&v){
      filters.country=v; filters.city=''; filters.genre=''; filters.favs=false;
      el('fGenre').value='';
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

/* ---------- carga del catálogo ---------- */
function initCatalog(){
  fetch('stations.json').then(function(r){ return r.json(); }).then(function(d){
    STATIONS=d||[];
    el('statStations').textContent=STATIONS.length.toLocaleString('es-CO');
    var countries={}; d.forEach(function(s){ if(s.country) countries[s.country]=1; });
    var clist=Object.keys(countries).sort();
    el('statCountries').textContent=clist.length+'+';
    var cc=el('countryChips');
    cc.innerHTML='<button class="chip active" data-c="">🌎 Todas</button>'+clist.map(function(c){return '<button class="chip" data-c="'+esc(c)+'">'+esc(flagEmoji(countryCode(c)))+' '+esc(c)+'</button>';}).join('');
    cc.querySelectorAll('.chip').forEach(function(ch){ ch.addEventListener('click',function(){ selectCountry(ch.getAttribute('data-c')); }); });
    var genres={}; d.forEach(function(s){ var g=String(s.genre||'').toLowerCase(); if(g) genres[g]=s.genre; });
    var fg=el('fGenre');
    Object.keys(genres).sort().forEach(function(g){ var o=document.createElement('option'); o.value=g; o.textContent=genres[g]; fg.appendChild(o); });
    var gc=el('genreChips');
    var topGenres=['General','Variada','Pop latino','Noticias','Tropical','Salsa','Rock','Regional','Romántica','80s'];
    gc.innerHTML=topGenres.map(function(g){return '<button class="chip" data-g="'+esc(g.toLowerCase())+'">'+esc(g)+'</button>';}).join('');
    gc.querySelectorAll('.chip').forEach(function(ch){ ch.addEventListener('click',function(){ filters.genre=ch.getAttribute('data-g'); fg.value=filters.genre; go('radio'); applyFilters(); }); });
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

/* ---------- explorar país → ciudades ---------- */
function syncCountryChips(){
  el('countryChips').querySelectorAll('.chip').forEach(function(x){ x.classList.toggle('active',x.getAttribute('data-c')===filters.country); });
}
function selectCountry(c){
  filters.country=c; filters.city='';
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
  cc.querySelectorAll('.chip').forEach(function(ch){ ch.addEventListener('click',function(){ filters.city=ch.getAttribute('data-city'); renderCities(country); applyFilters(); }); });
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
var auth=null, db=null, fbReady=false, signInPromise=null, chatStarted=false;
var NICK_KEY='rl_chat_nick', SEXO_KEY='rl_chat_sexo', PAIS_KEY='rl_chat_pais', BLOCKED_KEY='rl_blocked';
var MY_ROOMS_KEY='rl_my_rooms', MAX_TEXT=200;
var unsub=null, roomUnsub=null, currentRoom=null;
var _lastMsgAt=0, _lastRoomMsgAt=0, premiumCache=null;
var BAD_WORDS=['pendejo','idiota','estupido','maldito','cabron','mierda','carajo','joder','puta','coño','verga','chingar','boludo','pelotudo','gilipollas','imbecil'];
var ROOM_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ', ROOM_CODE_LEN=6;
var PAISES=[['AF','Afganistán'],['AL','Albania'],['DE','Alemania'],['AD','Andorra'],['AO','Angola'],['AI','Anguila'],['AG','Antigua y Barbuda'],['SA','Arabia Saudita'],['DZ','Argelia'],['AR','Argentina'],['AM','Armenia'],['AW','Aruba'],['AU','Australia'],['AT','Austria'],['AZ','Azerbaiyán'],['BS','Bahamas'],['BD','Bangladés'],['BB','Barbados'],['BH','Baréin'],['BE','Bélgica'],['BZ','Belice'],['BJ','Benín'],['BM','Bermudas'],['BY','Bielorrusia'],['BO','Bolivia'],['BQ','Bonaire'],['BA','Bosnia y Herzegovina'],['BW','Botsuana'],['BR','Brasil'],['BN','Brunéi'],['BG','Bulgaria'],['BF','Burkina Faso'],['BI','Burundi'],['BT','Bután'],['CV','Cabo Verde'],['KH','Camboya'],['CM','Camerún'],['CA','Canadá'],['QA','Catar'],['TD','Chad'],['CL','Chile'],['CN','China'],['CY','Chipre'],['VA','Ciudad del Vaticano'],['CO','Colombia'],['KM','Comoras'],['CG','Congo'],['CD','Congo (RDC)'],['KP','Corea del Norte'],['KR','Corea del Sur'],['CI','Costa de Marfil'],['CR','Costa Rica'],['HR','Croacia'],['CU','Cuba'],['CW','Curazao'],['DK','Dinamarca'],['DM','Dominica'],['EC','Ecuador'],['EG','Egipto'],['SV','El Salvador'],['AE','Emiratos Árabes Unidos'],['ER','Eritrea'],['SK','Eslovaquia'],['SI','Eslovenia'],['ES','España'],['US','Estados Unidos'],['EE','Estonia'],['SZ','Esuatini'],['ET','Etiopía'],['PH','Filipinas'],['FI','Finlandia'],['FJ','Fiyi'],['FR','Francia'],['GA','Gabón'],['GM','Gambia'],['GE','Georgia'],['GH','Ghana'],['GI','Gibraltar'],['GD','Granada'],['GR','Grecia'],['GL','Groenlandia'],['GP','Guadalupe'],['GU','Guam'],['GT','Guatemala'],['GF','Guayana Francesa'],['GG','Guernsey'],['GN','Guinea'],['GQ','Guinea Ecuatorial'],['GW','Guinea-Bisáu'],['GY','Guyana'],['HT','Haití'],['HN','Honduras'],['HK','Hong Kong'],['HU','Hungría'],['IN','India'],['ID','Indonesia'],['IQ','Irak'],['IR','Irán'],['IE','Irlanda'],['IM','Isla de Man'],['NF','Isla Norfolk'],['IS','Islandia'],['KY','Islas Caimán'],['CC','Islas Cocos'],['CK','Islas Cook'],['FO','Islas Feroe'],['FK','Islas Malvinas'],['MP','Islas Marianas del Norte'],['MH','Islas Marshall'],['PN','Islas Pitcairn'],['SB','Islas Salomón'],['TC','Islas Turcas y Caicos'],['VG','Islas Vírgenes Británicas'],['VI','Islas Vírgenes de EE. UU.'],['IL','Israel'],['IT','Italia'],['JM','Jamaica'],['JP','Japón'],['JE','Jersey'],['JO','Jordania'],['KZ','Kazajistán'],['KE','Kenia'],['KG','Kirguistán'],['KI','Kiribati'],['XK','Kosovo'],['KW','Kuwait'],['LA','Laos'],['LS','Lesoto'],['LV','Letonia'],['LB','Líbano'],['LR','Liberia'],['LY','Libia'],['LI','Liechtenstein'],['LT','Lituania'],['LU','Luxemburgo'],['MO','Macao'],['MG','Madagascar'],['MY','Malasia'],['MW','Malaui'],['MV','Maldivas'],['ML','Malí'],['MT','Malta'],['MA','Marruecos'],['MQ','Martinica'],['MU','Mauricio'],['MR','Mauritania'],['YT','Mayotte'],['MX','México'],['FM','Micronesia'],['MD','Moldavia'],['MC','Mónaco'],['MN','Mongolia'],['ME','Montenegro'],['MS','Montserrat'],['MZ','Mozambique'],['MM','Myanmar'],['NA','Namibia'],['NR','Nauru'],['NP','Nepal'],['NI','Nicaragua'],['NE','Níger'],['NG','Nigeria'],['NU','Niue'],['NO','Noruega'],['NC','Nueva Caledonia'],['NZ','Nueva Zelanda'],['OM','Omán'],['NL','Países Bajos'],['PK','Pakistán'],['PW','Palaos'],['PS','Palestina'],['PA','Panamá'],['PG','Papúa Nueva Guinea'],['PY','Paraguay'],['PE','Perú'],['PF','Polinesia Francesa'],['PL','Polonia'],['PT','Portugal'],['PR','Puerto Rico'],['GB','Reino Unido'],['CF','República Centroafricana'],['CZ','República Checa'],['DO','República Dominicana'],['RE','Reunión'],['RW','Ruanda'],['RO','Rumania'],['RU','Rusia'],['EH','Sáhara Occidental'],['WS','Samoa'],['AS','Samoa Americana'],['BL','San Bartolomé'],['KN','San Cristóbal y Nieves'],['SM','San Marino'],['MF','San Martín'],['PM','San Pedro y Miquelón'],['VC','San Vicente y las Granadinas'],['SH','Santa Elena'],['LC','Santa Lucía'],['ST','Santo Tomé y Príncipe'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leona'],['SG','Singapur'],['SX','Sint Maarten'],['SY','Siria'],['SO','Somalia'],['LK','Sri Lanka'],['ZA','Sudáfrica'],['SD','Sudán'],['SS','Sudán del Sur'],['SE','Suecia'],['CH','Suiza'],['SR','Surinam'],['TH','Tailandia'],['TW','Taiwán'],['TZ','Tanzania'],['TJ','Tayikistán'],['TL','Timor Oriental'],['TG','Togo'],['TK','Tokelau'],['TO','Tonga'],['TT','Trinidad y Tobago'],['TN','Túnez'],['TM','Turkmenistán'],['TR','Turquía'],['TV','Tuvalu'],['UA','Ucrania'],['UG','Uganda'],['UY','Uruguay'],['UZ','Uzbekistán'],['VU','Vanuatu'],['VE','Venezuela'],['VN','Vietnam'],['WF','Wallis y Futuna'],['YE','Yemen'],['DJ','Yibuti'],['ZM','Zambia'],['ZW','Zimbabue']];

function fbInit(){
  if(fbReady) return Promise.resolve(true);
  return fetch('firebase-config.json').then(function(r){ return r.json(); }).then(function(cfg){
    firebase.initializeApp(cfg);
    auth=firebase.auth(); db=firebase.firestore();
    fbReady=true; return true;
  }).catch(function(){ toast('⚠️ No se pudo conectar con el chat.'); return false; });
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
function rlDetectCountry(){ var l=(navigator.language||'es').split('-')[1]; return (l||'CO').toUpperCase(); }
function sexIcon(s){ return s==='F'?'♀':(s==='M'?'♂':''); }
function rlTodayKey(){ var d=new Date(); return 'rl_chat_limite_'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function rlMsgsToday(){ return parseInt(localStorage.getItem(rlTodayKey())||'0',10); }
function rlCountMsg(){ try{ localStorage.setItem(rlTodayKey(),String(rlMsgsToday()+1)); }catch(e){} }
async function rlIsPremiumWeb(){
  if(premiumCache!==null) return premiumCache;
  premiumCache=false;
  try{ if(!(await ensureSignedIn())) return false;
    var doc=await db.collection('premium_uids').doc(auth.currentUser.uid).get();
    premiumCache=doc.exists;
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
  var flag=data.pais?flagEmoji(String(data.pais))+' ':'';
  var sx=data.sexo?' '+sexIcon(String(data.sexo)):'';
  var txt=data.texto||data.text||'';
  var acts='';
  if(d._room==='general'){
    acts='<div class="chat-msg-actions"><button class="chat-flag" data-action="report" data-id="'+esc(d.id)+'" data-nick="'+esc(nick)+'">Reportar</button>'+
      '<button class="chat-flag" data-action="invite">Invitar</button>'+
      (isOwn?'':'<button class="chat-flag" data-action="block" data-nick="'+esc(nick)+'">Bloquear</button>')+'</div>';
  }
  return '<div class="chat-msg'+(isOwn?' own':'')+'"><div class="chat-msg-head"><b><span class="avatar">'+esc(initials(nick))+'</span>'+flag+esc(nick)+sx+'</b>'+(time?'<span>'+esc(time)+'</span>':'')+'</div><p>'+esc(txt)+'</p>'+acts+'</div>';
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
    return '<button class="room-item" data-icode="'+esc(r.code)+'"><span class="ric">🔒</span><span><span class="room-item-name">'+esc(r.nombre)+'</span><span class="room-item-code">CÓDIGO '+esc(r.code)+'</span></span><span class="linklike">Copiar</span></button>';
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
    return '<button class="room-item" data-room="'+esc(r.code)+'" data-rname="'+esc(r.nombre)+'"><span class="ric">🔒</span><span><span class="room-item-name">'+esc(r.nombre)+'</span><span class="room-item-code">CÓDIGO '+esc(r.code)+'</span></span></button>';
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
  }catch(err){ toast('No se pudo enviar tu mensaje. Inténtalo de nuevo.'); }
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
  if(!sel.options.length){ PAISES.forEach(function(pc){ var o=document.createElement('option'); o.value=pc[0]; o.textContent=flagEmoji(pc[0])+' '+pc[1]; sel.appendChild(o); }); }
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

/* ---------- arranque del chat ---------- */
async function initChat(){
  if(chatStarted) return; chatStarted=true;
  var ok=await fbInit(); if(!ok) return;
  await ensureSignedIn();
  subscribeGeneral(); renderMyRooms();
}

/* ---------- init ---------- */
initCatalog();
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
})();
