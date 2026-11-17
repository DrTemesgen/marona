import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './ui/App';
import { ArtGallery } from './ui/art';

// /?gallery=1 shows every scene and casualty state, for the art review.
const gallery = new URLSearchParams(location.search).get('gallery') === '1';

// Register the service worker so practice works offline after the first load.
try {
  registerSW({ immediate: true });
} catch {
  /* the app still works online without a service worker */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{gallery ? <ArtGallery /> : <App />}</StrictMode>,
);
