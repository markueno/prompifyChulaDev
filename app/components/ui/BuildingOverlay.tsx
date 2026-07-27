import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const MESSAGES = [
  'Building your application...',
  'Crafting your experience...',
  'Generating your code...',
  'Setting up the workspace...',
];

const STREAMING_WORDS = [
  'Gooflering',
  'Embeddering',
  'Synaptifying',
  'Compiloozing',
  'Pixelweaving',
  'Logicmunching',
  'Promptcrunching',
  'Neurowiring',
  'Codestorming',
  'Deployifying',
  'Bundlefusing',
  'Querywrangling',
  'Schemaforging',
  'Algorithmizing',
  'Renderizing',
  'Stackweaving',
  'Asyncronizing',
  'Componentorging',
];

const COLORS = [
  { glow: '#f97316', bg: 'rgba(249,115,22,0.15)', shadow: 'rgba(249,115,22,0.4)', hue: 0 },
  { glow: '#3b82f6', bg: 'rgba(59,130,246,0.15)', shadow: 'rgba(59,130,246,0.4)', hue: 130 },
  { glow: '#c2410c', bg: 'rgba(194,65,12,0.15)', shadow: 'rgba(194,65,12,0.4)', hue: 200 },
  { glow: '#10b981', bg: 'rgba(16,185,129,0.15)', shadow: 'rgba(16,185,129,0.4)', hue: 90 },
];

function useColorCycle(active: boolean) {
  const [colorIdx, setColorIdx] = useState(0);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!active) {
      return;
    }

    const t = setInterval(() => {
      setColorIdx(i => (i + 1) % COLORS.length);
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    }, 1600);

    return () => clearInterval(t);
  }, [active]);

  return { color: COLORS[colorIdx], pulse };
}

// Icon filter: converts any dark logo to a colorized version
function iconFilter(hue: number) {
  return `brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(${hue}deg)`;
}

// ─── Full-screen overlay (initial build) ──────────────────────────────────────
interface BuildingOverlayProps {
  visible: boolean;
}

export function BuildingOverlay({ visible }: BuildingOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);
  const { color, pulse } = useColorCycle(mounted);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else {
      const t = setTimeout(() => setMounted(false), 400);
      return () => clearTimeout(t);
    }
  }, [visible]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const t = setInterval(() => setMsgIdx(i => (i + 1) % MESSAGES.length), 2800);

    return () => clearInterval(t);
  }, [mounted]);

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.35s ease',
      }}
    >
      <div className="flex flex-col items-center gap-6 select-none">
        {/* Icon with glow */}
        <div className="relative flex items-center justify-center" style={{ width: 156, height: 156 }}>
          {/* Outer ambient ring */}
          <div
            style={{
              position: 'absolute',
              width: 156,
              height: 156,
              borderRadius: '50%',
              background: color.bg,
              boxShadow: `0 0 70px 28px ${color.shadow}`,
              transform: pulse ? 'scale(1.14)' : 'scale(1)',
              transition: 'background 0.8s ease, box-shadow 0.8s ease, transform 0.6s ease',
            }}
          />
          {/* Inner circle */}
          <div
            style={{
              position: 'absolute',
              width: 108,
              height: 108,
              borderRadius: '50%',
              background: color.bg,
              transition: 'background 0.8s ease',
            }}
          />
          {/* Geometric icon */}
          <img
            src="/landing-pics/prompify.png"
            alt="Prompify icon"
            style={{
              position: 'relative',
              zIndex: 10,
              width: 70,
              height: 70,
              objectFit: 'contain',
              filter: `${iconFilter(color.hue)} drop-shadow(0 0 12px ${color.glow})`,
              transform: pulse ? 'scale(1.08)' : 'scale(1)',
              transition: 'filter 0.8s ease, transform 0.6s ease',
            }}
          />
        </div>

        {/* Rotating loading message */}
        <div style={{ height: 28, display: 'flex', alignItems: 'center' }}>
          <p
            key={msgIdx}
            style={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: '0.95rem',
              fontWeight: 400,
              letterSpacing: '0.02em',
              animation: 'buildingMsgIn 0.4s ease-out',
            }}
          >
            {MESSAGES[msgIdx]}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Compact streaming badge (during code generation) ─────────────────────────
interface StreamingBadgeProps {
  visible: boolean;
}

export function StreamingBadge({ visible }: StreamingBadgeProps) {
  const [mounted, setMounted] = useState(false);
  const [dotCount, setDotCount] = useState(1);
  const [wordIdx, setWordIdx] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const { color } = useColorCycle(mounted);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else {
      const t = setTimeout(() => setMounted(false), 350);
      return () => clearTimeout(t);
    }
  }, [visible]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const t = setInterval(() => setDotCount(d => (d % 3) + 1), 500);

    return () => clearInterval(t);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const cycle = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        setWordIdx(i => (i + 1) % STREAMING_WORDS.length);
        setWordVisible(true);
      }, 300);
    }, 2200);

    return () => clearInterval(cycle);
  }, [mounted]);

  if (!mounted) {
    return null;
  }

  const dots = '.'.repeat(dotCount);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}
    >
      <img
        src="/prompify2.png"
        alt="Prompify"
        style={{
          width: 120,
          height: 'auto',
          filter: `drop-shadow(0 0 24px ${color.glow})`,
          transition: 'filter 0.8s ease',
          animation: 'pulse-glow 2s ease-in-out infinite',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 32px',
          borderRadius: 16,
          background: 'rgba(10, 10, 10, 0.7)',
          border: `1px solid ${color.glow}40`,
          boxShadow: `0 0 32px 8px ${color.shadow}`,
          transition: 'border-color 0.8s ease, box-shadow 0.8s ease',
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: `2px solid ${color.glow}`,
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span
          style={{
            color: 'rgba(255,255,255,0.95)',
            fontSize: 26,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            opacity: wordVisible ? 1 : 0,
            transform: wordVisible ? 'translateY(0)' : 'translateY(6px)',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
            minWidth: 200,
            display: 'inline-block',
          }}
        >
          {STREAMING_WORDS[wordIdx]}
        </span>
        <span
          style={{
            color: color.glow,
            fontSize: 28,
            fontWeight: 700,
            minWidth: 28,
            transition: 'color 0.8s ease',
          }}
        >
          {dots}
        </span>
      </div>
    </div>,
    document.body
  );
}
