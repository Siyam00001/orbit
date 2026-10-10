import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { LOCAL } from './api.ts';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

if (LOCAL) {
  // phone app: work offline, and ask the browser not to evict on-device data under storage pressure
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  navigator.storage?.persist?.();
}
