import React, { useEffect, useRef } from 'react';

const N      = 10;       // Was 14 — big perf win
const SCALE  = 195;
const CUBE_H = 0.036;
const DMAX   = 0.085;
const RISE   = 0.009;
const SIGMA  = 0.095;   // Slightly wider to compensate for fewer tiles
const SPR    = 0.14;
const H      = 0.5 / N;
const HS     = H * 0.93;

const LABELS = ['E2E Encrypted', 'SOC 2 Compliant', 'Zero Retention', 'AES-256'];

// Frame throttle: target ~30fps
const FRAME_INTERVAL = 1000 / 30;

function proj([x, y, z], cx, cy) {
  return [cx + (x - y) * 0.866 * SCALE, cy + (x + y) * 0.5 * SCALE - z * SCALE];
}

function eh(idx) {
  return { lo: idx === 0 ? -H : -HS, hi: idx === N-1 ? H : HS };
}

function buildTiles() {
  const tiles = [];
  const tg = Array.from({length:N}, ()=>new Array(N));
  const rg = Array.from({length:N}, ()=>new Array(N));
  const lg = Array.from({length:N}, ()=>new Array(N));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const tx=-0.5+(i+0.5)/N, ty=-0.5+(j+0.5)/N;
      const t = { face:'top', i, j, disp:0, c:[tx, ty, 0.5], n:[0,0,1] };
      tiles.push(t); tg[i][j]=t;
      const ry=-0.5+(i+0.5)/N, rz=-0.5+(j+0.5)/N;
      const r = { face:'right', i, j, disp:0, c:[0.5, ry, rz], n:[1,0,0] };
      tiles.push(r); rg[i][j]=r;
      const lx=-0.5+(i+0.5)/N, lz=-0.5+(j+0.5)/N;
      const l = { face:'left', i, j, disp:0, c:[lx, 0.5, lz], n:[0,1,0] };
      tiles.push(l); lg[i][j]=l;
    }
  }
  return { tiles, tg, rg, lg };
}

const MAIN_BASE = { top:[218,142,108], right:[178,108,76], left:[122,68,44] };
const SIDE_BASE = { rx:[172,105,72], ry:[112,62,40], rz:[198,132,95] };
const cap = v => Math.max(0, Math.min(255, Math.round(v)));

function mainColor(face, i, j, d) {
  const [r,g,b] = MAIN_BASE[face];
  let br = 0;
  if (face === 'top') {
    const u=i/(N-1), v=j/(N-1), diag=(u+(1-v))/2;
    br += Math.exp(-(((diag-0.5)*3.8)**2))*68 + (1-v)*20 - u*8;
  } else {
    const hf=1-j/(N-1);
    br += hf*52 - 18 + Math.exp(-(((i/(N-1)-0.5)*3.2)**2))*22*hf;
  }
  br += (d/CUBE_H)*24;
  return `rgb(${cap(r+br)},${cap(g+br)},${cap(b+br)})`;
}

function sideColor(dir, d) {
  const [r,g,b] = SIDE_BASE[dir];
  const br = (d/CUBE_H)*18;
  return `rgb(${cap(r+br)},${cap(g+br)},${cap(b+br)})`;
}

const INTERIORS = [
  { c:[[-0.5,0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]], fill:'rgb(80,42,26)' },
  { c:[[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5],[0.5,-0.5,0.5]], fill:'rgb(108,60,38)' },
  { c:[[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]], fill:'rgb(140,82,56)' },
];

