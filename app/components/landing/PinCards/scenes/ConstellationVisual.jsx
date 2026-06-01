import React, { useEffect, useRef } from 'react';

const PROMPIFY_LOGO_URL = '/images/prompify.png';

const AI_NODES = [
  {
    label: 'Claude',
    speed: 0.38, orbitA: 210, orbitB: 55, inc: 28, lon: 0, phase: 0,
    logoPath: '/images/claude.png',
    brandColor: [212, 165, 116],
    initial: 'C',
    repX: 0, repY: 0,
  },
  {
    label: 'ChatGPT',
    speed: 0.28, orbitA: 200, orbitB: 50, inc: -35, lon: 60, phase: 1.2,
    logoPath: '/images/chatgpt.png',
    brandColor: [15, 163, 127],
    initial: 'G',
    repX: 0, repY: 0,
  },
  {
    label: 'Gemini',
    speed: 0.45, orbitA: 215, orbitB: 58, inc: 50, lon: 120, phase: 2.5,
    logoPath: '/images/gemini.png',
    brandColor: [66, 133, 244],
    initial: 'G',
    repX: 0, repY: 0,
  },
  {
    label: 'Mistral',
    speed: 0.32, orbitA: 205, orbitB: 48, inc: -20, lon: 200, phase: 0.8,
    logoPath: '/images/mistral.png',
    brandColor: [255, 112, 0],
    initial: 'M',
    repX: 0, repY: 0,
  },
  {
    label: 'DeepSeek',
    speed: 0.22, orbitA: 212, orbitB: 52, inc: 60, lon: 280, phase: 3.8,
    logoPath: '/images/deepseek.png',
    brandColor: [77, 107, 254],
    initial: 'D',
    repX: 0, repY: 0,
  },
];

// Fix 5: pre-render one glow sprite per node on an offscreen canvas.
// Reused every frame by drawImage() — no createRadialGradient() at runtime.
function buildGlowSprite(r, g, b, radius) {
  const size = radius * 2;
  const oc = document.createElement('canvas');
  oc.width = size;
  oc.height = size;
  const octx = oc.getContext('2d');
  const grad = octx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  octx.fillStyle = grad;
  octx.fillRect(0, 0, size, size);
  return oc;
}

// Fix 6: target 30 fps — halves canvas CPU vs uncapped 60 fps
const FRAME_INTERVAL = 1000 / 30;

function project(x3, y3, z3, cx, cy, fov = 500) {
  const scale = fov / (fov + z3);
  return { x: cx + x3 * scale, y: cy + y3 * scale, scale };
}

