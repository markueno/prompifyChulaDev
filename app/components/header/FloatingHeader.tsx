import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { Link, useLoaderData, useLocation } from '@remix-run/react';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { NotificationBell } from './NotificationBell.client';
import { ConnectionStatusBanner } from '~/components/chat/ConnectionStatusBanner.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { UserProfile } from '~/components/auth/UserProfile';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.client';

/*
 * Hover-reveal top navbar. Mirrors the sidebar's hover pattern (Menu.client.tsx) but for the
 * top edge. When a chat has NOT started, it renders the original in-flow header (so the empty
 * chat / landing still shows the chrome). Once a chat starts, it becomes a fixed overlay that
 * slides down when the pointer nears the top edge and slides back up when the pointer leaves —
 * so the user never has to scroll to the top to reach the project name / user menu / actions.
 *
 * Closing is deferred (CLOSE_DELAY) and suppressed while any Radix popover/menu/dialog is open
 * (detected via [data-state="open"]) so opening the user menu doesn't yank the bar away.
 */
const REVEAL_THRESHOLD = 8; // px from the top edge that triggers reveal
const EXIT_THRESHOLD = 24; // px below the bar's bottom before we start closing
const CLOSE_DELAY = 350; // ms grace before closing (lets you move into a dropdown)

export function FloatingHeader() {
  const chat = useStore(chatStore);
  const { user } = useLoaderData<{ user: any }>();
  const location = useLocation();
  const onOverview = location.pathname.startsWith('/app/overview');
  const onPricing = location.pathname.startsWith('/app/pricing');

  const started = chat.started;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!started) {
      return;
    }

    function clearClose() {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
      }
    }

    function scheduleClose() {
      clearClose();
      closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
    }

    function onMouseMove(event: MouseEvent) {
      // Reveal when the pointer is near the top edge of the viewport.
      if (event.clientY < REVEAL_THRESHOLD) {
        clearClose();
        setOpen(true);

        return;
      }

      const rect = ref.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      // While the pointer is over the bar (plus a small margin), keep it open.
      if (event.clientY >= rect.top && event.clientY <= rect.bottom + EXIT_THRESHOLD) {
        clearClose();
        return;
      }

      /*
       * Don't auto-close while a Radix popover/menu/dialog is open (e.g. the user menu, the
       * settings modal) — those render in a portal below the bar; closing would strand them.
       */
      if (document.querySelector('[data-state="open"]')) {
        clearClose();
        return;
      }

      // Pointer left the bar — close after a short grace period.
      scheduleClose();
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      clearClose();
    };
  }, [started]);

  // The shared inner content (identical to Header.tsx).
  const content = (
    <>
      <div className="flex items-center gap-4 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="flex items-center gap-2">
          <div className="i-ph:sidebar-simple-duotone text-xl" />
          <Link to="/app/" className="text-2xl font-semibold text-accent flex items-center">
            <img src="/prompify2.png" alt="Prompify" className="w-[40px] inline-block ml-1" />
          </Link>
        </div>
        {user ? (
          <>
            <Link
              to="/app/overview"
              className={classNames(
                'header-nav-overview hidden text-sm font-medium sm:inline-block rounded-md px-2 py-1 transition-colors',
                onOverview ? 'bg-white/10 text-white' : 'text-white/90 hover:text-white'
              )}
            >
              Overview
            </Link>
            <Link
              to="/app/pricing"
              className={classNames(
                'header-nav-pricing hidden text-sm font-medium sm:inline-block rounded-md px-2 py-1 transition-colors',
                onPricing ? 'bg-white/10 text-white' : 'text-white/90 hover:text-white'
              )}
            >
              Pricing
            </Link>
          </>
        ) : null}
      </div>
      {started ? (
        <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
          <ClientOnly>{() => <ChatDescription />}</ClientOnly>
        </span>
      ) : (
        <span className="flex-1 text-center text-lg font-bold text-white">Prompify</span>
      )}
      <ClientOnly>
        {() => (
          <div className="header-app-toolbar mr-1 flex items-center gap-2">
            <ConnectionStatusBanner />
            {started && <HeaderActionButtons />}
            {user && (
              <>
                <ClientOnly>{() => <WorkspaceSwitcher />}</ClientOnly>
                <NotificationBell />
                <UserProfile user={user} />
              </>
            )}
          </div>
        )}
      </ClientOnly>
    </>
  );

  // No chat yet: render the original in-flow header (no hover behavior, chrome stays visible).
  if (!started) {
    return (
      <header className={classNames('flex items-center p-5 border-b h-[var(--header-height)]', 'border-transparent')}>
        {content}
      </header>
    );
  }

  /*
   * Chat started: fixed hover-reveal overlay. `.landing-app-chrome > header` (landing.css) still
   * applies the glass background / blur / border + child text colors; we add fixed positioning,
   * a slide transition, and a high z so it overlays the chat/workbench.
   */
  return (
    <header
      ref={ref}
      className={classNames(
        'flex items-center p-5 border-b h-[var(--header-height)] border-bolt-elements-borderColor',
        'fixed top-0 left-0 right-0 z-[998] transition-all duration-200',
        open ? 'translate-y-0 opacity-100 pointer-events-auto' : '-translate-y-full opacity-0 pointer-events-none'
      )}
      onMouseEnter={() => {
        if (closeTimer.current) {
          clearTimeout(closeTimer.current);
          closeTimer.current = undefined;
        }

        setOpen(true);
      }}
    >
      {content}
    </header>
  );
}
