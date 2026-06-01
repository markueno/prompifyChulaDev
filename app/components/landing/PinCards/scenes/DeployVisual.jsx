import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STAGES = [
  { label: 'SSO Integration', icon: '🔐' },
  { label: 'API Config',      icon: '⚙️' },
  { label: 'Compliance',      icon: '📋' },
  { label: 'Load Test',       icon: '🧪' },
  { label: 'Deploy',          icon: '🚀' },
];

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

export default function DeployVisual() {
  const [activeStep, setActiveStep] = useState(null);
  const [done, setDone] = useState(new Set());
  const cancelRef = useRef(false);
  const runningRef = useRef(false);

  const runAuto = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setActiveStep(null);
    setDone(new Set());
    await delay(700);

    for (let i = 0; i < STAGES.length; i++) {
      if (cancelRef.current) { runningRef.current = false; return; }
      setActiveStep(i);
      await delay(900);
      if (cancelRef.current) { runningRef.current = false; return; }
      setDone(prev => new Set([...prev, i]));
      await delay(220);
    }
    setActiveStep(null);
    await delay(2500);
    runningRef.current = false;
    if (!cancelRef.current) runAuto();
  };

  useEffect(() => {
    runAuto();
    return () => { cancelRef.current = true; };
  }, []);

  const handleNodeClick = (i) => {
    cancelRef.current = true;
    runningRef.current = false;
    setDone(prev => {
      const next = new Set(prev);
      for (let j = 0; j < i; j++) next.add(j);
      return next;
    });
    setActiveStep(i);
    setTimeout(() => {
      setDone(prev => new Set([...prev, i]));
      setActiveStep(null);
      if (i === STAGES.length - 1) {
        setTimeout(() => { runAuto(); }, 1800);
      }
    }, 850);
  };

  const maxDone = done.size > 0 ? Math.max(...done) : -1;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6" style={{ padding: '0 2rem' }}>

      {/* "Prompify will..." label above pipeline */}
      <div style={{ textAlign: 'center' }}>
        <span style={{
          fontSize: '0.72rem',
          letterSpacing: '0.12em',
          color: 'rgba(0,0,0,0.28)',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
        }}>
          Prompify will...
        </span>
      </div>

      {/* Pipeline */}
      <div className="relative w-full" style={{ maxWidth: 560 }}>
        {/* Track */}
        <div className="absolute" style={{ top: '28px', left: '28px', right: '28px', height: '2px', background: 'rgba(0,0,0,0.08)' }} />
        {/* Progress fill */}
        <motion.div
          className="absolute rounded-full"
          style={{ top: '27px', left: '28px', height: '4px', background: 'linear-gradient(90deg, #f97316, #fb923c)', transformOrigin: 'left' }}
          animate={{ width: maxDone < 0 ? '0%' : `${(maxDone / (STAGES.length - 1)) * 100}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />

        <div className="relative flex items-start justify-between">
          {STAGES.map((stage, i) => {
            const isDone = done.has(i);
            const isActive = activeStep === i && !isDone;
            return (
              <div
                key={i}
                className="relative z-10 flex flex-col items-center gap-3"
                style={{ cursor: 'pointer' }}
                onClick={() => handleNodeClick(i)}
              >
                <motion.div
                  className="relative flex items-center justify-center"
                  style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: isDone ? '#f97316' : isActive ? 'rgba(249,115,22,0.12)' : 'rgba(0,0,0,0.04)',
                    border: isDone ? '3px solid #f97316' : isActive ? '3px solid rgba(249,115,22,0.8)' : '2px solid rgba(0,0,0,0.1)',
                    boxShadow: isActive ? '0 0 24px rgba(249,115,22,0.45)' : isDone ? '0 0 16px rgba(249,115,22,0.3)' : 'none',
                    transition: 'background 0.3s, border 0.3s, box-shadow 0.3s',
                  }}
                  animate={isActive ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                  whileHover={{ scale: 1.1 }}
                  transition={{ duration: 0.55 }}
                >
                  <AnimatePresence mode="wait">
                    {isDone ? (
                      <motion.svg key="check" width="22" height="22" viewBox="0 0 24 24" fill="none"
                        stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.3 }}>
                        <polyline points="20 6 9 17 4 12" />
                      </motion.svg>
                    ) : isActive ? (
                      <motion.div key="dot" className="w-4 h-4 rounded-full" style={{ background: '#f97316' }}
                        animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 0.65 }} />
                    ) : (
                      <motion.span key="num" style={{ fontSize: 15, color: 'rgba(0,0,0,0.25)', fontFamily: 'monospace' }}
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        {i + 1}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>

                <div style={{ fontSize: 18 }}>{stage.icon}</div>

                <span className="text-center leading-tight font-medium"
                  style={{
                    fontSize: 10,
                    color: isDone ? '#f97316' : isActive ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.28)',
                    maxWidth: 64, whiteSpace: 'nowrap',
                    transition: 'color 0.3s',
                  }}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status pill */}
      <AnimatePresence mode="wait">
        {done.size === STAGES.length ? (
          <motion.div key="success"
            className="text-sm font-semibold px-6 py-2.5 rounded-full"
            style={{ background: 'rgba(249,115,22,0.1)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)' }}
            initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            ✓ Deployed successfully — click any step to re-run
          </motion.div>
        ) : activeStep !== null ? (
          <motion.div key={`stage-${activeStep}`}
            className="text-sm px-6 py-2.5 rounded-full"
            style={{ background: 'rgba(0,0,0,0.04)', color: 'rgba(0,0,0,0.45)', border: '1px solid rgba(0,0,0,0.07)' }}
            initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            Running: {STAGES[activeStep]?.label}...
          </motion.div>
        ) : (
          <motion.div key="hint"
            className="text-xs px-4 py-2 rounded-full"
            style={{ color: 'rgba(0,0,0,0.22)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Click any step to trigger it
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}