export default function SecurityVisual() {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const mouseRef  = useRef({ x:-9999, y:-9999 });
  const lastFrameTime = useRef(0);
  const isSettled = useRef(false);
  const settledFrames = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, Hc = canvas.height;
    const cx = W*0.5, cy = Hc*0.47;
    const { tiles, tg, rg, lg } = buildTiles();

    // Pre-compute projected positions for hit-testing (static since cube doesn't rotate)
    const tileScreenPos = tiles.map(t => proj(t.c, cx, cy));

    const onMove = e => {
      const r = canvas.getBoundingClientRect();
      mouseRef.current = { x:(e.clientX-r.left)*(W/r.width), y:(e.clientY-r.top)*(Hc/r.height) };
      isSettled.current = false;
      settledFrames.current = 0;
    };
    const onLeave = () => {
      mouseRef.current = {x:-9999, y:-9999};
      isSettled.current = false;
      settledFrames.current = 0;
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    const draw = (timestamp) => {
      // Frame throttle
      if (timestamp - lastFrameTime.current < FRAME_INTERVAL) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameTime.current = timestamp;

      // If settled (no mouse interaction, all displacements ~0), skip redraw
      if (isSettled.current) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, W, Hc);
      const {x:mx, y:my} = mouseRef.current;

      // Displacement calculation
      const s2 = SIGMA*SIGMA;
      const sr2 = (1.6*SIGMA)*(1.6*SIGMA);
      let maxDisp = 0;

      for (let idx = 0; idx < tiles.length; idx++) {
        const t = tiles[idx];
        const sc = tileScreenPos[idx];
        // Use pre-computed screen pos (close enough for interaction, avoids full proj per frame)
        const odx = (sc[0] - mx) * 0.55;
        const ody = (sc[1] - my) * 1.0;
        const dw  = Math.sqrt(odx*odx + ody*ody) / SCALE;
        const target = -DMAX * Math.exp(-dw*dw/(2*s2))
                     +  RISE * (dw*dw/s2) * Math.exp(-dw*dw/(2*sr2));
        t.disp += (target - t.disp) * SPR;
        const absDisp = Math.abs(t.disp);
        if (absDisp > maxDisp) maxDisp = absDisp;
      }

      // Check if we can go idle
      if (mx === -9999 && maxDisp < 0.0002) {
        settledFrames.current++;
        if (settledFrames.current > 5) {
          isSettled.current = true;
        }
      }

      // Silhouette
      const SIL=[[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5],[-0.5,0.5,0.5]];
      const sp=SIL.map(c=>proj(c,cx,cy));
      ctx.beginPath(); ctx.moveTo(sp[0][0],sp[0][1]);
      sp.slice(1).forEach(([x,y])=>ctx.lineTo(x,y));
      ctx.closePath(); ctx.fillStyle='rgb(62,32,18)'; ctx.fill();

      // Interior faces
      for (const {c,fill} of INTERIORS) {
        const pts=c.map(p=>proj(p,cx,cy));
        ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
        pts.slice(1).forEach(([x,y])=>ctx.lineTo(x,y));
        ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
      }

      // Build draw list
      const dl = [];

      for (const t of tiles) {
        const d = t.disp;
        const ht = Math.max(0, CUBE_H+d);
        const xi = eh(t.i), xj = eh(t.j);

        if (t.face === 'top') {
          const [tx,ty] = t.c;
          const topZ=0.5+CUBE_H+d, baseZ=0.5;
          dl.push({ depth:tx+ty+topZ, color:mainColor('top',t.i,t.j,d),
            pts:[[tx+xi.lo,ty+xj.lo,topZ],[tx+xi.hi,ty+xj.lo,topZ],
                 [tx+xi.hi,ty+xj.hi,topZ],[tx+xi.lo,ty+xj.hi,topZ]] });
          if (ht>0.0005) {
            dl.push({ depth:(tx+xi.hi)+ty+(baseZ+topZ)/2, color:sideColor('rx',d),
              pts:[[tx+xi.hi,ty+xj.lo,topZ],[tx+xi.hi,ty+xj.hi,topZ],
                   [tx+xi.hi,ty+xj.hi,baseZ],[tx+xi.hi,ty+xj.lo,baseZ]] });
            dl.push({ depth:tx+(ty+xj.hi)+(baseZ+topZ)/2, color:sideColor('ry',d),
              pts:[[tx+xi.lo,ty+xj.hi,topZ],[tx+xi.hi,ty+xj.hi,topZ],
                   [tx+xi.hi,ty+xj.hi,baseZ],[tx+xi.lo,ty+xj.hi,baseZ]] });
          }
        } else if (t.face === 'right') {
          const [,ry,rz] = t.c;
          const rightX=0.5+CUBE_H+d, baseX=0.5;
          const yi=eh(t.i), zj=eh(t.j);
          dl.push({ depth:rightX+ry+rz, color:mainColor('right',t.i,t.j,d),
            pts:[[rightX,ry+yi.lo,rz+zj.lo],[rightX,ry+yi.hi,rz+zj.lo],
                 [rightX,ry+yi.hi,rz+zj.hi],[rightX,ry+yi.lo,rz+zj.hi]] });
          if (ht>0.0005) {
            dl.push({ depth:(baseX+rightX)/2+ry+(rz+zj.hi), color:sideColor('rz',d),
              pts:[[baseX,ry+yi.lo,rz+zj.hi],[baseX,ry+yi.hi,rz+zj.hi],
                   [rightX,ry+yi.hi,rz+zj.hi],[rightX,ry+yi.lo,rz+zj.hi]] });
            dl.push({ depth:(baseX+rightX)/2+(ry+yi.hi)+rz, color:sideColor('ry',d),
              pts:[[baseX,ry+yi.hi,rz+zj.lo],[baseX,ry+yi.hi,rz+zj.hi],
                   [rightX,ry+yi.hi,rz+zj.hi],[rightX,ry+yi.hi,rz+zj.lo]] });
          }
        } else {
          const [lx,,lz] = t.c;
          const leftY=0.5+CUBE_H+d, baseY=0.5;
          const xi2=eh(t.i), zj=eh(t.j);
          dl.push({ depth:lx+leftY+lz, color:mainColor('left',t.i,t.j,d),
            pts:[[lx+xi2.lo,leftY,lz+zj.lo],[lx+xi2.hi,leftY,lz+zj.lo],
                 [lx+xi2.hi,leftY,lz+zj.hi],[lx+xi2.lo,leftY,lz+zj.hi]] });
          if (ht>0.0005) {
            dl.push({ depth:(lx+xi2.hi)+(baseY+leftY)/2+lz, color:sideColor('rx',d),
              pts:[[lx+xi2.hi,baseY,lz+zj.lo],[lx+xi2.hi,baseY,lz+zj.hi],
                   [lx+xi2.hi,leftY,lz+zj.hi],[lx+xi2.hi,leftY,lz+zj.lo]] });
            dl.push({ depth:lx+(baseY+leftY)/2+(lz+zj.hi), color:sideColor('rz',d),
              pts:[[lx+xi2.lo,baseY,lz+zj.hi],[lx+xi2.hi,baseY,lz+zj.hi],
                   [lx+xi2.hi,leftY,lz+zj.hi],[lx+xi2.lo,leftY,lz+zj.hi]] });
          }
        }
      }

      // Corner caps
      const CAP_COL = { tr:'rgb(195,125,90)', tl:'rgb(158,95,68)', rl:'rgb(142,85,58)' };

      for (let k = 0; k < N; k++) {
        const yj = eh(k);

        // Top–Right edge
        {
          const tTile = tg[N-1][k], rTile = rg[k][N-1];
          const e = Math.max(0, CUBE_H + (tTile.disp + rTile.disp) * 0.5);
          if (e > 0.0005) {
            const ty = tTile.c[1];
            dl.push({ color: CAP_COL.tr, depth: (0.5+e*0.5)+ty+(0.5+e*0.5),
              pts:[[0.5,ty+yj.lo,0.5+e],[0.5+e,ty+yj.lo,0.5],
                   [0.5+e,ty+yj.hi,0.5],[0.5,ty+yj.hi,0.5+e]] });
          }
        }

        // Top–Left edge
        {
          const xi = eh(k);
          const tTile = tg[k][N-1], lTile = lg[k][N-1];
          const e = Math.max(0, CUBE_H + (tTile.disp + lTile.disp) * 0.5);
          if (e > 0.0005) {
            const lx = tTile.c[0];
            dl.push({ color: CAP_COL.tl, depth: lx+(0.5+e*0.5)+(0.5+e*0.5),
              pts:[[lx+xi.lo,0.5,0.5+e],[lx+xi.hi,0.5,0.5+e],
                   [lx+xi.hi,0.5+e,0.5],[lx+xi.lo,0.5+e,0.5]] });
          }
        }

        // Right–Left edge
        {
          const zj2 = eh(k);
          const rTile = rg[N-1][k], lTile = lg[N-1][k];
          const e = Math.max(0, CUBE_H + (rTile.disp + lTile.disp) * 0.5);
          if (e > 0.0005) {
            const rz = rTile.c[2];
            dl.push({ color: CAP_COL.rl, depth: (0.5+e*0.5)+(0.5+e*0.5)+rz,
              pts:[[0.5,0.5+e,rz+zj2.lo],[0.5,0.5+e,rz+zj2.hi],
                   [0.5+e,0.5,rz+zj2.hi],[0.5+e,0.5,rz+zj2.lo]] });
          }
        }
      }

      dl.sort((a,b)=>a.depth-b.depth);
      for (const item of dl) {
        const s=item.pts.map(p=>proj(p,cx,cy));
        ctx.beginPath(); ctx.moveTo(s[0][0],s[0][1]);
        for (let k=1;k<s.length;k++) ctx.lineTo(s[k][0],s[k][1]);
        ctx.closePath();
        ctx.fillStyle=item.color; ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    // Draw one initial frame immediately (static cube)
    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-5">
      <canvas ref={canvasRef} width={640} height={540}
        style={{ width:'100%', height:'auto', maxWidth:400 }} />
      <div style={{ display:'flex', gap:18, flexWrap:'wrap', justifyContent:'center' }}>
        {LABELS.map((l,i) => (
          <span key={i} style={{ fontSize:9, fontFamily:'monospace',
            letterSpacing:'0.13em', color:'rgba(0,0,0,0.28)', textTransform:'uppercase' }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}