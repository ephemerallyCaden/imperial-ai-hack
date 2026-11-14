/* Stitch design mockups: shared simulated cell field + state-colour rules.
   Not project code: visual stand-in only. Everything it draws is SIMULATED. */
(function (global) {
  const PAL = {
    light:  { intact:'#E9D3C0', edge:'#C98F7C', dividing:'#F8EEDC', fresh:'#F3D9D2', wound:'#B0645C', line:'#9C7B66' },
    medium: { intact:'#CBA783', edge:'#A87558', dividing:'#EAD6B4', fresh:'#DDB3A3', wound:'#92514A', line:'#6E4F37' },
    deep:   { intact:'#946B52', edge:'#6B4535', dividing:'#C9A184', fresh:'#B58370', wound:'#4F2B2B', line:'#3E2A20' }
  };
  const RULES = [
    { key:'dividing', name:'Dividing',      rule:'divided this step',                               cue:'dark centre dot' },
    { key:'edge',     name:'Leading edge',  rule:'at least 1 empty neighbour and moved last step',  cue:'outline on wound-facing sides' },
    { key:'fresh',    name:'New tissue',    rule:'re-occupied within the last 10 steps, now behind the front', cue:'fine stipple' },
    { key:'intact',   name:'Intact',        rule:'no empty neighbour (contact-inhibited, resting)', cue:'flat fill' },
    { key:'wound',    name:'Wound',         rule:'empty site (no cell)',                            cue:'flat, no outline' }
  ];
  function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

  // wound boundary radius at angle th for progress p in [0,1]; irregular, closes unevenly
  function boundary(th, p, W){
    const base = 1 + 0.16*Math.sin(3*th+W.p1) + 0.10*Math.sin(5*th+W.p2) + 0.06*Math.sin(2*th+W.p3);
    const close = Math.min(1, p*(0.92 + 0.14*Math.sin(2*th+W.p4)));
    return Math.max(0, base*(1-close));
  }
  function render(canvas, opt){
    opt = Object.assign({ tone:'light', seed:7, progress:0.55, r:11, window:0.14, overlays:true, bg:null, wound:{cx:0.5,cy:0.5,a:0.30,b:0.20,rot:-0.35} }, opt||{});
    const P = PAL[opt.tone] || PAL.light;
    const dpr = opt.dpr || 1, w = canvas.clientWidth||canvas.width/dpr, h = canvas.clientHeight||canvas.height/dpr;
    canvas.width = w*dpr; canvas.height = h*dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    const R = rng(opt.seed), S = opt.r*1.7321, rowH = opt.r*1.5;
    const W = { p1:R()*6.28, p2:R()*6.28, p3:R()*6.28, p4:R()*6.28 };
    const cols = Math.ceil(w/S)+2, rows = Math.ceil(h/rowH)+2;
    const cx = opt.wound.cx*w, cy = opt.wound.cy*h, ca = Math.cos(opt.wound.rot), sa = Math.sin(opt.wound.rot);
    const A = opt.wound.a*Math.min(w,h*1.6), B = opt.wound.b*Math.min(w,h*1.6);
    const cells = [], grid = new Map();
    function insideAt(x,y,p){ const dx=x-cx, dy=y-cy; const u=(dx*ca+dy*sa), v=(-dx*sa+dy*ca);
      const th=Math.atan2(v/B,u/A), d=Math.hypot(u/A,v/B); return d < boundary(th,p,W); }
    const pNow = opt.progress, pPrev = Math.max(0, pNow - opt.window);
    for (let j=-1;j<rows;j++) for (let i=-1;i<cols;i++){
      const x = i*S + (j&1? S/2:0) + (R()-0.5)*S*0.10, y = j*rowH + (R()-0.5)*S*0.10;
      const c = { i, j, x, y, empty: insideAt(x,y,pNow), wasEmpty: insideAt(x,y,pPrev), rnd:R() };
      cells.push(c); grid.set(i+','+j, c);
    }
    const nb = (c)=>{ const even=!(c.j&1); const d= even? [[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]] : [[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]];
      return d.map(([di,dj])=>grid.get((c.i+di)+','+(c.j+dj))); };
    // background = wound colour; occupied cells drawn on top
    ctx.fillStyle = opt.bg || P.intact; ctx.fillRect(0,0,w,h);
    const stats = { dividing:0, fresh:0, edge:0, intact:0, wound:0 };
    cells.forEach(c=>{
      if (c.empty) { stats.wound++; return; }
      const ns = nb(c); const emptyN = ns.map(n=> n && n.empty);
      const hasEmpty = emptyN.some(Boolean);
      const fresh = c.wasEmpty;                  // re-occupied within the window
      const edge = hasEmpty && c.rnd < 0.9;      // moved last step (most edge cells)
      const dividing = (edge || fresh) && c.rnd > 0.935;
      c.state = dividing ? 'dividing' : edge ? 'edge' : fresh ? 'fresh' : 'intact';
      stats[c.state]++; c.emptyN = emptyN;
    });
    // draw cells
    const ang = [0,1,2,3,4,5].map(k=> Math.PI/6 + k*Math.PI/3);
    const rad = opt.r*1.03;
    cells.forEach(c=>{
      if (c.empty) { ctx.beginPath(); ang.forEach((a,k)=>{ const px=c.x+rad*Math.cos(a), py=c.y+rad*Math.sin(a); k?ctx.lineTo(px,py):ctx.moveTo(px,py); }); ctx.closePath(); ctx.fillStyle=P.wound; ctx.fill(); ctx.lineWidth=0.5; ctx.strokeStyle=P.wound; ctx.stroke(); return; }
      ctx.beginPath(); ang.forEach((a,k)=>{ const px=c.x+rad*Math.cos(a), py=c.y+rad*Math.sin(a); k?ctx.lineTo(px,py):ctx.moveTo(px,py); }); ctx.closePath();
      ctx.fillStyle = P[c.state]; ctx.fill(); ctx.lineWidth = 0.6; ctx.strokeStyle = P.line+'55'; ctx.stroke();
    });
    // secondary cues
    cells.forEach(c=>{
      if (c.empty) return;
      if (c.state==='edge' || c.state==='dividing' && c.emptyN.some(Boolean)){
        // outline on sides facing the wound: approximate by drawing arcs toward empty neighbours
        const dirs = c.j&1 ? [[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]] : [[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]];
        ctx.strokeStyle = P.line; ctx.lineWidth = 1.2; ctx.beginPath();
        c.emptyN.forEach((e,k)=>{ if(!e) return; const n = grid.get((c.i+dirs[k][0])+','+(c.j+dirs[k][1])); if(!n) return;
          const mx=(c.x+n.x)/2, my=(c.y+n.y)/2, dx=n.x-c.x, dy=n.y-c.y, L=Math.hypot(dx,dy)||1, px=-dy/L, py=dx/L, hl=rad*0.52;
          ctx.moveTo(mx-px*hl,my-py*hl); ctx.lineTo(mx+px*hl,my+py*hl); });
        ctx.stroke();
      }
      if (c.state==='dividing'){ ctx.fillStyle=P.line; ctx.beginPath(); ctx.arc(c.x,c.y,Math.max(1.4,rad*0.18),0,6.283); ctx.fill(); }
      if (c.state==='fresh'){ ctx.fillStyle=P.line+'99'; for(let k=0;k<3;k++){ const a=c.rnd*6.28+k*2.09; ctx.beginPath(); ctx.arc(c.x+Math.cos(a)*rad*0.38,c.y+Math.sin(a)*rad*0.38,0.9,0,6.283); ctx.fill(); } }
    });
    // overlay: ensemble-uncertainty contours (10% and 90% occupancy spread) as dotted lines
    if (opt.overlays){
      ctx.save(); ctx.setLineDash([1.5,3.5]); ctx.lineWidth=1.5; ctx.strokeStyle='#4A5A6A';
      [-0.10,0.10].forEach(dp=>{ ctx.beginPath(); for(let k=0;k<=180;k++){ const th=k/180*6.2832, r=boundary(th,Math.min(1,Math.max(0,pNow+dp)),W);
          const u=Math.cos(th)*A*r, v=Math.sin(th)*B*r, x=cx+u*ca-v*sa, y=cy+u*sa+v*ca; k?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.stroke(); });
      ctx.restore();
    }
    return { stats, palette:P, W, geometry:{cx,cy,A,B,ca,sa}, areaFraction: stats.wound/Math.max(1,cells.length) };
  }
  global.CellField = { render, PAL, RULES };
})(window);
