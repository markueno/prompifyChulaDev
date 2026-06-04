import React, { useEffect, useRef } from 'react';

const PROMPIFY_LOGO_URL = '/images/prompify.png';
const LOGO_FADE_RADIUS = 80;

// Varied raw data labels — mix of messy data types
const RAW_LABELS = [
  { text: '8,421',  color: [30, 30, 40] },
  { text: '0.33%',  color: [80, 80, 90] },
  { text: '#REF!',  color: [15, 15, 20] },
  { text: 'NULL',   color: [120, 120, 130] },
  { text: '????',   color: [50, 50, 60] },
  { text: 'NaN',    color: [40, 40, 50] },
  { text: '∅',      color: [90, 90, 100] },
  { text: '—',      color: [70, 70, 80] },
  { text: 'ERR',    color: [25, 25, 35] },
  { text: 'N/A',    color: [100, 100, 110] },
  { text: 'VOID',   color: [60, 60, 70] },
  { text: '£0.00',  color: [140, 140, 150] },
];

const CHART_COLORS = [
  ['#6366f1', '#818cf8'],
  ['#f59e0b', '#fcd34d'],
  ['#10b981', '#34d399'],
  ['#ef4444', '#f87171'],
  ['#3b82f6', '#60a5fa'],
];

function drawDocIcon(ctx, cx, cy, size, alpha, shade) {
  const w = size * 0.7, h = size * 0.88, fold = size * 0.24;
  const [r, g, b] = shade;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(${r},${g},${b},0.82)`;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - h / 2);
  ctx.lineTo(cx + w / 2 - fold, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h / 2 + fold);
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(cx + w / 2 - fold, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy - h / 2 + fold);
  ctx.lineTo(cx + w / 2 - fold, cy - h / 2 + fold);
  ctx.closePath();
  ctx.fill();
  // Lines inside doc
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.9;
  [0.32, 0.5, 0.68].forEach(f => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + w * 0.18, cy - h / 2 + h * f);
    ctx.lineTo(cx + w / 2 - w * 0.22, cy - h / 2 + h * f);
    ctx.stroke();
  });
  ctx.restore();
}

function drawDatabaseIcon(ctx, cx, cy, size, alpha, shade) {
  const [r, g, b] = shade;
  const rx = size * 0.42, ry = size * 0.11, h = size * 0.65;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.lineWidth = 1.4;

  // Body sides
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy - h / 2);
  ctx.lineTo(cx - rx, cy + h / 2);
  ctx.moveTo(cx + rx, cy - h / 2);
  ctx.lineTo(cx + rx, cy + h / 2);
  ctx.stroke();

  // Bottom ellipse (fill first)
  ctx.beginPath();
  ctx.ellipse(cx, cy + h / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Middle stripe
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
  ctx.fill();
  ctx.stroke();

  // Top ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy - h / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawTableIcon(ctx, cx, cy, size, alpha, shade) {
  const [r, g, b] = shade;
  const cols = 3, rows = 3;
  const cw = size * 0.28, rh = size * 0.22;
  const totalW = cols * cw, totalH = rows * rh;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
  ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(cx - totalW / 2 + c * cw, cy - totalH / 2);
    ctx.lineTo(cx - totalW / 2 + c * cw, cy + totalH / 2);
    ctx.stroke();
  }
  for (let row = 0; row <= rows; row++) {
    ctx.beginPath();
    ctx.moveTo(cx - totalW / 2, cy - totalH / 2 + row * rh);
    ctx.lineTo(cx + totalW / 2, cy - totalH / 2 + row * rh);
    ctx.stroke();
  }
  // Header row fill
  ctx.fillStyle = `rgba(${r},${g},${b},0.25)`;
  ctx.fillRect(cx - totalW / 2, cy - totalH / 2, totalW, rh);
  ctx.restore();
}

function drawBarChart(ctx, cx, cy, scale, alpha, colors) {
  const bars = [0.45, 0.75, 0.55, 1.0, 0.68, 0.88];
  const bW = scale * 13;
  const maxH = scale * 55;
  const gap = scale * 7;
  const totalW = bars.length * bW + (bars.length - 1) * gap;
  ctx.save();
  ctx.globalAlpha = alpha;
  bars.forEach((h, i) => {
    const bx = cx - totalW / 2 + i * (bW + gap);
    const bh = h * maxH;
    const grad = ctx.createLinearGradient(bx, cy - bh, bx, cy);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1] + '55');
    ctx.fillStyle = grad;
    if (ctx.roundRect) ctx.roundRect(bx, cy - bh, bW, bh, 2);
    else ctx.rect(bx, cy - bh, bW, bh);
    ctx.fill();
  });
  ctx.strokeStyle = colors[0] + '44';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - totalW / 2, cy);
  ctx.lineTo(cx + totalW / 2, cy);
  ctx.stroke();
  ctx.restore();
}

function drawLineChart(ctx, cx, cy, scale, alpha, colors) {
  const pts = [0.3, 0.52, 0.28, 0.7, 0.48, 0.85, 0.6, 0.92];
  const w = scale * 78, h = scale * 50;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = cx - w / 2 + (i / (pts.length - 1)) * w;
    const y = cy + h / 2 - p * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(cx + w / 2, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy + h / 2);
  ctx.closePath();
  const areaGrad = ctx.createLinearGradient(cx, cy - h / 2, cx, cy + h / 2);
  areaGrad.addColorStop(0, colors[0] + '30');
  areaGrad.addColorStop(1, colors[0] + '05');
  ctx.fillStyle = areaGrad;
  ctx.fill();
  ctx.strokeStyle = colors[0];
  ctx.lineWidth = 2.2 * Math.min(scale, 1.3);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = cx - w / 2 + (i / (pts.length - 1)) * w;
    const y = cy + h / 2 - p * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = colors[0];
  pts.forEach((p, i) => {
    const x = cx - w / 2 + (i / (pts.length - 1)) * w;
    const y = cy + h / 2 - p * h;
    ctx.beginPath();
    ctx.arc(x, y, 2.8 * Math.min(scale, 1.1), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// Shades for the left-side particles
const INPUT_SHADES = [
  [15, 15, 20],
  [40, 40, 50],
  [70, 70, 80],
  [100, 100, 110],
  [130, 130, 140],
];

export default function DataFlowVisual() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const stateRef = useRef({
    particles: [],
    lastTs: 0,
    logoImg: null,
    logoLoaded: false,
    spawnL: 0,
    spawnR: 0,
    colorIdx: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const s = stateRef.current;

    const img = new Image();
    img.src = PROMPIFY_LOGO_URL;
    img.onload = () => { s.logoLoaded = true; };
    s.logoImg = img;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    canvas.addEventListener('click', () => {
      for (let i = 0; i < 5; i++) spawnRight(true);
    });
    canvas.style.cursor = 'pointer';

    const spawnLeft = () => {
      const lbl = RAW_LABELS[Math.floor(Math.random() * RAW_LABELS.length)];
      const shade = INPUT_SHADES[Math.floor(Math.random() * INPUT_SHADES.length)];
      // 0=text, 1=doc, 2=database, 3=table
      const iconType = Math.random() < 0.35 ? 0 : Math.random() < 0.5 ? 1 : Math.random() < 0.55 ? 2 : 3;
      s.particles.push({
        sx: 22 + Math.random() * (cx - 110),
        sy: H * 0.1 + Math.random() * H * 0.8,
        t: 0, speed: 0.16 + Math.random() * 0.12,
        lbl, shade, iconType, side: 'left', alive: true,
      });
    };

    const spawnRight = (burst = false) => {
      const angleRange = Math.PI * 0.44;
      const angle = -angleRange + Math.random() * angleRange * 2;
      const dist = burst ? (130 + Math.random() * 140) : (105 + Math.random() * 120);
      const ci = s.colorIdx % CHART_COLORS.length;
      s.colorIdx++;
      s.particles.push({
        sx: cx, sy: cy,
        tx: cx + 55 + Math.cos(angle) * dist,
        ty: cy + Math.sin(angle) * dist,
        t: 0, speed: burst ? (0.38 + Math.random() * 0.2) : (0.16 + Math.random() * 0.14),
        type: Math.random() > 0.5 ? 'bar' : 'line',
        colors: CHART_COLORS[ci],
        side: 'right', alive: true,
      });
    };

    for (let i = 0; i < 5; i++) { spawnLeft(); spawnRight(); }

    const draw = (ts) => {
      const dt = Math.min((ts - (s.lastTs || ts)) / 1000, 0.05);
      s.lastTs = ts;
      ctx.clearRect(0, 0, W, H);

      s.spawnL += dt;
      s.spawnR += dt;
      if (s.spawnL > 0.8) { spawnLeft(); s.spawnL = 0; }
      if (s.spawnR > 0.72) { spawnRight(); s.spawnR = 0; }

      const logoSize = 100;
      if (s.logoLoaded && s.logoImg?.complete) {
        ctx.drawImage(s.logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
      }

      s.particles = s.particles.filter(p => p.alive);
      s.particles.forEach(p => {
        p.t += p.speed * dt;
        if (p.t >= 1.5) { p.alive = false; return; }
        const progress = Math.min(p.t, 1);
        const baseAlpha = Math.sin(progress * Math.PI);

        if (p.side === 'left') {
          const px = p.sx + (cx - p.sx) * progress;
          const py = p.sy + (cy - p.sy) * progress;
          const distFromLogo = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
          const fadeFactor = Math.min(1, Math.max(0, (distFromLogo - LOGO_FADE_RADIUS * 0.4) / (LOGO_FADE_RADIUS * 0.8)));
          const alpha = baseAlpha * fadeFactor;
          if (alpha < 0.01) return;

          const [r, g, b] = p.shade;
          const iconSize = 36;

          if (p.iconType === 0) {
            // Text label
            ctx.font = 'bold 15px monospace';
            ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.85})`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.lbl.text, px, py);
            ctx.textBaseline = 'alphabetic';
          } else if (p.iconType === 1) {
            drawDocIcon(ctx, px, py, iconSize, alpha, p.shade);
          } else if (p.iconType === 2) {
            drawDatabaseIcon(ctx, px, py, iconSize, alpha, p.shade);
          } else {
            drawTableIcon(ctx, px, py, iconSize, alpha, p.shade);
          }
        } else {
          const px = p.sx + (p.tx - p.sx) * progress;
          const py = p.sy + (p.ty - p.sy) * progress;
          const distFromLogo = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
          const fadeFactor = Math.min(1, Math.max(0, (distFromLogo - LOGO_FADE_RADIUS * 0.5) / (LOGO_FADE_RADIUS * 0.9)));
          const exitAlpha = p.t < 1 ? 1 : Math.max(0, 1 - (p.t - 1) * 3);
          const alpha = baseAlpha * fadeFactor * exitAlpha;
          if (alpha < 0.01) return;
          const scale = 0.3 + progress * 1.1;
          if (p.type === 'bar') drawBarChart(ctx, px, py, scale, alpha, p.colors);
          else drawLineChart(ctx, px, py, scale, alpha, p.colors);
        }
      });

      // Redraw logo on top
      if (s.logoLoaded && s.logoImg?.complete) {
        ctx.drawImage(s.logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'transparent' }}>
      <canvas
        ref={canvasRef}
        width={640}
        height={500}
        style={{ width: '100%', height: 'auto', maxWidth: 720, cursor: 'pointer' }}
      />
    </div>
  );
}
