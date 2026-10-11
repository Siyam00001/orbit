import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import App from './App.tsx';
import { LOCAL } from './api.ts';
import './styles.css';

// apply the saved theme before the first paint so there's no flash of the default colours
let theme: string | null = null;
try { theme = localStorage.getItem('orbit-theme'); } catch { /* storage blocked: default theme */ }
document.documentElement.dataset.theme = theme || 'cosmos';

createRoot(document.getElementById('root')!).render(<App />);

if (LOCAL) {
  // phone app: work offline, and ask the browser not to evict on-device data under storage pressure
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  navigator.storage?.persist?.();
}
