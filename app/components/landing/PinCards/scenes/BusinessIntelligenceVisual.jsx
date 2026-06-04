'use client'

import React, { useRef, useEffect, useState } from 'react';
// Fix 1: named imports so bundler can tree-shake unused Three.js code (~70-90 KB saving)
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  MeshStandardMaterial,
  BoxGeometry,
  Mesh,
  Group,
  Raycaster,
  Vector2,
} from 'three';

const REGIONS = [
  {
    name: 'Education',
    color: 0xe07830, emissive: 0xb05818,
    label: { top: '6%', left: '50%' },
    insight: 'Our AI carries deep institutional knowledge of the Education sector — from curriculum design and learning outcomes to funding models and regulatory frameworks — enabling it to interpret your challenges with genuine domain fluency.',
  },
  {
    name: 'Health',
    color: 0x5a9e6e, emissive: 0x347050,
    label: { top: '6%', left: '50%' },
    insight: 'With comprehensive awareness of clinical workflows, patient-centric care models, and healthcare compliance landscapes, our AI engages with your problems the way a seasoned industry expert would.',
  },
  {
    name: 'Finance',
    color: 0xc49a30, emissive: 0x906e18,
    label: { top: '6%', left: '50%' },
    insight: 'From capital markets and risk modelling to regulatory compliance and fintech disruption, our AI understands the nuances of financial services and applies that precision to every problem you bring.',
  },
  {
    name: 'Retail',
    color: 0xd06040, emissive: 0xa03820,
    label: { top: '6%', left: '50%' },
    insight: 'Steeped in the dynamics of consumer behaviour, supply chain logistics, and omnichannel strategy, our AI deciphers retail complexities and delivers solutions grounded in real-world commercial context.',
  },
  {
    name: 'Tech',
    color: 0xb05868, emissive: 0x803040,
    label: { top: '6%', left: '50%' },
    insight: 'Our AI is fluent in the architecture, product cycles, and innovation pressures unique to the technology industry — allowing it to engage with your technical and strategic challenges at a sophisticated level.',
  },
  {
    name: 'Government',
    color: 0x7870a8, emissive: 0x504880,
    label: { top: '6%', left: '50%' },
    insight: 'Versed in policy design, public service delivery, and the governance structures that shape decision-making, our AI navigates the complexities of the public sector with clarity and contextual depth.',
  },
];

// Fix 7: pre-compute CSS color strings once at module level — no THREE.Color allocation on every render
const REGION_CSS = REGIONS.map(r => ({
  color: `#${r.color.toString(16).padStart(6, '0')}`,
  emissive: `#${r.emissive.toString(16).padStart(6, '0')}`,
}));

const BLOCKS = [
  // ── FRONTAL LOBE (region 0) ──
  [0,  0.0,  1.5,  1.5,  2.0, 1.0, 1.0],
  [0,  0.0,  1.5,  0.5,  2.5, 1.0, 1.0],
  [0,  0.0,  0.5,  1.5,  2.0, 1.0, 1.0],
  [0,  0.0,  0.5,  0.5,  2.5, 1.0, 1.0],
  [0,  0.0, -0.0,  1.5,  2.0, 1.0, 1.0],
  [0,  0.0,  0.0,  0.5,  2.5, 1.0, 1.0],
  // ── PARIETAL LOBE (region 1) ──
  [1,  0.0,  1.5, -0.75,  2.5, 1.0, 1.0],
  [1,  0.0,  0.5, -0.75,  2.5, 1.0, 1.0],
  [1,  0.0,  0.0, -0.75,  2.0, 1.0, 1.0],
  // ── TEMPORAL LOBE (region 2) ──
  [2, -1.5,  0.0,  0.5,  1.0, 1.0, 2.0],
  [2, -1.5, -0.5,  0.5,  1.0, 1.0, 2.0],
  [2,  1.5,  0.0,  0.5,  1.0, 1.0, 2.0],
  [2,  1.5, -0.5,  0.5,  1.0, 1.0, 2.0],
  // ── OCCIPITAL LOBE (region 3) ──
  [3,  0.0,  1.5, -1.5,  2.0, 1.0, 1.0],
  [3,  0.0,  0.5, -1.5,  2.5, 1.0, 1.0],
  [3,  0.0,  0.0, -1.5,  2.0, 1.0, 1.0],
  // ── CEREBELLUM (region 4) ──
  [4,  0.0, -0.5, -1.5,  2.5, 1.0, 1.0],
  [4,  0.0, -1.0, -1.0,  2.0, 1.0, 1.0],
  [4,  0.0, -1.0, -1.5,  2.0, 1.0, 1.0],
  // ── BRAIN STEM (region 5) ──
  [5,  0.0, -1.0,  0.0,  1.0, 1.0, 1.0],
  [5,  0.0, -1.5,  0.0,  0.75, 1.0, 1.0],
  [5,  0.0, -2.0,  0.0,  0.5, 1.0, 1.0],
];

