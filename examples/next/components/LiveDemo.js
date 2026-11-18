'use client';
/** A page to try SilkHtml (/live): switch to another card, change the words in place, unmount and remount it.
 *  scripts/frameworks.mjs drives it. */
import { useState } from 'react';
import SilkHtml from './SilkHtml';

const CARDS = {
  pomegranate: { title: 'Pomegranate, in silk', text: 'Every word here is text in the page: select it and copy it.' },
  parrot: { title: 'A bird of gold', text: 'Gold, enamel and gemstones, printed on silk, still text in the page.' },
};
const cardStyle = { width: 300, padding: '20px 24px', borderRadius: 18, background: '#fbf7ef', color: '#2a2620', fontFamily: 'Georgia, serif' };

export default function LiveDemo() {
  const [id, setId] = useState('pomegranate');
  const [more, setMore] = useState(false);
  const [shown, setShown] = useState(true);
  const c = CARDS[id];
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 480 }}>
      <p>
        <button id="toggle" onClick={() => setId((s) => (s === 'pomegranate' ? 'parrot' : 'pomegranate'))}>Switch card</button>{' '}
        <button id="words" onClick={() => setMore((v) => !v)}>Change the words</button>{' '}
        <button id="hide" onClick={() => setShown((v) => !v)}>{shown ? 'Unmount' : 'Mount'}</button>
      </p>
      {shown && (
        <SilkHtml key={id} style={{ width: 420, aspectRatio: '1' }} cardStyle={cardStyle} onReady={(h) => { window.__silk = h; }}>
          <h2 id="title" style={{ margin: '0 0 8px', color: '#6b1f1a' }}>{c.title}</h2>
          <p id="words-line" style={{ margin: 0 }}>{c.text}{more && ' And now a second sentence, written in place by React, so the card grows.'}</p>
        </SilkHtml>
      )}
    </main>
  );
}
