/* Stitch design mockups: shared simulated tissue field + state-colour rules (v2: organic, no outlines, gradients).
   Not project code: visual stand-in only. Everything it draws is SIMULATED.
   API unchanged from v1: CellField.render(canvas, opts) -> {stats, palette, geometry, W, areaFraction}; CellField.PAL; CellField.RULES.
   New: CellField.swatch(key, tone, size) -> SVG string (soft round swatch with the non-colour cue); opts.dish for circular clip. */
(function (global) {
  const PAL = {
    light:  { intact:'#E9D3C0', edge:'#C98F7C', dividing:'#F8EEDC', fresh:'#F3D9D2', wound:'#B0645C', line:'#9C7B66' },
    medium: { intact:'#CBA783', edge:'#A87558', dividing:'#EAD6B4', fresh:'#DDB3A3', wound:'#92514A', line:'#6E4F37' },
    deep:   { intact:'#946B52', edge:'#6B4535', dividing:'#C9A184', fresh:'#B58370', wound:'#4F2B2B', line:'#3E2A20' }
  };
  const RULES = [
    { key:'dividing', name:'Dividing',      rule:'divided this step',                               cue:'two small dark nuclei in a pale cell' },
    { key:'edge',     name:'Leading edge',  rule:'at least 1 empty neighbour and moved last step',  cue:'darker shaded band along the wound (no line)' },
    { key:'fresh',    name:'New tissue',    rule:'re-occupied within the last 10 steps, now behind the front', cue:'fine speckle, fading with age' },
    { key:'intact',   name:'Intact',        rule:'no empty neighbour (contact-inhibited, resting)', cue:'flat tone, soft cell mosaic' },
    { key:'wound',    name:'Wound',         rule:'empty site (no cell)',                            cue:'smooth, darkest toward the centre' }
  ];
  function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  const hex = h => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const sstep = (a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };
  function boundary(th, p, W){
    const base = 1 + 0.16*Math.sin(3*th+W.p1) + 0.10*Math.sin(5*th+W.p2) + 0.06*Math.sin(2*th+W.p3);
    const close = Math.min(1, p*(0.92 + 0.14*Math.sin(2*th+W.p4)));
    return Math.max(0, base*(1-close));
  }
  function hash2(x,y,s){ let h=(x*374761393 + y*668265263 + s*2147483647)|0; h=(h^(h>>>13))*1274126177|0; return ((h^(h>>>16))>>>0)/4294967296; }
  function vnoise(x,y,s){ const xi=Math.floor(x), yi=Math.floor(y), xf=x-xi, yf=y-yi, u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf);
    const a=hash2(xi,yi,s), b=hash2(xi+1,yi,s), c=hash2(xi,yi+1,s), d=hash2(xi+1,yi+1,s); return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v; }

  function render(canvas, opt){
    opt = Object.assign({ tone:'light', seed:7, progress:0.55, r:11, window:0.14, overlays:true, dish:null, wound:{cx:0.5,cy:0.5,a:0.30,b:0.20,rot:-0.35} }, opt||{});
    const P = PAL[opt.tone] || PAL.light, C = { intact:hex(P.intact), edge:hex(P.edge), dividing:hex(P.dividing), fresh:hex(P.fresh), wound:hex(P.wound), line:hex(P.line) };
    const dpr = opt.dpr || 1, w = canvas.clientWidth||canvas.width/dpr, h = canvas.clientHeight||canvas.height/dpr;
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    const ctx = canvas.getContext('2d'); ctx.setTransform(1,0,0,1,0,0);
    const R = rng(opt.seed), cs = opt.r*1.95;                       // typical cell spacing in px
    const W = { p1:R()*6.28, p2:R()*6.28, p3:R()*6.28, p4:R()*6.28 };
    const cx = opt.wound.cx*w, cy = opt.wound.cy*h, ca = Math.cos(opt.wound.rot), sa = Math.sin(opt.wound.rot);
    const A = opt.wound.a*Math.min(w,h*1.6), B = opt.wound.b*Math.min(w,h*1.6), Rm = (A+B)/2;
    const pNow = opt.progress, pPrev = Math.max(0, pNow - opt.window);
    // jittered seeds (cell centres), organic irregular mosaic
    const gc = Math.ceil(w/cs)+3, gr = Math.ceil(h/cs)+3, seeds = new Float32Array(gc*gr*5);
    for (let j=0;j<gr;j++) for (let i=0;i<gc;i++){ const k=(j*gc+i)*5;
      seeds[k]=(i-1+0.5+(R()-0.5)*0.85)*cs; seeds[k+1]=(j-1+0.5+(R()-0.5)*0.85)*cs; seeds[k+2]=(R()-0.5); seeds[k+3]=R(); seeds[k+4]=R()*6.283; }
    // wound geometry helpers
    function field(x,y){ const dx=x-cx, dy=y-cy, u=dx*ca+dy*sa, v=-dx*sa+dy*ca, th=Math.atan2(v/B,u/A), d=Math.hypot(u/A,v/B);
      const rb=boundary(th,pNow,W), rp=boundary(th,pPrev,W); return { s:(d-rb)*Rm, f: (rp>rb+1e-6) ? (d>=rb && d<rp ? 1-(d-rb)/(rp-rb) : 0) : 0, ang:th }; }
    const W_ = Math.round(w*dpr), H_ = Math.round(h*dpr), img = ctx.createImageData(W_,H_), px = img.data;
    const wr = cs*0.30, edgeW = cs*0.95, mix=(a,b,t)=>a+(b-a)*t;
    // per-seed classification (for dividing cells + stats)
    const stats={dividing:0,fresh:0,edge:0,intact:0,wound:0}; const dividingSeed = new Uint8Array(gc*gr);
    for (let j=0;j<gr;j++) for (let i=0;i<gc;i++){ const k=(j*gc+i)*5, F=field(seeds[k],seeds[k+1]);
      if (F.s<0){ stats.wound++; continue; } const nearFront = F.s<edgeW*1.1 || F.f>0.2;
      if (nearFront && seeds[k+3]>0.93){ dividingSeed[j*gc+i]=1; stats.dividing++; }
      else if (F.s<edgeW*0.9) stats.edge++; else if (F.f>0.18) stats.fresh++; else stats.intact++; }
    for (let y=0;y<H_;y++){
      const Y=y/dpr;
      for (let x=0;x<W_;x++){
        const X=x/dpr, gi=Math.floor(X/cs)+1, gj=Math.floor(Y/cs)+1;
        let d1=1e9,d2=1e9,n1=-1,n2=-1;
        for (let dj=-1;dj<=1;dj++){ const jj=gj+dj; if (jj<0||jj>=gr) continue;
          for (let di=-1;di<=1;di++){ const ii=gi+di; if (ii<0||ii>=gc) continue; const k=(jj*gc+ii)*5, ex=seeds[k]-X, ey=seeds[k+1]-Y, d=ex*ex+ey*ey;
            if (d<d1){ d2=d1;n2=n1;d1=d;n1=jj*gc+ii; } else if (d<d2){ d2=d;n2=jj*gc+ii; } } }
        d1=Math.sqrt(d1); d2=Math.sqrt(d2); const k1=n1*5; const F=field(X,Y);
        const ww = sstep(-wr, wr, -F.s);                           // wound weight, smooth edge (1 inside)
        // tissue colour: intact tinted per cell, + large-scale mottling
        const mott = vnoise(X/70,Y/70,3)-0.5, wmix = 0.5+0.5*sstep(0, cs*0.5, d2-d1), tcell = seeds[k1+2]*wmix + seeds[n2*5+2]*(1-wmix), tint = 1 + tcell*0.05 + mott*0.04;
        let r=C.intact[0]*tint, g=C.intact[1]*tint, b=C.intact[2]*tint;
        // new tissue (gradient with age) and leading edge (soft band)
        const fw = Math.min(1, F.f*F.f*(3-2*F.f))*0.9;              // 0..0.9
        r=mix(r,C.fresh[0],fw); g=mix(g,C.fresh[1],fw); b=mix(b,C.fresh[2],fw);
        const ew = F.s>=0 ? Math.exp(-Math.pow(F.s/edgeW,2))*0.92 : 0;
        r=mix(r,C.edge[0],ew); g=mix(g,C.edge[1],ew); b=mix(b,C.edge[2],ew);
        // soft cell mosaic (no outline): gentle valleys between cells, nucleus blob
        const val = 1 - sstep(0, cs*0.75, d2-d1), nuc = Math.exp(-Math.pow(d1/(cs*0.22),2));
        const shade = 1 - 0.030*val - 0.045*nuc; r*=shade; g*=shade*0.995; b*=shade*1.0;
        // dividing cells: pale body with two nuclei
        if (dividingSeed[n1]){ const body=1-sstep(cs*0.28,cs*0.62,d1), a=seeds[k1+4], ox=Math.cos(a)*cs*0.13, oy=Math.sin(a)*cs*0.13,
          n_a=Math.exp(-(Math.pow(X-seeds[k1]-ox,2)+Math.pow(Y-seeds[k1+1]-oy,2))/(2*(cs*0.075)**2)), n_b=Math.exp(-(Math.pow(X-seeds[k1]+ox,2)+Math.pow(Y-seeds[k1+1]+oy,2))/(2*(cs*0.075)**2));
          r=mix(r,C.dividing[0],body*0.95); g=mix(g,C.dividing[1],body*0.95); b=mix(b,C.dividing[2],body*0.95);
          const dk=Math.min(1,n_a+n_b)*0.55; r=mix(r,C.line[0],dk); g=mix(g,C.line[1],dk); b=mix(b,C.line[2],dk); }
        // fine speckle in new tissue (non-colour cue)
        if (fw>0.12 && hash2(x,y,9)>0.972){ const sp=Math.min(1,fw*1.4)*0.22; r*=1-sp; g*=1-sp; b*=1-sp; }
        // wound: smooth gradient, darker toward the centre, faint granulation texture
        if (ww>0){ const depth=sstep(0,cs*3.2,-F.s), gr_=(vnoise(X/9,Y/9,5)-0.5)*0.07+(hash2(x,y,2)-0.5)*0.03;
          const wc=[C.wound[0]*(1-0.22*depth)*(1+gr_), C.wound[1]*(1-0.22*depth)*(1+gr_), C.wound[2]*(1-0.20*depth)*(1+gr_)];
          r=mix(r,wc[0],ww); g=mix(g,wc[1],ww); b=mix(b,wc[2],ww); }
        let al=255; if (opt.dish){ const dx=X-opt.dish.cx*w, dy=Y-opt.dish.cy*h, rr=opt.dish.r*Math.min(w,h); al=255*(1-sstep(rr-1.2,rr+0.6,Math.hypot(dx,dy))); }
        const o=(y*W_+x)*4; px[o]=r; px[o+1]=g; px[o+2]=b; px[o+3]=al;
      } }
    ctx.putImageData(img,0,0);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if (opt.overlays){                                               // ensemble-uncertainty contours (data overlay, not a grid outline)
      ctx.save(); ctx.setLineDash([1.5,3.5]); ctx.lineWidth=1.5; ctx.strokeStyle='#4A5A6A';
      [-0.10,0.10].forEach(dp=>{ ctx.beginPath(); for(let k=0;k<=180;k++){ const th=k/180*6.2832, r=boundary(th,Math.min(1,Math.max(0,pNow+dp)),W);
        const u=Math.cos(th)*A*r, v=Math.sin(th)*B*r, x=cx+u*ca-v*sa, y=cy+u*sa+v*ca; k?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.stroke(); });
      ctx.restore();
    }
    const tot = Math.max(1, stats.dividing+stats.fresh+stats.edge+stats.intact+stats.wound);
    return { stats, palette:P, W, geometry:{cx,cy,A,B,ca,sa}, areaFraction: stats.wound/tot };
  }
  // soft round legend swatch (SVG string) with the non-colour cue; no outlines
  function swatch(key, tone, size){
    size = size||28; const P = PAL[tone]||PAL.light, s=size, c=s/2, id='sw'+key+tone+s;
    const dark = (hx,f)=>{ const v=hex(hx).map(x=>Math.round(x*f)); return `rgb(${v})`; };
    let inner='';
    if (key==='wound') inner = `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${dark(P.wound,0.78)}"/><stop offset="1" stop-color="${P.wound}"/></radialGradient></defs><circle cx="${c}" cy="${c}" r="${c-1}" fill="url(#${id})"/>`;
    else if (key==='edge') inner = `<defs><radialGradient id="${id}"><stop offset="0.35" stop-color="${P.intact}"/><stop offset="0.8" stop-color="${P.edge}"/><stop offset="1" stop-color="${dark(P.edge,0.92)}"/></radialGradient></defs><circle cx="${c}" cy="${c}" r="${c-1}" fill="url(#${id})"/>`;
    else if (key==='fresh') inner = `<circle cx="${c}" cy="${c}" r="${c-1}" fill="${P.fresh}"/>` + [[.3,.35],[.62,.3],[.45,.55],[.7,.62],[.28,.68],[.55,.78]].map(p=>`<circle cx="${p[0]*s}" cy="${p[1]*s}" r="0.9" fill="${P.line}" opacity="0.45"/>`).join('');
    else if (key==='dividing') inner = `<defs><radialGradient id="${id}"><stop offset="0.5" stop-color="${P.dividing}"/><stop offset="1" stop-color="${dark(P.dividing,0.94)}"/></radialGradient></defs><circle cx="${c}" cy="${c}" r="${c-1}" fill="url(#${id})"/><circle cx="${c-s*0.11}" cy="${c-s*0.05}" r="${s*0.07}" fill="${P.line}" opacity="0.8"/><circle cx="${c+s*0.11}" cy="${c+s*0.05}" r="${s*0.07}" fill="${P.line}" opacity="0.8"/>`;
    else inner = `<circle cx="${c}" cy="${c}" r="${c-1}" fill="${P.intact}"/>`;
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true">${inner}</svg>`;
  }
  global.CellField = { render, PAL, RULES, swatch };
})(window);
