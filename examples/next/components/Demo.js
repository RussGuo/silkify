'use client';
/** A page to try the component: switch the picture, unmount and remount it. scripts/frameworks.mjs drives it. */
import { useState } from 'react';
import Silk from './Silk';

export default function Demo() {
  const [src, setSrc] = useState('/pomegranate.webp');
  const [shown, setShown] = useState(true);
  return (
    <main style={{ padding: 24, maxWidth: 480 }}>
      <p>
        <button id="toggle" onClick={() => setSrc((s) => (s === '/pomegranate.webp' ? '/parrot.webp' : '/pomegranate.webp'))}>Switch picture</button>{' '}
        <button id="hide" onClick={() => setShown((v) => !v)}>{shown ? 'Unmount' : 'Mount'}</button>
      </p>
      {shown && <Silk src={src} options={{ material: 'satin' }} style={{ width: 420 }} onReady={(h) => { window.__silk = h; }} />}
    </main>
  );
}
