import { type RefObject, useLayoutEffect, useState } from 'react';

import type { ScreenSize } from '@mfd/cad-engine';

/**
 * Track an element's rendered size.
 *
 * The canvas must be sized in real pixels before anything can be drawn, and it has
 * to survive window resizes and panel changes — so we measure the element rather
 * than assume the window.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ScreenSize {
  const [size, setSize] = useState<ScreenSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      // Round to whole pixels: a fractional canvas size produces blurred lines.
      setSize((previous) => {
        const next = { width: Math.round(width), height: Math.round(height) };
        return previous.width === next.width && previous.height === next.height
          ? previous
          : next;
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
