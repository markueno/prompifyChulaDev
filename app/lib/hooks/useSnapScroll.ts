import { useRef, useCallback, useState } from 'react';

interface ScrollOptions {
  duration?: number;
  easing?: 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier';
  cubicBezier?: [number, number, number, number];
  bottomThreshold?: number;
}

export function useSnapScroll(options: ScrollOptions = {}) {
  const {
    duration = 800,
    easing = 'ease-in-out',
    cubicBezier = [0.42, 0, 0.58, 1],
    bottomThreshold = 50, // pixels from bottom to consider "scrolled to bottom"
  } = options;

  const autoScrollRef = useRef(true);
  const scrollNodeRef = useRef<HTMLDivElement>();
  const onScrollRef = useRef<() => void>();
  const observerRef = useRef<ResizeObserver>();
  const animationFrameRef = useRef<number>();
  const lastScrollTopRef = useRef<number>(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const smoothScroll = useCallback(
    (element: HTMLDivElement, targetPosition: number, dur: number, easingFunction: string) => {
      const startPosition = element.scrollTop;
      const distance = targetPosition - startPosition;
      const startTime = performance.now();

      const bezierPoints = easingFunction === 'cubic-bezier' ? cubicBezier : [0.42, 0, 0.58, 1];

      const cubicBezierFunction = (t: number): number => {
        const [, y1, , y2] = bezierPoints;

        /*
         * const cx = 3 * x1;
         * const bx = 3 * (x2 - x1) - cx;
         * const ax = 1 - cx - bx;
         */

        const cy = 3 * y1;
        const by = 3 * (y2 - y1) - cy;
        const ay = 1 - cy - by;

        // const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
        const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;

        return sampleCurveY(t);
      };

      const animation = (currentTime: number) => {
        const elapsedTime = currentTime - startTime;
        const progress = Math.min(elapsedTime / dur, 1);

        const easedProgress = cubicBezierFunction(progress);
        const newPosition = startPosition + distance * easedProgress;

        // Only scroll if auto-scroll is still enabled
        if (autoScrollRef.current) {
          element.scrollTop = newPosition;
        }

        if (progress < 1 && autoScrollRef.current) {
          animationFrameRef.current = requestAnimationFrame(animation);
        }
      };

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(animation);
    },
    [cubicBezier]
  );

  const isScrolledToBottom = useCallback(
    (element: HTMLDivElement): boolean => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      return scrollHeight - scrollTop - clientHeight <= bottomThreshold;
    },
    [bottomThreshold]
  );

  /*
   * Instantly snap the scroll container to the bottom. Used by the ResizeObserver on
   * content growth (initial render + streaming) so the newest content is always in
   * view. An instant jump is reliable where an animated smoothScroll would be
   * cancelled/restarted on every token and land short during async rendering
   * (markdown / code-block layout).
   */
  const snapToBottom = useCallback(() => {
    if (scrollNodeRef.current) {
      scrollNodeRef.current.scrollTop = scrollNodeRef.current.scrollHeight;
    }
  }, []);

  const messageRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        const observer = new ResizeObserver(() => {
          if (autoScrollRef.current && scrollNodeRef.current) {
            snapToBottom();
            setIsAtBottom(true);
          }
        });

        observer.observe(node);
        observerRef.current = observer;
      } else {
        observerRef.current?.disconnect();
        observerRef.current = undefined;

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }
      }
    },
    [snapToBottom]
  );

  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        onScrollRef.current = () => {
          const { scrollTop } = node;

          // Detect scroll direction
          const isScrollingUp = scrollTop < lastScrollTopRef.current;

          // Update auto-scroll based on scroll direction and position
          if (isScrollingUp) {
            // Disable auto-scroll when scrolling up
            autoScrollRef.current = false;
          } else if (isScrolledToBottom(node)) {
            // Re-enable auto-scroll when manually scrolled to bottom
            autoScrollRef.current = true;
          }

          // Store current scroll position for next comparison
          lastScrollTopRef.current = scrollTop;
          setIsAtBottom(isScrolledToBottom(node));
        };

        node.addEventListener('scroll', onScrollRef.current);
        scrollNodeRef.current = node;

        /*
         * On (re)attach, if auto-scroll is enabled (fresh load / not scrolled up),
         * snap to the bottom immediately so a reopened/refreshed chat shows the
         * newest message without waiting for the first ResizeObserver tick.
         */
        if (autoScrollRef.current) {
          snapToBottom();
          setIsAtBottom(true);
        }
      } else {
        if (onScrollRef.current && scrollNodeRef.current) {
          scrollNodeRef.current.removeEventListener('scroll', onScrollRef.current);
        }

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }

        scrollNodeRef.current = undefined;
        onScrollRef.current = undefined;
      }
    },
    [isScrolledToBottom, snapToBottom]
  );

  /*
   * Imperative scroll-to-bottom for the "Jump to latest" button. Re-enables
   * auto-scroll and animates smoothly (a single user-triggered action), after
   * which the ResizeObserver resumes snapping for subsequent content growth.
   */
  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setIsAtBottom(true);

    if (scrollNodeRef.current) {
      const { scrollHeight, clientHeight } = scrollNodeRef.current;
      smoothScroll(scrollNodeRef.current, scrollHeight - clientHeight, duration, easing);
    }
  }, [duration, easing, smoothScroll]);

  return [messageRef, scrollRef, { isAtBottom, scrollToBottom }] as const;
}
