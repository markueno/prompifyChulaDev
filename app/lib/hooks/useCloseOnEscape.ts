import { useEffect } from 'react';

/**
 * Close a modal on Escape.
 *
 * The data modals were dismissable only by their × button and footer Cancel, which is a dead end
 * when the panel is taller than the viewport — a wide import (many columns) pushed the header
 * off-screen with no way out. Escape is the reliable escape hatch regardless of layout.
 */
export function useCloseOnEscape(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, enabled]);
}
