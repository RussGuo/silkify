import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import LiveDemo from './LiveDemo.jsx';

// /?live is the live-HTML page (SilkHtml.jsx); the root is the picture (Silk.jsx)
const Page = new URLSearchParams(location.search).has('live') ? LiveDemo : App;
createRoot(document.getElementById('root')).render(<StrictMode><Page /></StrictMode>);
