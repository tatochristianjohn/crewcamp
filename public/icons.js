/* CrewCamp icon layer: swaps UI-chrome emoji for inline SVG (Lucide-style, stroke 2).
   Skips chat/post text, inputs and emoji pickers so user-written emoji stay untouched. */
(function(){
  var P={
    user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    checkc:'<path d="M21.8 10A10 10 0 1 1 17 3.3"/><path d="m9 11 3 3L22 4"/>',
    trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    alert:'<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    pin:'<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    video:'<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    save:'<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    msg:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    eye:'<path d="M2 12.3a1 1 0 0 1 0-.6 10.8 10.8 0 0 1 20 0 1 1 0 0 1 0 .6 10.8 10.8 0 0 1-20 0"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:'<path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/>',
    star:'<path d="M12 2.3a.5.5 0 0 1 .5.3l2.3 4.7a2 2 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.7 3.6a2 2 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2 2 0 0 0-2 0l-4.6 2.4a.5.5 0 0 1-.8-.6l.9-5.1a2 2 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.2-.7a2 2 0 0 0 1.6-1.2l2.3-4.7a.5.5 0 0 1 .4-.3"/>',
    list:'<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    cal:'<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    pencil:'<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8L2 21.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/>',
    down:'<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    up:'<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    shield:'<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.500 20.500 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.500-1.200 6.200-2.700a1.200 1.200 0 0 1 1.500 0C14.500 3.800 17 5 19 5a1 1 0 0 1 1 1z"/>',
    repeat:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    bell:'<path d="M10.3 21a2 2 0 0 0 3.4 0"/><path d="M3.3 15.300A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.700C19.400 14 18 12.500 18 8A6 6 0 0 0 6 8c0 4.500-1.400 6-2.700 7.300"/>',
    plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
    send:'<path d="M14.500 21.700a.5.5 0 0 0 .9 0l6.500-19a.5.5 0 0 0-.6-.6l-19 6.500a.5.5 0 0 0 0 .9l7.900 3.200a2 2 0 0 1 1.100 1.100z"/><path d="m21.900 2.100-10.900 10.900"/>',
    x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    menu:'<path d="M4 12h16"/><path d="M4 18h16"/><path d="M4 6h16"/>',
    key:'<circle cx="7.500" cy="15.500" r="5.500"/><path d="m21 2-9.600 9.600"/><path d="m15.500 7.500 3 3L22 7l-3-3"/>',
    camera:'<path d="M14 4a2 2 0 0 1 1.800 1l.5.9A2 2 0 0 0 18 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2a2 2 0 0 0 1.800-1l.5-.9A2 2 0 0 1 10 4z"/><circle cx="12" cy="13" r="3"/>',
    monitor:'<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    ticket:'<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>',
    building:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    tag:'<path d="M12.600 2.600A2 2 0 0 0 11.200 2H4a2 2 0 0 0-2 2v7.200a2 2 0 0 0 .6 1.400l8.700 8.700a2.400 2.400 0 0 0 3.400 0l6.600-6.600a2.400 2.400 0 0 0 0-3.400z"/><path d="M7.500 7.500h.01"/>',
    crown:'<path d="M11.600 3.300a.5.5 0 0 1 .8 0l3 5.600a1 1 0 0 0 1.500.3l4.300-3.700a.5.5 0 0 1 .8.500l-2.800 10.200a1 1 0 0 1-1 .7H5.800a1 1 0 0 1-1-.7L2 6a.5.5 0 0 1 .8-.5l4.300 3.700a1 1 0 0 0 1.500-.3z"/><path d="M5 21h14"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.500.5l3-3a5 5 0 0 0-7-7l-1.700 1.700"/><path d="M14 11a5 5 0 0 0-7.500-.5l-3 3a5 5 0 0 0 7 7l1.700-1.700"/>',
    palette:'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.300a1.800 1.800 0 0 0-1.400 2.800l.3.4A1.800 1.800 0 0 1 12 22z"/><path d="M13.500 6.500h.01M17.500 10.500h.01M6.500 12.500h.01M8.500 7.500h.01"/>',
    compass:'<circle cx="12" cy="12" r="10"/><path d="m16.200 7.800-1.800 5.400a2 2 0 0 1-1.300 1.300L7.800 16.200l1.800-5.400a2 2 0 0 1 1.300-1.300z"/>',
    mappin:'<path d="M20 10c0 5-5.500 10.200-7.400 11.800a1 1 0 0 1-1.200 0C9.500 20.200 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    right:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    chart:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    xc:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    redo:'<path d="M3 12a9 9 0 1 0 9-9 9.800 9.800 0 0 0-6.700 2.700L3 8"/><path d="M3 3v5h5"/>',
    mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-9 5.700a2 2 0 0 1-2 0L2 7"/>',
    sq:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
    logout:'<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    sqe:'<rect width="18" height="18" x="3" y="3" rx="2"/>',
    circ:'<circle cx="12" cy="12" r="9"/>',
    heart:'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    chev:'<path d="m6 9 6 6 6-6"/>'
  };
  var M={'👤':'user','🧑':'user','🙋':'user','👥':'users','🤝':'users','✔':'check','✓':'check','☑':'sq','✅':'checkc','🗑':'trash','⚠':'alert','🔒':'lock','📌':'pin','📹':'video','💾':'save','💬':'msg','👁':'eye','🙈':'eyeoff','⭐':'star','★':'star','☆':'star','📋':'list','📝':'list','📅':'cal','🗓':'cal','✏':'pencil','✎':'pencil','⬇':'down','⬆':'up','🛡':'shield','🔁':'repeat','🔔':'bell','➕':'plus','➤':'send','✕':'x','☰':'menu','🔑':'key','📷':'camera','🖥':'monitor','🎟':'ticket','🏢':'building','🏷':'tag','👑':'crown','🔗':'link','🎨':'palette','🧭':'compass','📍':'mappin','➡':'right','📊':'chart','❌':'xc','⛔':'xc','♻':'redo','✉':'mail','🏕':'compass','⎋':'logout','ⓘ':'info','↩':'undo','⬜':'sqe','○':'circ','❤':'heart','＋':'plus','▾':'chev'};
  var ZW='\uD83E\uDDD1\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1';M[ZW]='users';   /* joined emoji (friends) must match before its single-emoji parts */
  var D={'🔴':'r','🟡':'y','🟢':'g','⚪':'w'};
  var keys=[ZW].concat(Object.keys(M).filter(function(k){return k!==ZW}),Object.keys(D));
  var RE=new RegExp('('+keys.map(function(k){return k}).join('|')+')\\uFE0F?','g');
  var SKIP='textarea,input,option,select,script,style,title,[data-emoji],.cw-body,.cwp-txt,[class*=emo],[class*=react],[class*=pick]';
  var css=document.createElement('style');
  css.textContent='.i{width:1.1em;height:1.1em;vertical-align:-.2em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none;display:inline-block}'+
    '.pd{display:inline-block;width:.7em;height:.7em;border-radius:50%;vertical-align:.02em;border:1.5px solid rgba(0,0,0,.25)}'+
    '.pd.r{background:#dc2626}.pd.y{background:#eab308}.pd.g{background:#16a34a}.pd.w{background:var(--panel,#fff)}';
  document.head.appendChild(css);
  function node(k){
    var s;
    if(D[k]){s=document.createElement('i');s.className='pd '+D[k];s.setAttribute('aria-hidden','true');return s}
    var n=M[k];
    s=document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('class','i');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');
    s.innerHTML=P[n];
    if(k==='★')s.style.fill='currentColor';
    return s;
  }
  function fix(t){
    var p=t.parentElement;if(!p)return;
    if(p.tagName==='OPTION'){var o=t.nodeValue,n=o.replace(RE,'').replace(/^\s+/,'');RE.lastIndex=0;if(n!==o)t.nodeValue=n;return}   /* only write when changed: an identical write re-fires the observer forever and froze the page */
    if(p.closest(SKIP))return;
    var v=t.nodeValue;RE.lastIndex=0;if(!RE.test(v))return;RE.lastIndex=0;
    var f=document.createDocumentFragment(),last=0,m;
    while((m=RE.exec(v))){
      if(m.index>last)f.appendChild(document.createTextNode(v.slice(last,m.index)));
      f.appendChild(node(m[1]));last=m.index+m[0].length;
    }
    if(last<v.length)f.appendChild(document.createTextNode(v.slice(last)));
    t.parentNode.replaceChild(f,t);
  }
  function scan(r){
    if(r.nodeType===3){fix(r);return}
    if(r.nodeType!==1||r.closest&&r.closest('svg'))return;
    var w=document.createTreeWalker(r,4,null),a=[],n;
    while((n=w.nextNode()))a.push(n);
    a.forEach(fix);
  }
  function go(){
    scan(document.body);
    new MutationObserver(function(ms){
      ms.forEach(function(m){
        if(m.type==='characterData')fix(m.target);
        else m.addedNodes.forEach(scan);
      });
    }).observe(document.body,{childList:true,subtree:true,characterData:true});
  }
  if(document.body)go();else document.addEventListener('DOMContentLoaded',go);
})();
