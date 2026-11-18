/**
 * SilkHtml.jsx — live HTML as a React component: its children are printed on the silk (HTML-in-Canvas, Chrome 157+)
 * and stay real DOM, so React keeps rendering into them; the same file works in Next.js with 'use client' on top.
 *
 * Two nodes, two owners. React owns the stage <div> and the card <div> around the children. silkify owns the canvas,
 * made here in the effect like Silk.jsx's, and it moves the card <div> into that canvas while it is live, and back
 * into the stage on dispose() (unmount, StrictMode's second mount) or on any fallback. React never inserts or removes
 * the card itself (it only updates what is inside it), so the move is invisible to it. Where the browser has no
 * HTML-in-Canvas the card simply stays in the stage as plain HTML, centred where the live one would be drawn (1:1).
 *
 * Style the card through cardStyle / cardClassName: its own background and border-radius are the silk's outline.
 */
import { useEffect, useRef } from 'react';
import { silkify } from './silk/silk.js';   // src/ copied here (npm run silk); `three` comes from npm

export default function SilkHtml({ children, options, className, style, cardClassName, cardStyle, onReady }) {
  const box = useRef(null), card = useRef(null);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    box.current.prepend(canvas);
    const silk = silkify(canvas, { element: card.current, ...options });
    silk.ready.then((h) => h.mode !== 'disposed' && onReady?.(h));
    return () => { silk.dispose(); silk.canvas.remove(); };
  }, []);   // options are read once: change them live with handle.setTheme() (from onReady)
  return (
    <div ref={box} className={className} style={{ position: 'relative', display: 'grid', placeItems: 'center', touchAction: 'pan-y', ...style }}>
      <div ref={card} className={cardClassName} style={cardStyle}>{children}</div>
    </div>
  );
}
