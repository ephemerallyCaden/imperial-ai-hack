/* NCA simulation mockup engine (M10 grid, M11 organic).
   A stochastic lattice (Migliaccio-style rules) stands in for the trained NCA ensemble:
   edge cells migrate toward the wound or divide; interior cells wait (contact inhibition). */
(function(){
const PALS={
  light:{intact:'#E9D3C0',edge:'#C98F7C',div:'#F8EEDC',fresh:'#F3D9D2',wound:'#B0645C'},
  medium:{intact:'#CBA783',edge:'#A87558',div:'#EAD6B4',fresh:'#DDB3A3',wound:'#92514A'},
  deep:{intact:'#946B52',edge:'#6B4535',div:'#C9A184',fresh:'#B58370',wound:'#4F2B2B'}};
const OPT={W:96,H:64,steps:240,pm:.02,pd:.012,beta:1.6,refill:.7,hoursPerStep:.1,t0:60};
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const A=hex(a),B=hex(b);return'#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')};
function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}

const HY=.8660254,PXc=(x,y)=>x+.5*(y&1)+.5,PYc=y=>y*HY+.5;
const NBE=[[1,0],[-1,0],[0,-1],[-1,-1],[0,1],[-1,1]],NBO=[[1,0],[-1,0],[1,-1],[0,-1],[1,1],[0,1]];
const nbrsOf=y=>(y&1)?NBO:NBE;
function run(seed,record,div){
  const o=Object.assign({},OPT),W=o.W,H=o.H,N=W*H,R=rng(seed*7919+13),S=rng(5);
  o.pm*=.7+.6*R();o.pd*=.6+.8*R();if(div===false)o.pd=0;
  const cx=.5*(W+.5),cy=.5*(H*HY+.134),A=.26*W,B=.17*W,rot=-.35,ca=Math.cos(rot),sa=Math.sin(rot);
  const p1=S()*6.28,p2=S()*6.28;
  const orig=new Uint8Array(N),id=new Int32Array(N).fill(-1);
  const X=[],Y=[],PX=[],PY=[],DIV=[],BORN=[];
  const add=(x,y,px,py,k,born)=>{const c=X.length;X.push(x);Y.push(y);PX.push(px);PY.push(py);DIV.push(-9);BORN.push(born);id[y*W+x]=c;return c};
  let empties0=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const dx=PXc(x,y)-cx,dy=PYc(y)-cy,u=(dx*ca+dy*sa)/A,v=(-dx*sa+dy*ca)/B,th=Math.atan2(v,u);
    const rr=Math.hypot(u,v)/(1+.1*Math.sin(3*th+p1)+.07*Math.sin(5*th+p2));
    if(rr<1){orig[y*W+x]=1;empties0++}else add(x,y,x,y,0,0);
  }
  const area=new Float32Array(o.steps+1),cells=new Int32Array(o.steps+1),divs=new Int32Array(o.steps+1);
  const hist=[];let nd=0,live=X.length;
  function snap(k){
    area[k]=(N-live)/empties0;cells[k]=live;divs[k]=nd;
    if(!record)return;
    const a=[];for(let c=0;c<X.length;c++)if(X[c]>=0)a.push(c,X[c],Y[c],PX[c],PY[c],DIV[c]>=k-1&&DIV[c]>=0?1:0,BORN[c]);
    hist.push(Int16Array.from(a));
  }
  snap(0);
  function pick(x,y,list){
    const d0=Math.hypot(PXc(x,y)-cx,PYc(y)-cy);let w=[],s=0;
    for(const[nx,ny]of list){const q=Math.exp(o.beta*(d0-Math.hypot(PXc(nx,ny)-cx,PYc(ny)-cy)));w.push(q);s+=q}
    let r=R()*s;for(let i=0;i<list.length;i++){r-=w[i];if(r<=0)return list[i]}return list[list.length-1];
  }
  for(let k=1;k<=o.steps;k++){
    for(let c=0;c<X.length;c++){if(X[c]>=0){PX[c]=X[c];PY[c]=Y[c];BORN[c]=0}}
    const alive=[];for(let c=0;c<X.length;c++)if(X[c]>=0)alive.push(c);
    for(let i=alive.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[alive[i],alive[j]]=[alive[j],alive[i]]}
    for(const c of alive){
      const x=X[c],y=Y[c],em=[];
      for(const[dx,dy]of nbrsOf(y)){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<W&&ny<H&&id[ny*W+nx]<0)em.push([nx,ny])}
      if(!em.length)continue;
      const r=R();
      if(r<o.pm){const[nx,ny]=pick(x,y,em);id[y*W+x]=-1;id[ny*W+nx]=c;X[c]=nx;Y[c]=ny;
        let vx=x,vy=y;
        for(let it=0;it<60;it++){ // followers fill the vacancy outward (sheet moves together)
          let best=null,bd=Math.hypot(PXc(vx,vy)-cx,PYc(vy)-cy);
          for(const[dx,dy]of nbrsOf(vy)){const ax=vx+dx,ay=vy+dy;if(ax<0||ay<0||ax>=W||ay>=H)continue;const f=id[ay*W+ax];if(f<0)continue;const d=Math.hypot(PXc(ax,ay)-cx,PYc(ay)-cy);if(d>bd+.2&&R()<.9){bd=d;best=[ax,ay,f]}}
          if(!best)break;
          const[ax,ay,f]=best;id[vy*W+vx]=f;id[ay*W+ax]=-1;X[f]=vx;Y[f]=vy;vx=ax;vy=ay;
        }}
      else if(r<o.pm+o.pd){const[nx,ny]=pick(x,y,em);add(nx,ny,x,y,k,2);DIV[c]=k;DIV[X.length-1]=k;nd++;live++}
    }
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if((x===0||y===0||x===W-1||y===H-1)&&id[y*W+x]<0&&R()<o.refill){add(x,y,x,y,k,3);live++}
    }
    snap(k);
  }
  return{area,cells,divs,hist,orig,W,H,cx,cy,empties0};
}

