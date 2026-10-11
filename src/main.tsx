import { Component, type ReactNode } from 'react';
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

/** A crash anywhere shows the error and a reload button instead of a blank white screen. */
class Crash extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    const { err } = this.state;
    return err
      ? <div className="loading"><div className="crash"><b>Orbit hit a snag 😕</b><code>{err.message}</code>
          <span className="mute">Screenshot this and send it over.</span>
          <button className="primary" onClick={() => location.reload()}>Reload</button></div></div>
      : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<Crash><App /></Crash>);

if (LOCAL) {
  // phone app: work offline, and ask the browser not to evict on-device data under storage pressure
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
  navigator.storage?.persist?.();
}
