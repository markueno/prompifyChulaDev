import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ScaleToFit from '../ScaleToFit';

const APP_TYPES = ['CRM', 'Dashboard', 'Dark Theme', 'Private', 'Secure', 'Database'];
const AUTO_SEQUENCE = [1, 0, 4]; // Dashboard, CRM, Secure

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export default function PromptToProduct() {
  const [selectedSet, setSelectedSet] = useState(new Set());
  const [phase, setPhase] = useState('selecting');
  const cancelRef = useRef(false);
  const userInteractedRef = useRef(false);

  const runAuto = async () => {
    if (userInteractedRef.current) return;
    cancelRef.current = false;
    setSelectedSet(new Set());
    setPhase('selecting');

    for (const idx of AUTO_SEQUENCE) {
      if (cancelRef.current || userInteractedRef.current) return;
      await delay(2200); // slower — gives user time to explore
      setSelectedSet(prev => new Set([...prev, idx]));
    }
    await delay(2000);
    if (cancelRef.current || userInteractedRef.current) return;
    setPhase('morphing');
    await delay(1000);
    if (cancelRef.current || userInteractedRef.current) return;
    setPhase('browser');
    await delay(6000); // longer browser view
    if (cancelRef.current || userInteractedRef.current) return;
    runAuto();
  };

  useEffect(() => {
    runAuto();
    return () => { cancelRef.current = true; };
  }, []);

  const handleToggle = (i) => {
    userInteractedRef.current = true;
    cancelRef.current = true;
    setPhase('selecting');
    setSelectedSet(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleBuild = () => {
    if (selectedSet.size === 0) return;
    cancelRef.current = true;
    setPhase('morphing');
    delay(1000).then(() => setPhase('browser'));
  };

  const handleReset = () => {
    userInteractedRef.current = false;
    cancelRef.current = true;
    setSelectedSet(new Set());
    setPhase('selecting');
    setTimeout(() => runAuto(), 200);
  };

  return (
    <div className="w-full h-full flex items-center justify-center">
      <ScaleToFit designWidth={720}>
      <AnimatePresence mode="wait">
        {phase !== 'browser' ? (
          <motion.div
            key="selector"
            className="flex flex-col gap-4"
            style={{ width: 430, margin: '0 auto' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: phase === 'morphing' ? 1.04 : 1 }}
            exit={{ opacity: 0, scale: 1.08, y: -8 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="text-xs font-mono mb-1" style={{ color: 'rgba(0,0,0,0.35)', letterSpacing: '0.09em' }}>
              WHAT ARE YOU BUILDING?
            </div>

            <div className="grid grid-cols-2 gap-2">
              {APP_TYPES.map((label, i) => {
                const isSelected = selectedSet.has(i);
                return (
                  <motion.div
                    key={label}
                    className="flex items-center gap-2 rounded-xl px-3 py-3 cursor-pointer"
                    onClick={() => handleToggle(i)}
                    animate={{ background: isSelected ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.04)' }}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.25 }}
                    style={{ border: `1.5px solid ${isSelected ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.1)'}` }}
                  >
                    <motion.div
                      className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                      animate={{
                        background: isSelected ? '#f97316' : 'transparent',
                        borderColor: isSelected ? '#f97316' : 'rgba(0,0,0,0.25)',
                      }}
                      transition={{ duration: 0.22 }}
                      style={{ border: '2px solid rgba(0,0,0,0.25)', borderRadius: 5 }}
                    >
                      {isSelected && (
                        <motion.svg
                          width="11" height="11" viewBox="0 0 24 24" fill="none"
                          stroke="white" strokeWidth="3" strokeLinecap="round"
                          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                          transition={{ duration: 0.2 }}
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </motion.svg>
                      )}
                    </motion.div>
                    <span className="text-sm font-medium" style={{ color: isSelected ? 'white' : 'rgba(0,0,0,0.6)' }}>
                      {label}
                    </span>
                  </motion.div>
                );
              })}
            </div>

            <AnimatePresence>
              {selectedSet.size > 0 && (
                <motion.button
                  className="mt-1 flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-semibold w-full cursor-pointer"
                  style={{ background: '#f97316', color: 'white', border: 'none' }}
                  onClick={handleBuild}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.3 }}
                >
                  {phase === 'morphing' ? (
                    <>
                      {[0, 1, 2].map(i => (
                        <motion.div key={i} className="w-2 h-2 rounded-full bg-white"
                          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.18 }} />
                      ))}
                      <span>Building...</span>
                    </>
                  ) : (
                    <span>Build with Prompify</span>
                  )}
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="browser"
            className="overflow-hidden"
            style={{ width: 720, borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.07)', cursor: 'pointer' }}
            initial={{ opacity: 0, scale: 0.8, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={handleReset}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Chrome bar */}
            <div className="flex items-center gap-1.5 px-4 py-3" style={{ background: '#181818' }}>
              <div className="w-3 h-3 rounded-full" style={{ background: '#ff5f56' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#febc2e' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#27c93f' }} />
              <div className="flex-1 mx-3 h-5 rounded-md px-3 flex items-center"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>app.prompify.ai/dashboard</span>
              </div>
            </div>

            <div style={{ background: '#fff' }}>
              {/* App nav */}
              <div className="flex items-center justify-between px-5 py-3" style={{ background: '#0d0d0d' }}>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-sm" style={{ background: '#f97316' }} />
                  <div className="h-2 w-16 rounded" style={{ background: 'rgba(255,255,255,0.22)' }} />
                </div>
                <div className="flex gap-5">
                  {['Overview', 'Analytics', 'Reports'].map(l => (
                    <div key={l} className="text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{l}</div>
                  ))}
                </div>
                <div className="h-5 rounded-md px-2 py-1 text-[8px] font-bold" style={{ background: '#f97316', color: 'white' }}>Upgrade</div>
              </div>

              {/* Dashboard body */}
              <div className="p-5" style={{ background: '#f6f6f6' }}>
                <div className="grid grid-cols-3 gap-2.5 mb-4">
                  {[['Total Users', '12,841', '+18%'], ['Revenue', '$248K', '+11%'], ['Conversion', '4.8%', '+0.6%']].map(([l, v, c], idx) => (
                    <motion.div key={l} className="rounded-xl p-3"
                      style={{ background: 'white', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + idx * 0.1 }}>
                      <div className="text-[7px] mb-1 font-medium" style={{ color: 'rgba(0,0,0,0.38)' }}>{l}</div>
                      <div className="font-bold text-sm" style={{ color: '#111' }}>{v}</div>
                      <div className="text-[8px] mt-0.5 font-semibold" style={{ color: '#10b981' }}>↑ {c}</div>
                    </motion.div>
                  ))}
                </div>

                <motion.div className="rounded-xl p-3"
                  style={{ background: 'white', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
                  <div className="text-[8px] font-semibold mb-2.5" style={{ color: 'rgba(0,0,0,0.35)' }}>WEEKLY ACTIVITY</div>
                  <div className="flex items-end gap-2 h-14">
                    {[40, 65, 48, 88, 72, 95, 55].map((h, i) => (
                      <motion.div key={i} className="flex-1 rounded-t-sm"
                        style={{ background: i === 3 || i === 5 ? '#f97316' : 'rgba(249,115,22,0.18)', originY: 1 }}
                        initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                        transition={{ delay: 0.55 + i * 0.06, duration: 0.4, ease: 'easeOut' }}>
                        <div style={{ height: `${h}%` }} />
                      </motion.div>
                    ))}
                  </div>
                  <div className="text-[7px] text-center mt-1" style={{ color: 'rgba(0,0,0,0.25)' }}>Click to restart</div>
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </ScaleToFit>
    </div>
  );
}