const CSS=`
:root{--bg:#F6F2EC;--ink:#1F1B18;--ink2:#4A423B;--hair:#CFC6BB;--panel:#FBF8F3;--blue:#0072B2;--violet:#6F5BB5}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1440px;height:900px;overflow:hidden;background:var(--bg);color:var(--ink);font:13px Charter,"Iowan Old Style",Georgia,serif;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
button{font:inherit;color:inherit;background:none;border:1px solid var(--ink2);border-radius:0;cursor:pointer;min-height:28px;padding:0 12px}
button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
button:focus-visible,input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
#app{display:grid;grid-template-columns:1100px 340px;grid-template-rows:52px 1fr 96px;width:1440px;height:900px}
header{grid-column:1/3;display:flex;align-items:center;gap:16px;padding:0 20px;border-bottom:1px solid var(--hair);background:var(--panel)}
.word{font:600 22px "Avenir Next Condensed","Arial Narrow",sans-serif;letter-spacing:.2em;text-transform:uppercase}
.sub{font-style:italic;color:var(--ink2);padding-left:16px;border-left:1px solid var(--hair)}
.sp{flex:1}
.chip{font:11.5px ui-monospace,Menlo,monospace;border:1px solid var(--ink2);padding:4px 8px;letter-spacing:.04em}
.seg{display:inline-flex}.seg button{margin-left:-1px;min-height:28px;padding:0 10px}.seg button:first-child{margin-left:0}
#stage{display:flex;align-items:center;justify-content:center;background:var(--bg);position:relative}
#cv{display:block}
#scale{position:absolute;left:70px;bottom:26px;font:11.5px ui-monospace,Menlo,monospace;color:var(--ink2)}
#scale i{display:block;width:100px;height:6px;border:1px solid var(--ink);border-top:0;margin-bottom:4px}
#tag{position:absolute;right:70px;top:34px;font:11.5px ui-monospace,Menlo,monospace;border:1px solid var(--ink2);background:var(--panel);padding:4px 8px}
aside{grid-column:2;grid-row:2/4;border-left:1px solid var(--hair);background:var(--panel);padding:16px 18px;overflow:hidden}
h3{font:600 12px "Avenir Next Condensed","Arial Narrow",sans-serif;letter-spacing:.14em;text-transform:uppercase;margin:0 0 8px;color:var(--ink2)}
.sec{padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--hair)}
.leg{display:grid;grid-template-columns:22px 1fr;gap:6px 10px;align-items:center;font-size:12.5px}
.leg i{width:22px;height:14px;display:block}
table{border-collapse:collapse;width:100%;font-size:12.5px}td{padding:4px 0}td+td{text-align:right;font-family:ui-monospace,Menlo,monospace}
.note{font-size:12px;color:var(--ink2);line-height:1.45}
#dock{grid-column:1/2;border-top:1px solid var(--hair);background:var(--panel);display:flex;align-items:center;gap:14px;padding:0 20px}
#scrub{flex:1;accent-color:var(--ink)}
.lab{font:11.5px ui-monospace,Menlo,monospace;color:var(--ink2)}
`;

