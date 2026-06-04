'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface OutroProps {
  onStartBuilding?: () => void;
  onContactUs?: () => void;
}

export default function Outro({ onStartBuilding, onContactUs }: OutroProps) {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: 'top 80%',
        onEnter: () => {
          sectionRef.current?.querySelector('.shimmer-text')?.classList.add('active');
        },
      });
    },
    { scope: sectionRef }
  );

  return (
    <section className="outro" ref={sectionRef}>
      <h2>
        <span style={{ color: '#f97316' }}>Prompt</span>
        <br />
        <span className="shimmer-text">Refine and Deploy</span>
      </h2>
      <p>
        From retail CRMs to logistics systems, Prompify AI powers smart integrations that transform daily operations.
        <br />
        <br />
        <b>At Prompify, creativity meets creation.</b>
      </p>
      <div className="outro-buttons">
        <button
          className="outro-cta-btn"
          style={{ borderRadius: '9999px' }}
          onClick={() => (onStartBuilding ? onStartBuilding() : (window.location.href = '/signup'))}
        >
          Start Building
        </button>
        <button
          className="contact-us-btn"
          style={{ borderRadius: '9999px' }}
          onClick={() => (onContactUs ? onContactUs() : (window.location.href = '/contact'))}
        >
          Contact Us
        </button>
      </div>
    </section>
  );
}
