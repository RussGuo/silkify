'use client';
/**
 * Silk.js — examples/react/src/Silk.jsx for the Next.js app router: the same component, 'use client' on top.
 *
 * The canvas is made here, in the effect, not rendered by React: silkify hands it to a Web Worker, and may swap
 * in a fresh clone (a canvas can be transferred only once), so React must never hold a ref to it. React owns the
 * <div>; every mount gets a new canvas, and the cleanup disposes the renderer and removes whatever canvas it ended
 * with. StrictMode's mount → unmount → mount and a changing `src` are both a plain remount.
 */
import { useEffect, useRef } from 'react';
import { silkify } from '../lib/silk/silk.js';   // src/ copied to lib/silk (npm run silk); `three` comes from npm

export default function Silk({ src, options, className, style, onReady }) {
  const box = useRef(null);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    box.current.append(canvas);
    const silk = silkify(canvas, { image: src, ...options });
    silk.ready.then((h) => h.mode !== 'disposed' && onReady?.(h));
    return () => { silk.dispose(); silk.canvas.remove(); };
  }, [src]);   // options are read once: change them live with handle.setTheme() (from onReady)
  return <div ref={box} className={className} style={{ aspectRatio: '1', touchAction: 'pan-y', ...style }} aria-hidden />;
}
