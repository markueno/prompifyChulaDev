import React, { useEffect, useRef } from 'react';

const PROMPIFY_LOGO_URL = '/images/prompify.png';

const INDUSTRY_ICONS = [
  {
    label: 'Finance',
    angle: -90,
    // Stock line chart / briefcase feel
    src: 'https://cdn-icons-png.flaticon.com/512/2282/2282188.png',
    pulseColor: [30, 80, 200],
  },
  {
    label: 'Education',
    angle: -18,
    // Graduation cap
    src: 'https://cdn-icons-png.flaticon.com/512/3976/3976625.png',
    pulseColor: [140, 90, 200],
  },
  {
    label: 'Retail',
    angle: 54,
    // Shopping bag
    src: 'https://cdn-icons-png.flaticon.com/512/3144/3144456.png',
    pulseColor: [30, 160, 100],
  },
  {
    label: 'Tech',
    angle: 126,
    // Circuit / chip
    src: 'https://cdn-icons-png.flaticon.com/512/900/900782.png',
    pulseColor: [20, 140, 200],
  },
  {
    label: 'Healthcare',
    angle: 198,
    // Heartbeat / ECG line
    src: 'https://cdn-icons-png.flaticon.com/512/2382/2382533.png',
    pulseColor: [220, 40, 60],
  },
];

export default function IndustryVisual() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const stateRef = useRef({
    lastTs: 0,
    logoImg: null,
    logoLoaded: false,
    icons: INDUSTRY_ICONS.map(ind => ({ ...ind, img: null, loaded: false })),
    hoveredIdx: -1,
    mouseX: 0,
    mouseY: 0,
  });

  useEffect(() => {
    const s = stateRef.current;

    const logoImg = new Image();
    logoImg.src = PROMPIFY_LOGO_URL;
    logoImg.onload = () => { s.logoLoaded = true; };
    s.logoImg = logoImg;

    s.icons.forEach(ind => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = ind.src;
      img.onload = () => { ind.loaded = true; };
      ind.img = img;
    });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    // Slightly smaller orbit so enlarged icons never clip
    const ORBIT_R = Math.min(W, H) * 0.36;

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      s.mouseX = (e.clientX - rect.left) * (W / rect.width);
      s.mouseY = (e.clientY - rect.top) * (H / rect.height);
      let found = -1;
      s.icons.forEach((ind, i) => {
        if (ind._px == null) return;
        const dx = s.mouseX - ind._px, dy = s.mouseY - ind._py;
        if (Math.sqrt(dx * dx + dy * dy) < 44) found = i;
      });
      s.hoveredIdx = found;
      canvas.style.cursor = found >= 0 ? 'pointer' : 'default';
    };
    canvas.addEventListener('mousemove', onMove);

    const draw = (ts) => {
      const t = ts / 1000;
      s.lastTs = ts;
      ctx.clearRect(0, 0, W, H);

      const positions = s.icons.map((ind) => {
        const rad = (ind.angle * Math.PI) / 180;
        return {
          ...ind,
          x: cx + ORBIT_R * Math.cos(rad),
          y: cy + ORBIT_R * Math.sin(rad),
        };
      });

      // Store positions for hover hit-test
      positions.forEach((p, i) => {
        s.icons[i]._px = p.x;
        s.icons[i]._py = p.y + Math.sin(t * 0.9 + i * 1.4) * 3;
      });

      // Connector lines
      positions.forEach((ind, i) => {
        const isHov = s.hoveredIdx === i;
        ctx.beginPath();
        ctx.moveTo(ind.x, ind.y);
        ctx.lineTo(cx, cy);
        // Neutral line color — no bright hues
        ctx.strokeStyle = isHov ? `rgba(40,40,50,0.35)` : `rgba(40,40,50,0.09)`;
        ctx.lineWidth = isHov ? 2 : 1;
        ctx.stroke();
      });

      // Pulse dots flowing toward center
      positions.forEach((ind, i) => {
        const [r, g, b] = ind.pulseColor;
        const cycle = (t * 0.55 + i * 0.44) % 1;
        const px = ind.x + (cx - ind.x) * cycle;
        const py = ind.y + (cy - ind.y) * cycle;
        const alpha = Math.sin(cycle * Math.PI) * (s.hoveredIdx === i ? 0.9 : 0.55);
        const dotR = (s.hoveredIdx === i ? 5.5 : 3.5) * (1 - cycle * 0.3);
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      });

      // Industry icons
      const baseIconSize = 54;
      positions.forEach((ind, i) => {
        const isHovered = s.hoveredIdx === i;
        const bob = Math.sin(t * 0.9 + i * 1.4) * 3;
        const px = ind.x;
        const py = ind.y + bob;
        // Enlarge on hover, but keep within safe bounds
        const iconSize = isHovered ? baseIconSize * 1.25 : baseIconSize;
        const [r, g, b] = ind.pulseColor;

        // Glow (subtle)
        const glowR = isHovered ? iconSize * 1.3 : iconSize * 0.8;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        grd.addColorStop(0, `rgba(${r},${g},${b},${isHovered ? 0.2 : 0.08})`);
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Icon — grayscale filter for a cleaner, less colorful look
        if (ind.loaded && ind.img?.complete) {
          ctx.save();
          ctx.filter = isHovered
            ? 'grayscale(20%) brightness(0.82)'
            : 'grayscale(55%) brightness(0.72)';
          ctx.globalAlpha = isHovered ? 0.95 : 0.78;
          ctx.drawImage(ind.img, px - iconSize / 2, py - iconSize / 2, iconSize, iconSize);
          ctx.filter = 'none';
          ctx.restore();
        }

        // Label — dark neutral, no color
        ctx.font = isHovered
          ? `bold 11.5px Inter, sans-serif`
          : `10px Inter, sans-serif`;
        ctx.fillStyle = isHovered
          ? 'rgba(15,15,22,0.82)'
          : 'rgba(40,40,50,0.45)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(ind.label, px, py + iconSize / 2 + 5);
        ctx.textBaseline = 'alphabetic';

        // Pulsing ring on hover
        if (isHovered) {
          const ringPulse = Math.sin(t * 3) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(px, py, iconSize * 0.65 + ringPulse * 7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${r},${g},${b},${0.22 + ringPulse * 0.22})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });

      // Center Prompify logo
      const logoSize = 100;
      if (s.logoLoaded && s.logoImg?.complete) {
        ctx.drawImage(s.logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: 'transparent' }}>
      <canvas
        ref={canvasRef}
        width={680}
        height={580}
        style={{ width: '100%', height: 'auto', maxWidth: 380 }}
      />
    </div>
  );
}