export default function BusinessIntelligenceVisual() {
  const mountRef = useRef(null);
  const [activeRegion, setActiveRegion] = useState(0);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // Fix 8: guard against WebGL context failure (denied in private/low-memory browsers)
    let renderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('error');
      return;
    }

    let regionIndex = 0;
    let glowStart = performance.now();
    let userSelected = false;
    let userSelectTime = 0;
    const USER_PAUSE = 12000;
    const GLOW_DURATION = 8000;

    const scene = new Scene();
    const camera = new PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 1.5, 9);
    camera.lookAt(0, -0.2, 0);

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0xfff5e6, 0.6));
    const key = new DirectionalLight(0xfff5e6, 1.8);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new DirectionalLight(0xff9966, 0.4);
    fill.position.set(-5, 2, 4);
    scene.add(fill);
    const back = new DirectionalLight(0x444444, 0.3);
    back.position.set(0, -4, -5);
    scene.add(back);

    const materials = REGIONS.map(() =>
      new MeshStandardMaterial({ color: 0xc8864e, emissive: 0x000000, roughness: 0.55, metalness: 0.08 })
    );

    const brainGroup = new Group();
    const GAP = 0.04;
    const meshes = [];

    BLOCKS.forEach(([regionIdx, x, y, z, w, h, d]) => {
      const geo = new BoxGeometry(w - GAP, h - GAP, d - GAP);
      const mesh = new Mesh(geo, materials[regionIdx]);
      mesh.position.set(x, y, z);
      mesh.userData.regionIdx = regionIdx;
      brainGroup.add(mesh);
      meshes.push(mesh);
    });

    brainGroup.rotation.y = Math.PI / 4;
    scene.add(brainGroup);
    setStatus('ok');

    const applyRegion = (idx) => { regionIndex = idx; setActiveRegion(idx); };

    // Fix 2: accumulate mousemove events; consume one per rAF tick instead of raycasting at pointer rate
    const raycaster = new Raycaster();
    const mouse = new Vector2();
    let pendingMouse = null;

    // Fix 3: pause rAF when card is off-screen; resume when back in view (avoids shader recompile on re-mount)
    let animId = null;

    const loop = () => {
      const now = performance.now();
      const elapsed = now - glowStart;

      if (userSelected && now - userSelectTime > USER_PAUSE) {
        userSelected = false;
        glowStart = now;
      }
      if (!userSelected && elapsed > GLOW_DURATION) {
        glowStart = now;
        applyRegion((regionIndex + 1) % REGIONS.length);
      }

      // Process at most one pending mousemove per frame
      if (pendingMouse) {
        const rect = container.getBoundingClientRect();
        mouse.x = ((pendingMouse.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((pendingMouse.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(meshes);
        renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'default';
        pendingMouse = null;
      }

      // Fix 7: use setHex() — no new Color() allocation per frame
      materials.forEach((mat, i) => {
        if (i === regionIndex) {
          mat.color.setHex(REGIONS[i].color);
          mat.emissive.setHex(REGIONS[i].emissive);
          mat.emissiveIntensity = 1.2;
        } else {
          mat.color.setHex(0xc8864e);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      });

      renderer.render(scene, camera);
      animId = requestAnimationFrame(loop);
    };

    const pause = () => { if (animId) { cancelAnimationFrame(animId); animId = null; } };
    const resume = () => { if (!animId) loop(); };

    // Fix 3: IntersectionObserver — pause when card scrolls off, resume when it scrolls back
    const io = new IntersectionObserver(
      ([entry]) => { entry.isIntersecting ? resume() : pause(); },
      { threshold: 0 }
    );
    io.observe(container);
    resume();

    const onClick = (e) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshes);
      if (hits.length > 0) {
        userSelected = true;
        userSelectTime = performance.now();
        glowStart = performance.now();
        applyRegion(hits[0].object.userData.regionIdx);
      }
    };

    const onMouseMove = (e) => { pendingMouse = e; };

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    container.addEventListener('click', onClick);
    container.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onResize);

    return () => {
      pause();
      io.disconnect();
      window.removeEventListener('resize', onResize);
      container.removeEventListener('click', onClick);
      container.removeEventListener('mousemove', onMouseMove);
      renderer.dispose();
      materials.forEach(m => m.dispose());
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: 'transparent', minHeight: '320px' }}
    >
      <div ref={mountRef} className="absolute inset-0" />

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-10 h-10 rounded-full border-4 animate-spin"
            style={{ borderColor: '#e0ceba', borderTopColor: '#f97316' }}
          />
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p style={{ color: '#a07050', fontSize: '0.8rem', opacity: 0.6 }}>
            3D view unavailable on this device.
          </p>
        </div>
      )}

      {/* Fix 7: use pre-computed REGION_CSS strings — no THREE.Color in render path */}
      {status === 'ok' && REGIONS.map((r, i) => (
        <div
          key={i}
          className="absolute pointer-events-none transition-all duration-700 -translate-x-1/2"
          style={{ top: r.label.top, left: r.label.left, opacity: activeRegion === i ? 1 : 0 }}
        >
          <span
            className="text-2xl font-bold tracking-wide"
            style={{
              color: REGION_CSS[i].color,
              fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}
          >
            {r.name}
          </span>
        </div>
      ))}

      {status === 'ok' && (
        <div
          className="absolute top-1/2 -translate-y-1/2 w-64 transition-all duration-500 pointer-events-none"
          style={{ right: '6%' }}
        >
          <div
            className="rounded-2xl px-5 py-5 shadow-2xl"
            style={{
              background: '#d9b48a',
              borderLeft: `4px solid ${REGION_CSS[activeRegion].color}`,
              boxShadow: `0 8px 32px rgba(0,0,0,0.18), 0 0 16px ${REGION_CSS[activeRegion].color}33`,
            }}
          >
            <p
              className="text-xs font-bold tracking-widest uppercase mb-2"
              style={{ color: REGION_CSS[activeRegion].emissive }}
            >
              {REGIONS[activeRegion].name} Sector
            </p>
            <p className="text-sm leading-relaxed" style={{ color: '#2a1505' }}>
              {REGIONS[activeRegion].insight}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
