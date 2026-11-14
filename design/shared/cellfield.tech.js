/* Stitch mockups: technical hex-lattice renderer (flat state fills on black, rulers, contours, vectors). SIMULATED. */
(function (global) {
  const UM_PER_PX = 100/60;
  const PAL = { intact:'#4B4FA8', edge:'#F1605D', dividing:'#FCFDBF', fresh:'#C0388A', wound:'#06060B', grid:'#22222E', ink:'#ECECEC' };
  const RULES = [
    { key:'dividing', name:'Dividing',     rule:'divided this step',                               cue:'dark centre dot' },
    { key:'edge',     name:'Leading edge', rule:'at least 1 empty neighbour and moved last step',  cue:'white bars on wound-facing sides' },
    { key:'fresh',    name:'New tissue',   rule:'re-occupied within the last 10 steps, now behind the front', cue:'three small dots' },
    { key:'intact',   name:'Intact',       rule:'no empty neighbour (contact-inhibited, resting)', cue:'flat fill, no mark' },
    { key:'wound',    name:'Wound',        rule:'empty site (no cell)',                            cue:'near-black, hairline outline only' }
  ];
  function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function boundary(th,p,W){ const base=1+0.16*Math.sin(3*th+W.p1)+0.10*Math.sin(5*th+W.p2)+0.06*Math.sin(2*th+W.p3);
    const close=Math.min(1,p*(0.92+0.14*Math.sin(2*th+W.p4))); return Math.max(0,base*(1-close)); }
  const ANG=[0,1,2,3,4,5].map(k=>Math.PI/6+k*Math.PI/3);
  function hexPath(ctx,x,y,r){ ctx.beginPath(); ANG.forEach((a,k)=>{const px=x+r*Math.cos(a),py=y+r*Math.sin(a);k?ctx.lineTo(px,py):ctx.moveTo(px,py);}); ctx.closePath(); }
  function render(canvas,opt){
    opt=Object.assign({seed:7,progress:0.62,r:11,window:0.14,overlays:true,axes:false,dpr:1,wound:{cx:0.5,cy:0.5,a:0.30,b:0.20,rot:-0.35}},opt||{});
    const dpr=opt.dpr,w=canvas.clientWidth||canvas.width/dpr,h=canvas.clientHeight||canvas.height/dpr;
    canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    const R=rng(opt.seed),S=opt.r*1.7321,rowH=opt.r*1.5,W={p1:R()*6.28,p2:R()*6.28,p3:R()*6.28,p4:R()*6.28};
    const cols=Math.ceil(w/S)+2,rows=Math.ceil(h/rowH)+2;
    const cx=opt.wound.cx*w,cy=opt.wound.cy*h,ca=Math.cos(opt.wound.rot),sa=Math.sin(opt.wound.rot);
    const A=opt.wound.a*Math.min(w,h*1.6),B=opt.wound.b*Math.min(w,h*1.6);
    const cells=[],grid=new Map();
    function inside(x,y,p){const dx=x-cx,dy=y-cy,u=dx*ca+dy*sa,v=-dx*sa+dy*ca;return Math.hypot(u/A,v/B)<boundary(Math.atan2(v/B,u/A),p,W);}
    const pNow=opt.progress,pPrev=Math.max(0,pNow-opt.window);let w0=0;
    for(let j=-1;j<rows;j++)for(let i=-1;i<cols;i++){const x=i*S+(j&1?S/2:0),y=j*rowH;
      const c={i,j,x,y,empty:inside(x,y,pNow),wasEmpty:inside(x,y,pPrev),rnd:R()};if(inside(x,y,0))w0++;cells.push(c);grid.set(i+','+j,c);}
    const D=c=>c.j&1?[[-1,0],[1,0],[0,-1],[1,-1],[0,1],[1,1]]:[[-1,0],[1,0],[-1,-1],[0,-1],[-1,1],[0,1]];
    const stats={dividing:0,fresh:0,edge:0,intact:0,wound:0};
    cells.forEach(c=>{if(c.empty){stats.wound++;return;}
      c.eN=D(c).map(d=>{const n=grid.get((c.i+d[0])+','+(c.j+d[1]));return n&&n.empty;});
      const he=c.eN.some(Boolean),edge=he&&c.rnd<0.9,fresh=c.wasEmpty,div=(edge||fresh)&&c.rnd>0.935;
      c.state=div?'dividing':edge?'edge':fresh?'fresh':'intact';stats[c.state]++;});
    ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
    const rad=opt.flat?opt.r*1.04:opt.r*0.93;
    cells.forEach(c=>{hexPath(ctx,c.x,c.y,rad);
      if(c.empty){ctx.fillStyle=PAL.wound;ctx.fill();if(!opt.flat&&opt.r>=5){ctx.lineWidth=.5;ctx.strokeStyle=PAL.grid;ctx.stroke();}}
      else{ctx.fillStyle=PAL[c.state];ctx.fill();}});
    cells.forEach(c=>{if(c.empty||opt.r<6)return;
      if(opt.flat){if(c.state==='edge'){ctx.fillStyle='#fff';ctx.fillRect(c.x-rad*.3,c.y-.8,rad*.6,1.6);}}else if(c.state==='edge'||(c.state==='dividing'&&c.eN.some(Boolean))){ctx.strokeStyle='#fff';ctx.lineWidth=1.4;ctx.beginPath();
        c.eN.forEach((e,k)=>{if(!e)return;const d=D(c)[k],n=grid.get((c.i+d[0])+','+(c.j+d[1]));const mx=(c.x+n.x)/2,my=(c.y+n.y)/2,dx=n.x-c.x,dy=n.y-c.y,L=Math.hypot(dx,dy)||1,px=-dy/L,py=dx/L,hl=rad*0.5;
          ctx.moveTo(mx-px*hl,my-py*hl);ctx.lineTo(mx+px*hl,my+py*hl);});ctx.stroke();}
      if(c.state==='dividing'){ctx.fillStyle='#1A0F00';ctx.beginPath();ctx.arc(c.x,c.y,Math.max(1.6,rad*.2),0,6.283);ctx.fill();}
      if(c.state==='fresh'){ctx.fillStyle='#FFD6EE';for(let k=0;k<3;k++){const a=c.rnd*6.28+k*2.09;ctx.beginPath();ctx.arc(c.x+Math.cos(a)*rad*.4,c.y+Math.sin(a)*rad*.4,.9,0,6.283);ctx.fill();}}});
    const pt=(th,p)=>{const r=boundary(th,p,W),u=Math.cos(th)*A*r,v=Math.sin(th)*B*r;return[cx+u*ca-v*sa,cy+u*sa+v*ca];};
    const contour=(p,col,dash,lw)=>{ctx.save();ctx.setLineDash(dash);ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.beginPath();for(let k=0;k<=180;k++){const q=pt(k/180*6.2832,p);k?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);}ctx.stroke();ctx.restore();};
    const geo={cx,cy,A,B,ca,sa,W,pt};
    if(opt.overlays){
      // fine registration crosses every 100 um
      ctx.strokeStyle='rgba(236,236,236,.35)';ctx.lineWidth=1;ctx.beginPath();
      for(let x=60;x<w;x+=60)for(let y=60;y<h;y+=60){ctx.moveTo(x-4,y);ctx.lineTo(x+4,y);ctx.moveTo(x,y-4);ctx.lineTo(x,y+4);}ctx.stroke();
      contour(0.20,'#ECECEC',[5,4],1.2);contour(0.90,'#56B4E9',[6,3],1.5);
      contour(pNow-0.10,'#8EA0C8',[1.5,3.5],1);contour(pNow+0.10,'#8EA0C8',[1.5,3.5],1);
      // velocity vectors on leading edge
      ctx.strokeStyle='#fff';ctx.fillStyle='#fff';ctx.lineWidth=1.2;
      cells.forEach(c=>{if(c.empty||c.state!=='edge'||((c.i*7+c.j*3)%4))return;const dx=cx-c.x,dy=cy-c.y,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,len=Math.max(opt.r*2.4,15),x0=c.x,y0=c.y,x1=x0+ux*len,y1=y0+uy*len;
        ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x1-ux*5+uy*3,y1-uy*5-ux*3);ctx.lineTo(x1-ux*5-uy*3,y1-uy*5+ux*3);ctx.closePath();ctx.fill();});
      // contour labels
      ctx.font='10px ui-monospace,Menlo,monospace';ctx.textBaseline='middle';
      const lab=(th,p,t,col)=>{const q=pt(th,p),tw=ctx.measureText(t).width+8;ctx.fillStyle='#000';ctx.fillRect(q[0]-tw/2,q[1]-7,tw,14);ctx.fillStyle=col;ctx.fillText(t,q[0]-tw/2+4,q[1]);};
      lab(3.9,0.20,'t0 6 h','#ECECEC');lab(5.4,0.90,'forecast 90% closure','#56B4E9');
      // probe
      let best=null,bd=1e9;cells.forEach(c=>{if(c.empty||c.state!=='edge')return;const d=Math.abs(Math.atan2(c.y-cy,c.x-cx)-(0.6))+Math.abs(Math.hypot(c.x-cx,c.y-cy)-A*0.7)*0.01;if(d<bd){bd=d;best=c;}});
      if(best&&opt.r>=6){ctx.strokeStyle='#E0A458';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(best.x,best.y,opt.r*1.5,0,6.283);ctx.moveTo(best.x-opt.r*2.4,best.y);ctx.lineTo(best.x+opt.r*2.4,best.y);ctx.moveTo(best.x,best.y-opt.r*2.4);ctx.lineTo(best.x,best.y+opt.r*2.4);ctx.stroke();
        const bx=best.x+34,by=best.y+30;ctx.beginPath();ctx.moveTo(best.x+opt.r*1.1,best.y+opt.r*1.1);ctx.lineTo(bx,by);ctx.stroke();
        ctx.fillStyle='#000';ctx.fillRect(bx,by,190,34);ctx.strokeRect(bx,by,190,34);ctx.fillStyle='#E0A458';ctx.fillText('site ('+best.i+','+best.j+') x '+Math.round(best.x*UM_PER_PX)+' y '+Math.round(best.y*UM_PER_PX)+' um',bx+6,by+11);ctx.fillStyle='#ECECEC';ctx.fillText('Leading edge  v ~ 21 um/h',bx+6,by+25);}
    }
    if(opt.axes){ // rulers in um
      ctx.fillStyle='#000';ctx.fillRect(0,0,w,18);ctx.fillRect(0,0,26,h);ctx.strokeStyle='#7E7E7E';ctx.fillStyle='#B4B4B4';ctx.lineWidth=1;ctx.font='10px ui-monospace,Menlo,monospace';ctx.textBaseline='alphabetic';
      ctx.beginPath();ctx.moveTo(26,18.5);ctx.lineTo(w,18.5);ctx.moveTo(26.5,18);ctx.lineTo(26.5,h);
      for(let x=0;x<w;x+=30){const maj=!(x%60);ctx.moveTo(x+.5,18);ctx.lineTo(x+.5,maj?8:13);}
      for(let y=0;y<h;y+=30){const maj=!(y%60);ctx.moveTo(26,y+.5);ctx.lineTo(maj?16:21,y+.5);}ctx.stroke();
      for(let x=60;x<w;x+=60)ctx.fillText(Math.round(x*UM_PER_PX),x+2,9);
      ctx.save();for(let y=60;y<h;y+=60){ctx.save();ctx.translate(14,y-2);ctx.rotate(-Math.PI/2);ctx.fillText(Math.round(y*UM_PER_PX),0,0);ctx.restore();}ctx.restore();
      ctx.fillStyle='#E0A458';ctx.fillText('um',4,12);
    }
    const siteUm2=2.598*opt.r*opt.r*UM_PER_PX*UM_PER_PX;
    return {stats,geometry:geo,W,n:cells.length-stats.wound,woundPct:100*stats.wound/Math.max(1,w0),woundUm2:stats.wound*siteUm2};
  }
  function swatch(key,size,flat){size=size||20;const c=size/2,r=c-1,P=PAL;let pts=ANG.map(a=>(c+r*Math.cos(a)).toFixed(1)+','+(c+r*Math.sin(a)).toFixed(1)).join(' ');
    let s='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'"><polygon points="'+pts+'" fill="'+P[key]+'"'+(key==='wound'&&!flat?' stroke="#3A3F52" stroke-width=".8"':'')+'/>';
    if(key==='dividing')s+='<circle cx="'+c+'" cy="'+c+'" r="2" fill="#1A0F00"/>';
    if(key==='edge')s+='<line x1="'+(c-r*.3)+'" x2="'+(c+r*.3)+'" y1="'+(flat?c:size-2.5)+'" y2="'+(flat?c:size-2.5)+'" stroke="#fff" stroke-width="1.4"/>';
    if(key==='fresh')s+=[0,2.09,4.18].map(a=>'<circle cx="'+(c+Math.cos(a)*r*.4)+'" cy="'+(c+Math.sin(a)*r*.4)+'" r=".9" fill="#FFD6EE"/>').join('');
    return s+'</svg>';}
  global.TechField={render,RULES,swatch,PAL,UM_PER_PX};
})(window);
