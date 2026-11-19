'use client';
/**
 * SilkHtml.js — examples/react/src/SilkHtml.jsx for the Next.js app router, 'use client' on top: its children are
 * printed on the silk (HTML-in-Canvas, Chrome 157+) and stay real DOM, so React keeps rendering into them.
 *
 * Two nodes, two owners. React owns the stage <div> and the card <div> around the children. silkify owns the canvas,
 * made here in the effect like Silk.js's, and it moves the card <div> into that canvas while it is live, and back
 * into the stage on dispose() (unmount, StrictMode's second mount) or on any fallback. React never inserts or removes
 * the card itself (it only updates what is inside it), so the move is invisible to it. Where the browser has no
 * HTML-in-Canvas the card simply stays in the stage as plain HTML, centred where the live one would be drawn (1:1).
 *
 * Style the card through cardStyle / cardClassName: its own background and border-radius are the silk's outline.
 * Events are props, as in Silk; a press on a link or a button inside the card is that control's, not an onPress.
 */
import { useEffect, useRef } from 'react';
import { silkify } from '../lib/silk/silk.js';   // src/ copied to lib/silk (npm run silk); `three` comes from npm

const EVENTS = ['onPress', 'onRelease', 'onStroke', 'onHover', 'onReady', 'onFail'];

export default function SilkHtml({ children, options, className, style, cardClassName, cardStyle, ...props }) {
  const box = useRef(null), card = useRef(null), on = useRef({});
  useEffect(() => { on.current = props; });   // the newest handlers (see Silk)
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    box.current.prepend(canvas);
    const relays = Object.fromEntries(EVENTS.map((name) => [name, (e) => (on.current[name] ?? options?.[name])?.(e)]));
    const silk = silkify(canvas, { element: card.current, ...options, ...relays });
    return () => { silk.dispose(); silk.canvas.remove(); };
  }, []);   // options are read once: change them live with handle.setTheme() (from onReady)
  return (
    <div ref={box} className={className} style={{ position: 'relative', display: 'grid', placeItems: 'center', touchAction: 'pan-y', ...style }}>
      <div ref={card} className={cardClassName} style={cardStyle}>{children}</div>
    </div>
  );
}