function orbitPos(t, orbitA, orbitB, inc, lon, phase) {
  const angle = t + phase;
  const lx = orbitA * Math.cos(angle);
  const ly = orbitB * Math.sin(angle);
  const incR = (inc * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const y2 = ly * Math.cos(incR);
  const z2 = ly * Math.sin(incR);
  const x3 = lx * Math.cos(lonR) - y2 * Math.sin(lonR);
  const y3 = lx * Math.sin(lonR) + y2 * Math.cos(lonR);
  return { x3, y3, z3: z2 };
}

function drawFloatingLogo(ctx, x, y, r, alpha, node) {
  const [cr, cg, cb] = node.brandColor;

  // Fix 5: draw pre-rendered glow sprite via drawImage — zero gradient allocation per frame
  if (node._glowSprite) {
    const glowR = r * 3;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(node._glowSprite, x - glowR, y - glowR, glowR * 2, glowR * 2);
    ctx.restore();
  }

  const logoLoaded = node._logoImg && node._logoImg.complete && node._logoImg.naturalWidth > 0;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (logoLoaded) {
    const size = r * 2;
    ctx.drawImage(node._logoImg, x - size / 2, y - size / 2, size, size);
  } else {
    ctx.font = `bold ${Math.round(r * 0.9)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.initial, x, y);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}

export default function ConstellationVisual() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const stateRef = useRef({
    t: 0,
    lastTs: 0,
    lastFrameTime: 0,
    logoImg: null,
    logoLoaded: false,
    mouse: null,
    nodes: AI_NODES.map(n => ({ ...n, _logoImg: null, _glowSprite: null, repX: 0, repY: 0 })),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const s = stateRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // Load Prompify center logo
    const centerImg = new Image();
    centerImg.src = PROMPIFY_LOGO_URL;
    centerImg.onload = () => { s.logoLoaded = true; };
    s.logoImg = centerImg;

    // Load each node logo + build its glow sprite once
    s.nodes.forEach(node => {
      const img = new Image();
      img.src = node.logoPath;
      node._logoImg = img;

      const [r, g, b] = node.brandColor;
      node._glowSprite = buildGlowSprite(r, g, b, 80); // fixed sprite radius; scaled at draw time
    });

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      s.mouse = {
        x: (e.clientX - rect.left) * (W / rect.width),
        y: (e.clientY - rect.top) * (H / rect.height),
      };
    };
    const onLeave = () => { s.mouse = null; };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    const draw = (ts) => {
      animRef.current = requestAnimationFrame(draw);

      // Fix 6: skip frames to hold ~30 fps
      if (ts - s.lastFrameTime < FRAME_INTERVAL) return;
      s.lastFrameTime = ts;

      const dt = Math.min((ts - (s.lastTs || ts)) / 1000, 0.05);
      s.lastTs = ts;
      s.t += dt;
      ctx.clearRect(0, 0, W, H);

      const projected = s.nodes.map((node) => {
        const { x3, y3, z3 } = orbitPos(s.t * node.speed, node.orbitA, node.orbitB, node.inc, node.lon, node.phase);
        const { x, y, scale } = project(x3, y3, z3, cx, cy);

        let targetRepX = 0, targetRepY = 0;
        if (s.mouse) {
          const dx = x - s.mouse.x, dy = y - s.mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const repulseRadius = 200;
          if (dist < repulseRadius && dist > 1) {
            const t = dist / repulseRadius;
            const eased = (1 - t) * (1 - t) * 52;
            targetRepX = (dx / dist) * eased;
            targetRepY = (dy / dist) * eased;
          }
        }

        node.repX += (targetRepX - node.repX) * 0.11;
        node.repY += (targetRepY - node.repY) * 0.11;

        return { ...node, x: x + node.repX, y: y + node.repY, z3, scale };
      });

      // Faint orbit ellipses
      AI_NODES.forEach((node) => {
        ctx.save();
        ctx.globalAlpha = 0.04;
        ctx.strokeStyle = 'rgba(15,18,50,1)';
        ctx.lineWidth = 0.8;
        const lonR = (node.lon * Math.PI) / 180;
        const incR = (node.inc * Math.PI) / 180;
        ctx.translate(cx, cy);
        ctx.rotate(lonR);
        ctx.scale(1, Math.cos(incR));
        ctx.beginPath();
        ctx.ellipse(0, 0, node.orbitA, node.orbitB, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });

      const behindLogo = projected.filter(n => n.z3 > 0);
      const inFrontLogo = projected.filter(n => n.z3 <= 0);

      const drawNode = (n) => {
        const depth = (n.z3 + 250) / 500;
        const r = (16 + depth * 10) * Math.max(n.scale, 0.6);
        const alpha = 0.5 + depth * 0.4;

        drawFloatingLogo(ctx, n.x, n.y, r, alpha, n);

        const fontSize = Math.round(8 + depth * 3);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = `rgba(10,12,35,${0.2 + depth * 0.35})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, n.x, n.y + r + 5);
        ctx.textBaseline = 'alphabetic';
      };

      behindLogo.forEach(n => drawNode(n));

      const logoSize = 120;
      if (s.logoLoaded && s.logoImg?.complete) {
        ctx.drawImage(s.logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
      }

      inFrontLogo.forEach(n => drawNode(n));
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'transparent' }}>
      <canvas
        ref={canvasRef}
        width={640}
        height={560}
        style={{ width: '100%', height: 'auto', maxWidth: 693 }}
      />
    </div>
  );
}
