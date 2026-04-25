const PIC_BASE = '/landing-pics';

/** Same full-viewport background treatment as the marketing home page (`/`). */
export function LandingAppChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing-page landing-app-root flex w-full min-h-[100dvh] flex-col">
      <div className="landing-hero-bg" aria-hidden>
        <img
          src={`${PIC_BASE}/background1.jpeg`}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="gradient-overlay" />
        <div className="vignette" />
      </div>
      <div className="relative z-[1] flex min-h-0 w-full flex-1 flex-col">{children}</div>
    </div>
  );
}