function mount(mode){
  const q=new URLSearchParams(location.search),tone=PALS[q.get('tone')]?q.get('tone'):'medium';
  let pal=PALS[tone],member=Math.max(1,Math.min(12,+q.get('member')||3)),pos=q.has('p')?+q.get('p'):120,playing=q.get('play')!=='0',speed=1,outline=q.get('outline')!=='0',div=q.get('div')!=='0';
  const grid=mode==='grid',S=10;
  document.head.appendChild(Object.assign(document.createElement('style'),{textContent:CSS}));
  const title=grid?'M10 NCA discrete grid':'M11 NCA organic';
  document.title='Stitch | '+title;
  document.body.innerHTML=`<div id="app">
<header><span class="word">Stitch</span><span class="sub">${grid?'Discrete hexagonal lattice: one site, one cell, one step':'Organic view: the same rules, drawn as moving, dividing cells'}</span><span class="sp"></span>
<span class="chip">SIMULATED CELLS - not tracked cells</span><button id="dv" aria-pressed="${div}">Division ${div?'on':'off'}</button>${grid?`<button id="ol" aria-pressed="${outline}">Outlines ${outline?'on':'off'}</button>`:''}
<span class="seg" role="group" aria-label="Tissue tone">${['light','medium','deep'].map(t=>`<button data-tone="${t}" aria-pressed="${t===tone}">${t}</button>`).join('')}</span></header>
<div id="stage"><canvas id="cv"></canvas><div id="tag" class="mono"></div><div id="scale"><i></i>200 um (simulated)</div></div>
<aside>
<div class="sec"><h3>State key</h3><div class="leg" id="leg"></div></div>
<div class="sec"><h3>Readout</h3><table id="ro"></table></div>
<div class="sec"><h3>Ensemble: wound area, 12 members</h3><canvas id="ch" width="592" height="260" style="width:296px;height:130px;display:block"></canvas>
<div class="lab" style="margin-top:6px">band 5-95% and 25-75%; line = median; dashed = member ${member}</div></div>
<div class="note">${grid?'Each step, an edge cell moves into an empty neighbour of its six (p 0.02, biased toward the wound; followers close the gap behind it), divides (p 0.012) or waits. Interior cells wait: contact inhibition. Outer border is refilled (the surrounding monolayer). Division off = movement only, as in mitomycin-treated WHAD.':'Same rules and same numbers as M10. Moves and divisions are interpolated between steps and cells are drawn as soft blobs, so no grid shows. Division = pale cell with two nuclei, then a daughter eases out.'}
<br><br>Mockup: stochastic lattice rules stand in for the trained NCA ensemble. Not a clinical model.</div>
</aside>
<div id="dock"><button id="pp" aria-label="Play or pause" style="width:76px"></button>
<button id="bk" aria-label="Step back">-1</button><button id="fw" aria-label="Step forward">+1</button>
<span class="seg" id="spd" role="group" aria-label="Speed">${[1,2,4].map(s=>`<button data-s="${s}" aria-pressed="${s===1}">${s}x</button>`).join('')}</span>
<span class="lab">t = 0</span><input id="scrub" type="range" min="0" max="${OPT.steps}" step="0.01" aria-label="Time"><span class="lab">t = ${(OPT.steps*OPT.hoursPerStep).toFixed(0)} h</span>
<span class="seg" id="mem" role="group" aria-label="Ensemble member"></span></div></div>`;
  const $=s=>document.querySelector(s),cv=$('#cv'),ctx=cv.getContext('2d');
  const dpr=2,CW=Math.round((OPT.W+.5)*S),CH=Math.round((OPT.H*HY+.134)*S);cv.width=CW*dpr;cv.height=CH*dpr;cv.style.width=CW+'px';cv.style.height=CH+'px';ctx.scale(dpr,dpr);
  let ens,cur;const build=()=>{ens=[];for(let m=1;m<=12;m++)ens.push(run(m,false,div));cur=run(member,true,div)};build();
  function legend(){
    const items=[['intact','Intact tissue'],['edge','Leading edge (2+ of 6 neighbours empty)'],['fresh','New tissue (in original wound)'],['div','Dividing cell'],['wound','Wound (empty)']];
    $('#leg').innerHTML=items.map(([k,n])=>`<i style="background:${pal[k]}"></i><span>${n}</span>`).join('');
  }
  function ribbon(){
    const c=$('#ch'),g=c.getContext('2d');g.setTransform(2,0,0,2,0,0);g.clearRect(0,0,296,130);
    const L=34,Rr=8,T=8,Bm=22,w=296-L-Rr,h=130-T-Bm,n=OPT.steps,X=k=>L+k/n*w,Y=v=>T+(1-v)*h;
    g.strokeStyle='#CFC6BB';g.fillStyle='#4A423B';g.font='11px ui-monospace,Menlo,monospace';g.lineWidth=1;
    [0,.5,1].forEach(v=>{g.beginPath();g.moveTo(L,Y(v));g.lineTo(L+w,Y(v));g.stroke();g.fillText((v*100)+'%',2,Y(v)+4)});
    g.fillText('0',L,126);g.fillText((n*OPT.hoursPerStep)+' h',L+w-30,126);
    const qs=k=>{const a=ens.map(e=>e.area[k]).sort((x,y)=>x-y);return[a[0],a[2],a[5]/2+a[6]/2,a[9],a[11]]};
    const Q=[];for(let k=0;k<=n;k++)Q.push(qs(k));
    const band=(i,j,col)=>{g.fillStyle=col;g.beginPath();for(let k=0;k<=n;k++)g.lineTo(X(k),Y(Q[k][i]));for(let k=n;k>=0;k--)g.lineTo(X(k),Y(Q[k][j]));g.fill()};
    band(0,4,'rgba(111,91,181,.22)');band(1,3,'rgba(111,91,181,.38)');
    g.strokeStyle='#1F1B18';g.lineWidth=1.6;g.beginPath();for(let k=0;k<=n;k++)g.lineTo(X(k),Y(Q[k][2]));g.stroke();
    g.setLineDash([4,3]);g.lineWidth=1.2;g.strokeStyle='#0072B2';g.beginPath();for(let k=0;k<=n;k++)g.lineTo(X(k),Y(cur.area[k]));g.stroke();g.setLineDash([]);
    g.strokeStyle='#1F1B18';g.lineWidth=1;g.beginPath();g.moveTo(X(OPT.t0),T);g.lineTo(X(OPT.t0),T+h);g.stroke();g.fillStyle='#1F1B18';g.fillText('t0',X(OPT.t0)+3,T+10);
    g.beginPath();g.moveTo(X(pos),T);g.lineTo(X(pos),T+h);g.strokeStyle='#0072B2';g.lineWidth=2;g.stroke();
  }
  const sm=u=>u*u*(3-2*u);
  function frame(){
    const W=OPT.W,H=OPT.H,n=OPT.steps,f=Math.min(n-1,Math.floor(pos)),u=pos>=n?1:pos-f;
    const k=grid?Math.min(n,Math.round(pos)):f+1,sn=cur.hist[k],occ=new Uint8Array(W*H).fill(0),cl=sn.length/7;
    for(let i=0;i<sn.length;i+=7)occ[sn[i+2]*W+sn[i+1]]=1;
    const emptyN=(x,y)=>{let n=0;for(const[dx,dy]of nbrsOf(y)){const a=x+dx,b=y+dy;if(a>=0&&b>=0&&a<W&&b<H&&!occ[b*W+a])n++}return n>=2};
    ctx.clearRect(0,0,CW,CH);
    if(grid){
      ctx.fillStyle=outline?mix(pal.intact,'#000000',.55):pal.intact;ctx.fillRect(0,0,CW,CH);
      const Rh=S/Math.sqrt(3)+(outline?-.7:.55),hexp=(x,y)=>{const cx=PXc(x,y)*S,cy=PYc(y)*S;ctx.beginPath();for(let a=0;a<6;a++){const t=Math.PI/6+a*Math.PI/3;ctx.lineTo(cx+Rh*Math.cos(t),cy+Rh*Math.sin(t))}ctx.closePath()};
      ctx.fillStyle=pal.wound;
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!occ[y*W+x]){hexp(x,y);ctx.fill()}
      for(let i=0;i<sn.length;i+=7){
        const x=sn[i+1],y=sn[i+2],div=sn[i+5],cx=PXc(x,y)*S,cy=PYc(y)*S;
        ctx.fillStyle=div?pal.div:emptyN(x,y)?pal.edge:cur.orig[y*W+x]?pal.fresh:pal.intact;
        hexp(x,y);ctx.fill();
        if(div){ctx.fillStyle=mix(pal.edge,'#000000',.2);ctx.fillRect(cx-2.6,cy-.6,5.2,1.2)}
        else if(sn[i+3]!==x||sn[i+4]!==y){ctx.fillStyle='rgba(31,27,24,.55)';ctx.fillRect(cx-1,cy-1,2,2)}
      }
    }else{
      const g=ctx.createRadialGradient(cur.cx*S,cur.cy*S,0,cur.cx*S,cur.cy*S,26*S);
      g.addColorStop(0,mix(pal.wound,'#000000',.22));g.addColorStop(1,pal.wound);
      ctx.fillStyle=g;ctx.fillRect(0,0,CW,CH);
      const e=sm(u),spr={};
      const sprite=col=>{if(spr[col])return spr[col];const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),r=x.createRadialGradient(32,32,0,32,32,32);
        r.addColorStop(0,col);r.addColorStop(.58,col);r.addColorStop(1,col+'00');x.fillStyle=r;x.fillRect(0,0,64,64);return spr[col]=c};
      const nuc=mix(pal.intact,'#000000',.45);
      const hash=c=>{let h=Math.imul(c+1,2654435761)>>>0;return[(h&255)/255,((h>>>8)&255)/255,((h>>>16)&255)/255]};
      for(let i=0;i<sn.length;i+=7){
        const id=sn[i],x=sn[i+1],y=sn[i+2],px=sn[i+3],py=sn[i+4],div=sn[i+5],born=sn[i+6],[a,b,c]=hash(id);
        const X0=PXc(px,py),Y0=PYc(py),X1=PXc(x,y),Y1=PYc(y);let cx=(X0+(X1-X0)*e)*S+(a-.5)*3.4,cy=(Y0+(Y1-Y0)*e)*S+(b-.5)*3.4,sc=.92+c*.3,al=1;
        if(born===2){sc*=.55+.45*e}else if(born===3){al=e}
        const isEdge=emptyN(x,y),col=div?pal.div:isEdge?pal.edge:cur.orig[y*W+x]?pal.fresh:pal.intact,r=S*sc*1.05;
        ctx.globalAlpha=al;ctx.drawImage(sprite(col),cx-r,cy-r,2*r,2*r);
        ctx.globalAlpha=al*(div?.85:.4);ctx.fillStyle=nuc;
        if(div){const an=a*6.28,d=S*.2;ctx.beginPath();ctx.arc(cx+Math.cos(an)*d,cy+Math.sin(an)*d,1.7,0,6.3);ctx.arc(cx-Math.cos(an)*d,cy-Math.sin(an)*d,1.7,0,6.3);ctx.fill()}
        else{ctx.beginPath();ctx.arc(cx,cy,1.5+c*.5,0,6.3);ctx.fill()}
        ctx.globalAlpha=1;
      }
    }
    const step=grid?k:pos,hr=step*OPT.hoursPerStep,cn=cur.cells[Math.min(n,k)],ar=cur.area[Math.min(n,k)];
    $('#tag').textContent=`member ${member}/12   step ${Math.round(step)}   t = ${hr.toFixed(1)} h`+(step>OPT.t0?'   forecast':'   observed');
    $('#ro').innerHTML=`<tr><td>Time</td><td>${hr.toFixed(1)} h</td></tr><tr><td>Cells</td><td>${cn}</td></tr><tr><td>Divisions so far</td><td>${cur.divs[Math.min(n,k)]}</td></tr><tr><td>Wound area (% of start)</td><td>${(ar*100).toFixed(0)}%</td></tr><tr><td>Closure</td><td>${((1-ar)*100).toFixed(0)}%</td></tr>`;
    $('#scrub').value=pos;$('#pp').textContent=playing?'Pause':'Play';
    ribbon();
  }
  $('#mem').innerHTML=[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<button data-m="${m}" aria-pressed="${m===member}" style="min-width:30px;padding:0 6px">${m}</button>`).join('');
  document.querySelectorAll('[data-tone]').forEach(b=>b.onclick=()=>{const u=new URL(location.href);u.searchParams.set('tone',b.dataset.tone);location.href=u});
  document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{speed=+b.dataset.s;document.querySelectorAll('[data-s]').forEach(x=>x.setAttribute('aria-pressed',x===b))});
  document.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{member=+b.dataset.m;cur=run(member,true,div);document.querySelectorAll('[data-m]').forEach(x=>x.setAttribute('aria-pressed',x===b));frame()});
  if(grid)$('#ol').onclick=e=>{outline=!outline;e.target.setAttribute('aria-pressed',outline);e.target.textContent='Outlines '+(outline?'on':'off');frame()};
  $('#dv').onclick=e=>{div=!div;e.target.setAttribute('aria-pressed',div);e.target.textContent='Division '+(div?'on':'off');build();frame()};
  $('#pp').onclick=()=>{playing=!playing;frame()};
  $('#bk').onclick=()=>{playing=false;pos=Math.max(0,Math.round(pos)-1);frame()};
  $('#fw').onclick=()=>{playing=false;pos=Math.min(OPT.steps,Math.round(pos)+1);frame()};
  $('#scrub').oninput=e=>{playing=false;pos=+e.target.value;frame()};
  legend();frame();
  let last=performance.now();
  (function loop(t){if(playing){pos+=(t-last)/1000*(grid?10:6)*speed;if(pos>=OPT.steps){pos=0}frame()}last=t;requestAnimationFrame(loop)})(last);
}
window.NCAMock={mount,run,PALS,OPT};
})();
