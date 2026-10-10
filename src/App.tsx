import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  COUNTERS, DAMAGE, HABITS, addDays, boss, bossesBeaten, daysBetween, doneCount, money, pkr, questFor, streak, weekTotal, world, wrapped, xp, ymd,
  type Count, type Day, type Item, type Settings,
} from './logic.ts';

type Weather = { city: string; temp: number; code: number; rain: number; hi: number; lo: number };
type Data = { photos: Item[]; capsules: Item[]; days: Record<string, Day>; settings: Settings };
type Act = (fn: () => Promise<unknown>, msg?: string) => Promise<boolean>;
type P = { d: Data; today: string; act: Act; party: () => void };

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const MOOD_GLOW = ['#64748b', '#60a5fa', '#818cf8', '#a78bfa', '#34d399', '#fbbf24']; // index = mood (0 = not set)
const LINES = [
  'Small steps, every single day.', 'One good DM can change the whole month.', 'Water the plants. Water yourself too.',
  'You built a whole SaaS alone. You can do hard things.', 'Rough season, not a rough life.',
  'Show up today — future you is watching.', 'Progress over perfection.', 'Consistency is the cheat code.',
];
const KEYS = [['1 – 6', 'tick a habit'], ['V', '+1 Velo  (Shift+V = −1)'], ['D / A / R', '+1 DM / application / reply'],
  ['Q', 'side quest done'], ['W', 'your week recap'], ['M', 'sound on / off'], ['?', 'show / hide this']];
const isRain = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

// ── sound: tiny synth blips, no audio files ──
const TUNES = { tap: [880], hit: [196, 147], win: [523, 659, 784, 1047], level: [392, 523, 659, 784, 1047, 1319] };
let audio: AudioContext | undefined;
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sound pref just won't stick */ } } };
function sfx(kind: keyof typeof TUNES) {
  if (store.get('orbit-muted') === '1') return;
  audio ??= new AudioContext();
  TUNES[kind].forEach((f, i) => {
    const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * 0.085;
    o.type = kind === 'hit' ? 'square' : 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === 'hit' ? 0.06 : 0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(audio!.destination);
    o.start(t); o.stop(t + 0.22);
  });
}

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const raw = body instanceof Blob;
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': raw ? body.type : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

const weatherIcon = (c: number) => c === 0 ? '☀️' : c <= 3 ? '⛅' : c <= 48 ? '🌫️' : c <= 67 ? '🌦️' : c <= 77 ? '❄️' : c <= 82 ? '🌧️' : '⛈️';

// every counter goes through here, so clicks and keyboard both get sound, damage numbers and the boss-kill party
function bump(p: P, k: Count, by: number, msg?: string) {
  const { d, today, act } = p;
  if (k in DAMAGE && by > 0) {
    const hit = by * DAMAGE[k as keyof typeof DAMAGE], b = boss(d.days, today);
    dispatchEvent(new CustomEvent('orbit:hit', { detail: hit }));
    if (!b.dead && b.dmg + hit >= b.hp) { p.party(); sfx('win'); msg = `💀 ${b.name} defeated! +100 XP`; } else sfx('hit');
  } else sfx('tap');
  return act(() => api(`/days/${today}/bump`, 'POST', { key: k, by }), msg);
}

function toggleHabit(p: P, id: string) {
  const day = p.d.days[p.today], on = !day?.habits?.[id];
  const perfect = on && doneCount(day) + 1 === HABITS.length;
  if (perfect) { p.party(); sfx('win'); } else sfx('tap');
  return p.act(() => api(`/days/${p.today}`, 'PATCH', { habits: { [id]: on } }), perfect ? '🎉 Perfect day! +60 XP' : undefined);
}

function toggleQuest(p: P) {
  const on = !p.d.days[p.today]?.quest;
  sfx(on ? 'win' : 'tap');
  return p.act(() => api(`/days/${p.today}`, 'PATCH', { quest: on }), on ? '🎲 Side quest complete! +20 XP' : undefined);
}

export default function App() {
  const [d, setD] = useState<Data | null>(null);
  const [wx, setWx] = useState<Weather | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [recap, setRecap] = useState(false);
  const [muted, setMuted] = useState(store.get('orbit-muted') === '1');
  const [confetti, setConfetti] = useState(0);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string } | null>(null);
  const prevLevel = useRef(0);
  const today = ymd();

  const load = useCallback(async () => {
    const [photos, capsules, days, settings] = await Promise.all([api('/photos'), api('/capsules'), api('/days'), api('/settings')]);
    setD({ photos, capsules, days, settings });
  }, []);
  const flash = (text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 3000); };
  // every mutation: call API → reload → toast; errors surface instead of failing silently
  const act: Act = (fn, msg) => fn().then(load).then(
    () => { if (msg) flash(msg); return true; },
    (e: Error) => { flash(e.message, true); return false; });
  const party = () => { const t = Date.now(); setConfetti(t); setTimeout(() => setConfetti(c => (c === t ? 0 : c)), 2500); };
  const toggleMute = () => setMuted(m => { store.set('orbit-muted', m ? '0' : '1'); return !m; });
  const loadWeather = () => api<Weather>('/weather').then(setWx, () => setWx(null));
  useEffect(() => { load().catch((e: Error) => flash(e.message, true)); loadWeather(); }, [load]);

  // level-up fanfare when XP crosses a threshold (not on first load)
  useEffect(() => {
    if (!d) return;
    const lv = xp(d.days, d.photos.length);
    if (prevLevel.current && lv.level > prevLevel.current) {
      setLevelUp({ level: lv.level, title: lv.title }); party(); sfx('level');
      setTimeout(() => setLevelUp(null), 3800);
    }
    prevLevel.current = lv.level;
  }, [d]);

  // living sky: background follows the real clock and the real weather
  useEffect(() => {
    const paint = () => {
      const h = new Date().getHours();
      document.body.dataset.sky = h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
    };
    paint();
    const t = setInterval(paint, 5 * 60e3);
    return () => clearInterval(t);
  }, []);

  // lazy mode: log without touching the mouse
  useEffect(() => {
    if (!d) return;
    const p: P = { d, today, act, party };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof Element && e.target.closest('input, textarea, select'))) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '6') toggleHabit(p, HABITS[+k - 1][0]);
      else if (k === 'v') bump(p, 'velo', e.shiftKey ? -1 : 1);
      else if (k === 'd') bump(p, 'dms', 1);
      else if (k === 'a') bump(p, 'apps', 1);
      else if (k === 'r') bump(p, 'replies', 1, '💬 A reply! Answer it fast.');
      else if (k === 'q') toggleQuest(p);
      else if (k === 'w') setRecap(r => !r);
      else if (k === 'm') toggleMute();
      else if (k === '?') setHelp(h => !h);
      else if (k === 'escape') { setHelp(false); setRecap(false); }
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [d]);

  if (!d) return <div className="loading">🪐 Loading…</div>;
  const p: P = { d, today, act, party };
  const lv = xp(d.days, d.photos.length);
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const line = hour >= 1 && hour < 5 ? 'It\'s late — sleep is the best thing you can do for tomorrow 🌙'
    : LINES[Math.abs(daysBetween('2026-01-01', today)) % LINES.length];
  const sunday = new Date().getDay() === 0;

  return <>
    {wx && isRain(wx.code) && <Rain />}
    <header className="top">
      <div>
        <p className="mute">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{greet}, {d.settings.name} 👋</h1>
        <p className="line">“{line}”</p>
      </div>
      <div className="top-right">
        <button className={`recap-btn ${sunday ? 'pulse' : ''}`} onClick={() => setRecap(true)}>🎬 Your week</button>
        {wx && <div className="chip" title={`${wx.lo}° – ${wx.hi}° today`}>{weatherIcon(wx.code)} {wx.temp}° · {wx.rain}% rain · {wx.city}</div>}
        <div className="level" title={`${lv.total} XP · ${lv.toNext} XP to next level`}>
          <div className="level-row"><b>Lv {lv.level}</b><span>{lv.title}</span></div>
          <div className="bar"><i style={{ width: `${lv.pct * 100}%` }} /></div>
        </div>
        <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Turn sound on' : 'Mute sound'}>{muted ? '🔇' : '🔊'}</button>
        <button className="icon-btn" onClick={() => setShowSettings(s => !s)} aria-label="Settings">⚙️</button>
      </div>
    </header>
    {showSettings && <SettingsPanel s={d.settings} act={act} onSaved={() => { setShowSettings(false); loadWeather(); }} />}
    <main className="grid">
      <Today {...p} />
      <World {...p} level={lv.level} />
      <Velo {...p} />
      <Hunt {...p} />
      <Money {...p} />
      <Consistency {...p} />
      <Capsule {...p} />
      <Garden {...p} />
      <Notes {...p} />
    </main>
    <footer className="hint mute"><button className="link" onClick={() => setHelp(true)}>⌨️ Lazy mode — press <kbd>?</kbd> for keyboard shortcuts</button></footer>
    {help && <div className="overlay" onClick={() => setHelp(false)} role="dialog" aria-label="Keyboard shortcuts">
      <div className="card keys" onClick={e => e.stopPropagation()}>
        <h2>⌨️ Keyboard shortcuts</h2>
        {KEYS.map(([k, what]) => <p key={k}><kbd>{k}</kbd><span>{what}</span></p>)}
        <p className="mute">{HABITS.map(([, icon], i) => `${i + 1} ${icon}`).join('   ')}</p>
      </div>
    </div>}
    {recap && <Recap d={d} today={today} level={lv.level} onClose={() => setRecap(false)} />}
    {levelUp && <div className="overlay levelup" onClick={() => setLevelUp(null)} role="dialog" aria-label="Level up">
      <div><p>LEVEL UP</p><b>Lv {levelUp.level}</b><span>{levelUp.title}</span></div>
    </div>}
    {confetti > 0 && <Confetti key={confetti} />}
    {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
  </>;
}

const Card = ({ title, extra, className = '', children }: { title: string; extra?: ReactNode; className?: string; children: ReactNode }) =>
  <section className={`card ${className}`}><div className="card-head"><h2>{title}</h2>{extra}</div>{children}</section>;

const Stepper = ({ n, onStep, big, bad }: { n: number; onStep: (s: number) => void; big?: boolean; bad?: boolean }) =>
  <div className={`stepper ${big ? 'big' : ''}`}>
    <button onClick={() => onStep(-1)} aria-label="One less" disabled={n <= 0}>−</button>
    <b className={bad ? 'bad' : ''}>{n}</b>
    <button onClick={() => onStep(1)} aria-label="One more">+</button>
  </div>;

function Confetti() {
  const colors = ['#8b5cf6', '#22d3ee', '#34d399', '#fbbf24', '#f87171'];
  return <div className="confetti" aria-hidden="true">{Array.from({ length: 48 }, (_, i) =>
    <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % 5], animationDelay: `${(i % 12) * 0.06}s`, '--x': `${((i * 53) % 80) - 40}px` } as CSSProperties} />)}
  </div>;
}

const Rain = () => <div className="rain" aria-hidden="true">{Array.from({ length: 70 }, (_, i) =>
  <i key={i} style={{ left: `${(i * 41) % 100}%`, animationDelay: `${((i * 7) % 20) / 10}s`, animationDuration: `${0.6 + (i % 5) * 0.12}s` }} />)}
</div>;

function Ring({ value, label }: { value: number; label: string }) {
  const r = 40, c = 2 * Math.PI * r;
  return <svg viewBox="0 0 100 100" className="ring" role="img" aria-label={`${label} habits done`}>
    <circle cx="50" cy="50" r={r} className="ring-bg" />
    <circle cx="50" cy="50" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 50 50)" />
    <text x="50" y="57" textAnchor="middle">{label}</text>
  </svg>;
}

function Today(p: P) {
  const { d, today, act } = p, day = d.days[today], done = doneCount(day);
  return <Card title="Today" className="span-5" extra={<span className="pill">{streak(d.days, today)} day streak 🔥</span>}>
    <div className="today-top">
      <Ring value={done / HABITS.length} label={`${done}/${HABITS.length}`} />
      <div>
        <p className="mute">How are you feeling?</p>
        <div className="moods">{MOODS.map((m, i) =>
          <button key={m} className={day?.mood === i + 1 ? 'on' : ''} onClick={() => { sfx('tap'); act(() => api(`/days/${today}`, 'PATCH', { mood: i + 1 })); }} aria-label={`Mood ${i + 1} of 5`}>{m}</button>)}
        </div>
        {done === HABITS.length && <p className="ok">Perfect day. Proud of you ✨</p>}
      </div>
    </div>
    <ul className="habits">{HABITS.map(([id, icon, label], i) =>
      <li key={id} className={day?.habits?.[id] ? 'done' : ''}><label>
        <input type="checkbox" checked={!!day?.habits?.[id]} onChange={() => toggleHabit(p, id)} />
        <span className="hicon">{icon}</span><span className="hlabel">{label}</span><kbd>{i + 1}</kbd>
      </label></li>)}
    </ul>
    <div className={`quest ${day?.quest ? 'done' : ''}`}>
      <span className="quest-die" aria-hidden="true">🎲</span>
      <div><small className="mute">Today's side quest · +20 XP</small><b>{questFor(today)}</b></div>
      <button onClick={() => toggleQuest(p)} aria-pressed={!!day?.quest}>{day?.quest ? '✓ Done' : 'Done'}</button>
    </div>
  </Card>;
}

/** A planet that mirrors your week: habits green it, streak days become moons, photos grow trees,
 *  Velo overuse adds smog, and city lights spread across the night side as you level up. */
function World({ d, today, level }: P & { level: number }) {
  const w = world(d.days, today, d.photos.length, d.settings.veloLimit), won = boss(d.days, today).dead;
  const hue = 25 + w.health * 115; // dusty brown → lush green
  const status = w.health > 0.75 ? 'Thriving 🌍' : w.health > 0.45 ? 'Growing 🌱' : w.health > 0.15 ? 'Dusty 🏜️' : 'Barren — tick some boxes 🪨';
  const lights = Array.from({ length: 60 }, (_, i) => {
    const a = i * 2.39996, r = 54 * Math.sqrt((i + 0.5) / 60); // golden-angle spread across the disc
    return [150 + r * Math.cos(a), 125 + r * Math.sin(a)] as const;
  }).filter(([x]) => x > 162).slice(0, Math.min((level - 1) * 4, 24));
  const tree = (i: number) => {
    const a = (w.trees === 1 ? 270 : 205 + (130 / (w.trees - 1)) * i) * Math.PI / 180;
    return <g key={i} transform={`translate(${150 + 60 * Math.cos(a)} ${125 + 60 * Math.sin(a)}) rotate(${a * 180 / Math.PI + 90})`}>
      <rect x="-1" y="-4" width="2" height="5" fill="#7c5a3a" /><path d="M0 -15 L5.5 -3 L-5.5 -3 Z" fill={`hsl(${120 + (i % 3) * 12} 55% ${38 + (i % 2) * 8}%)`} />
    </g>;
  };
  return <Card title="Your world" className="span-4" extra={<span className="pill">{status}</span>}>
    <svg viewBox="0 0 300 250" className="world" role="img" aria-label={`Your planet: ${status}, ${w.moons} moons, ${w.trees} trees`}>
      <defs>
        <radialGradient id="planet" cx="35%" cy="30%">
          <stop offset="0" stopColor={`hsl(${hue} 55% 62%)`} /><stop offset="1" stopColor={`hsl(${hue} 50% 20%)`} />
        </radialGradient>
        <radialGradient id="atmo">
          <stop offset=".62" stopColor={MOOD_GLOW[w.mood]} stopOpacity="0" /><stop offset=".8" stopColor={MOOD_GLOW[w.mood]} stopOpacity=".4" /><stop offset="1" stopColor={MOOD_GLOW[w.mood]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="night" x1="0" x2="1"><stop offset=".45" stopColor="#020617" stopOpacity="0" /><stop offset="1" stopColor="#020617" stopOpacity=".75" /></linearGradient>
      </defs>
      {Array.from({ length: 46 }, (_, i) =>
        <circle key={i} className="star" cx={(i * 73 + 11) % 300} cy={(i * 151 + 7) % 250} r={0.5 + (i % 3) * 0.4} style={{ animationDelay: `${(i % 7) * 0.5}s` }} />)}
      <circle cx="150" cy="125" r="100" fill="url(#atmo)" />
      {won && <ellipse cx="150" cy="125" rx="98" ry="20" className="victory-ring" transform="rotate(-18 150 125)" />}
      <circle cx="150" cy="125" r="60" fill="url(#planet)" />
      {w.health > 0.3 && <g fill={`hsl(${hue + 15} 45% 45%)`} opacity={w.health}>
        <ellipse cx="128" cy="112" rx="18" ry="11" /><ellipse cx="168" cy="140" rx="14" ry="9" /><ellipse cx="150" cy="160" rx="10" ry="5" />
      </g>}
      <circle cx="150" cy="125" r="60" fill="url(#night)" />
      {lights.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.3" className="city" style={{ animationDelay: `${(i % 5) * 0.7}s` }} />)}
      {Array.from({ length: w.trees }, (_, i) => tree(i))}
      {Array.from({ length: w.moons }, (_, i) =>
        <g key={i} className="orbit" style={{ animationDuration: `${9 + i * 4}s`, animationDelay: `${-i * 2.3}s` }}>
          <circle cx={150 + 76 + i * 7} cy="125" r={4.5 - i * 0.3} className="moon" />
        </g>)}
      {w.smog && <g className="smog">{[[118, 72, 14], [140, 64, 18], [165, 70, 15], [185, 80, 11]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} />)}</g>}
    </svg>
    <p className="mute legend-line">
      🌙 {w.moons} = streak · 🌳 {w.trees} = photos{lights.length ? ` · 🏙️ ${lights.length} lights = level` : ''}{w.smog ? ' · 💨 smog = over Velo limit' : ''}{won ? ' · 💍 = boss beaten' : ''}
    </p>
  </Card>;
}

function Velo(p: P) {
  const { d, today } = p, n = d.days[today]?.velo ?? 0, limit = d.settings.veloLimit;
  const [sos, setSos] = useState(false);
  const week = Array.from({ length: 7 }, (_, i) => { const k = addDays(today, i - 6); return [k, d.days[k]?.velo ?? 0] as const; });
  const max = Math.max(limit, 1, ...week.map(([, v]) => v));
  const beaten = weekTotal(d.days, 'cravings', today);
  return <Card title="Velo" className="span-3" extra={<kbd>V</kbd>}>
    <Stepper big n={n} bad={n > limit} onStep={s => bump(p, 'velo', s)} />
    <p className="mute center">{n > limit ? `${n - limit} over — your planet's getting smoggy` : `${limit - n} left of ${limit} today`}</p>
    <button className="sos-btn" onClick={() => setSos(true)}>🆘 Craving? Ride it out</button>
    {beaten > 0 && <p className="ok center small">💪 {beaten} craving{beaten > 1 ? 's' : ''} beaten this week</p>}
    <div className="bars">{week.map(([k, v]) =>
      <div key={k} title={`${k}: ${v}`}>
        <span className="track"><i className={v > limit ? 'over' : ''} style={{ height: `${(v / max) * 100}%` }} /></span>
        <small>{'SMTWTFS'[new Date(k + 'T12:00').getDay()]}</small>
      </div>)}
    </div>
    {sos && <CravingSOS onClose={() => setSos(false)} onWin={() => { setSos(false); p.party(); sfx('win'); bump(p, 'cravings', 1, '💪 Craving beaten! +15 XP'); }} />}
  </Card>;
}

/** 3 minutes of guided breathing — long enough for most cravings to peak and fade. */
function CravingSOS({ onClose, onWin }: { onClose: () => void; onWin: () => void }) {
  const TOTAL = 180;
  const [left, setLeft] = useState(TOTAL);
  useEffect(() => { const t = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000); return () => clearInterval(t); }, []);
  const breathingIn = Math.floor((TOTAL - left) / 4) % 2 === 0; // matches the orb's 8s in/out cycle
  return <div className="overlay" role="dialog" aria-label="Craving timer">
    <div className="sos">
      <div className="orb" aria-hidden="true" />
      <p className="phase">{left ? (breathingIn ? 'Breathe in…' : 'Breathe out…') : 'You did it.'}</p>
      <p className="timer">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>
      <p className="mute">Cravings come in waves and most fade within a few minutes. Follow the circle and let this one pass.</p>
      <div className="sos-actions">
        <button className="primary" disabled={left > 0} onClick={onWin}>{left ? 'Hang in there…' : 'I beat it 💪'}</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}

function Hunt(p: P) {
  const { d, today } = p, b = boss(d.days, today);
  const [hits, setHits] = useState<{ id: number; n: number }[]>([]);
  useEffect(() => {
    const onHit = (e: Event) => {
      const id = Math.random(), n = (e as CustomEvent<number>).detail;
      setHits(h => [...h, { id, n }]);
      setTimeout(() => setHits(h => h.filter(x => x.id !== id)), 900);
    };
    addEventListener('orbit:hit', onHit);
    return () => removeEventListener('orbit:hit', onHit);
  }, []);
  return <Card title="Job hunt · boss fight" className="span-7" extra={<span className="pill">🏆 {bossesBeaten(d.days)} beaten</span>}>
    <div className={`boss ${b.dead ? 'dead' : ''}`}>
      <div className="boss-emoji" key={hits.at(-1)?.id} aria-hidden="true">{b.dead ? '💀' : b.emoji}</div>
      {hits.map(h => <span key={h.id} className="dmg" aria-hidden="true">−{h.n}</span>)}
      <div className="boss-info">
        <b>{b.name}</b>
        <small className="mute">{b.dead ? 'Defeated this week. Legend. +100 XP' : `${b.left}/${b.hp} HP · ${b.daysLeft === 0 ? 'last day!' : `${b.daysLeft} days left`}`}</small>
        <div className="bar hp"><i style={{ width: `${(b.left / b.hp) * 100}%` }} /></div>
        <small className="mute">✉️ DM = {DAMAGE.dms} dmg · 📄 application = {DAMAGE.apps} · 💬 reply = {DAMAGE.replies}</small>
      </div>
    </div>
    {COUNTERS.map(([k, icon, label]) => {
      const n = d.days[today]?.[k] ?? 0;
      return <div key={k} className="crow">
        <span className="hicon">{icon}</span>
        <span className="clabel">{label}<small className="mute">{weekTotal(d.days, k, today)} this week</small></span>
        <kbd>{{ dms: 'D', apps: 'A', replies: 'R' }[k]}</kbd>
        <Stepper n={n} onStep={s => bump(p, k, s, k === 'replies' && s > 0 ? '💬 A reply! Answer it fast.' : undefined)} />
      </div>;
    })}
  </Card>;
}

function Money(p: P) {
  const { d, today } = p, m = money(d.days, d.settings.startCash, today), day = d.days[today];
  const tone = m.runway < 30 ? 'bad' : m.runway < 90 ? 'warn' : 'ok';
  const other = (k: 'spent' | 'earned') => {
    const v = Number(prompt(`${k === 'spent' ? 'Spent' : 'Earned'} how much? (use a minus to fix a mistake, e.g. -500)`));
    if (v) bump(p, k, v);
  };
  const chips = (k: 'spent' | 'earned', amounts: number[]) => <div className="chips">
    <span className="mute">{k === 'spent' ? 'Spent' : 'Earned'}</span>
    {amounts.map(a => <button key={a} onClick={() => bump(p, k, a, k === 'earned' ? '💰 Money in!' : undefined)}>+{a.toLocaleString()}</button>)}
    <button onClick={() => other(k)} aria-label={`Other ${k} amount`}>…</button>
  </div>;
  return <Card title="Money" className="span-5">
    <div className="big">{pkr(m.cash)}</div>
    <p className="mute">cash on hand{!d.settings.startCash && ' — set your starting cash in ⚙️'}</p>
    <div className="stats">
      <div><b className={tone}>{m.runway === Infinity ? '∞' : m.runway}</b><small>days runway</small></div>
      <div><b>{pkr(day?.spent ?? 0)}</b><small>spent today</small></div>
      <div><b className="ok">{pkr(m.earned)}</b><small>earned this month</small></div>
    </div>
    {chips('spent', [100, 500, 1000])}
    {chips('earned', [1000, 5000])}
  </Card>;
}

function Consistency({ d, today }: P) {
  const monday = addDays(today, -((new Date(today + 'T12:00').getDay() + 6) % 7));
  const cells: string[] = [];
  for (let k = addDays(monday, -7 * 25); k <= today; k = addDays(k, 1)) cells.push(k); // 26 weeks, Mon-first rows
  const perfect = Object.values(d.days).filter(x => doneCount(x) === HABITS.length).length;
  const v = (n: number) => ({ '--v': n }) as CSSProperties;
  return <Card title="Consistency" className="span-7" extra={<span className="mute">{perfect} perfect days</span>}>
    <div className="heat">{cells.map(k => {
      const n = doneCount(d.days[k]) / HABITS.length;
      return <i key={k} title={`${k} · ${Math.round(n * 100)}%`} style={v(n)} className={k === today ? 'today' : ''} />;
    })}</div>
    <div className="legend mute"><span>less</span>{[0, 0.33, 0.66, 1].map(n => <i key={n} style={v(n)} />)}<span>more</span></div>
  </Card>;
}

function Capsule({ d, today, act }: P) {
  const [text, setText] = useState('');
  const [days, setDays] = useState(30);
  const [reading, setReading] = useState<number | null>(null);
  const seal = () => act(() => api('/capsules', 'POST', { text, days }), '🔒 Sealed. See you in the future.').then(ok => ok && setText(''));
  return <Card title="Time capsule 💌" className="span-5" extra={<span className="mute">a letter to future you</span>}>
    <textarea className="letter-input" value={text} onChange={e => setText(e.target.value)}
      placeholder={`Dear future ${d.settings.name}… what do you hope has changed by the time you read this?`} />
    <div className="chips">
      <span className="mute">Opens in</span>
      {([[7, '1 week'], [30, '1 month'], [90, '3 months'], [365, '1 year']] as const).map(([n, l]) =>
        <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)} aria-pressed={days === n}>{l}</button>)}
      <button className="primary" disabled={!text.trim()} onClick={seal}>Seal 🔒</button>
    </div>
    <ul className="capsules">{d.capsules.map(c =>
      <li key={c.id}>
        {!c.open ? <span className="sealed">🔒 Sealed {c.created.slice(5)} · opens in {daysBetween(today, c.opens)} day{daysBetween(today, c.opens) === 1 ? '' : 's'}</span>
          : reading === c.id ? <div className="letter"><small className="mute">From you, {c.created}</small><p>{c.text}</p></div>
          : <button className="envelope" onClick={() => { setReading(c.id); sfx('win'); }}>💌 A letter from {c.created} is ready — open it</button>}
        <button className="del" aria-label="Delete letter" onClick={() => confirm('Delete this letter forever?') && act(() => api(`/capsules/${c.id}`, 'DELETE'))}>×</button>
      </li>)}
    </ul>
  </Card>;
}

function Garden({ d, today, act }: P) {
  const [name, setName] = useState('');
  const [film, setFilm] = useState<Item[] | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const upload = (f: File) => act(() => api(`/photos?name=${encodeURIComponent(name)}&date=${today}`, 'POST', f), '📸 Saved — your planet grew a tree 🌳')
    .then(ok => ok && setName(''));
  const oldestFirst = [...d.photos].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const byName: Record<string, Item[]> = {};
  for (const ph of oldestFirst) if (ph.name) (byName[ph.name] ??= []).push(ph);
  const reels = Object.entries(byName).filter(([, l]) => l.length > 1);
  return <Card title="Garden 🌱" className="span-7" extra={<span className="mute">{d.photos.length} photos</span>}>
    <div className="snap">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional) — same name = timelapse" aria-label="Photo name" />
      <button className="primary" onClick={() => pick.current!.click()}>📸 Add photo</button>
      <input ref={pick} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
    </div>
    {oldestFirst.length > 1 && <div className="reels">
      <button onClick={() => setFilm(oldestFirst)}>▶ Timelapse: everything</button>
      {reels.map(([n, l]) => <button key={n} onClick={() => setFilm(l)}>▶ {n} ({l.length})</button>)}
    </div>}
    <div className="photos">
      {d.photos.map(ph => <figure key={ph.id}>
        <a href={`/photos/${ph.file}`} target="_blank" rel="noreferrer"><img src={`/photos/${ph.file}`} alt={ph.name || 'Garden photo'} loading="lazy" /></a>
        <figcaption>
          <span>{ph.name}</span><small className="mute">{ph.date.slice(5)}</small>
          <button className="del" aria-label="Delete photo" onClick={() => confirm('Delete this photo?') && act(() => api(`/photos/${ph.id}`, 'DELETE'))}>×</button>
        </figcaption>
      </figure>)}
      {!d.photos.length && <p className="empty">Snap your plants — give them a name and you get a growth timelapse 🌿</p>}
    </div>
    {film && <Flipbook photos={film} onClose={() => setFilm(null)} />}
  </Card>;
}

/** Plays photos oldest → newest like a flipbook. */
function Flipbook({ photos, onClose }: { photos: Item[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % photos.length), 900);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => { clearInterval(t); removeEventListener('keydown', k); };
  }, [photos, onClose]);
  const ph = photos[i];
  return <div className="overlay" onClick={onClose} role="dialog" aria-label="Garden timelapse">
    <figure className="film">
      <img src={`/photos/${ph.file}`} alt={ph.name || 'Garden photo'} />
      <figcaption>{ph.name || 'Garden'} · {ph.date} <span className="mute">· {i + 1}/{photos.length} · click to close</span></figcaption>
      <div className="bar"><i style={{ width: `${((i + 1) / photos.length) * 100}%` }} /></div>
    </figure>
  </div>;
}

/** Stories-style weekly recap: tap right/left to move, auto-advances. */
function Recap({ d, today, level, onClose }: { d: Data; today: string; level: number; onClose: () => void }) {
  const w = wrapped(d.days, d.photos, today, d.settings.veloLimit), b = boss(d.days, today);
  const day = (k: string) => new Date(k + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' });
  const slides: [string, ReactNode][] = [
    ['s-intro', <><p className="kicker">Your week in Orbit</p><b className="huge">🪐</b><p>{w.from.slice(5)} → {today.slice(5)}</p><p className="mute">tap to continue</p></>],
    ['s-habits', <><p className="kicker">Habits</p><b className="huge">{w.ticks}</b><p>boxes ticked out of {7 * HABITS.length}</p>
      <p>{w.perfect ? `${w.perfect} perfect day${w.perfect > 1 ? 's' : ''} ✨` : 'No perfect days yet — next week is yours'}</p>
      {w.best && <p className="mute">Best day: {day(w.best)} ({w.bestTicks}/{HABITS.length})</p>}</>],
    ['s-hunt', <><p className="kicker">The hunt</p><b className="huge">{w.dms + w.apps}</b><p>DMs + applications sent</p>
      <p>{w.replies ? `💬 ${w.replies} repl${w.replies > 1 ? 'ies' : 'y'} came back` : 'Replies are coming. Keep firing.'}</p>
      <p className="mute">{b.dead ? `💀 You beat ${b.name}` : `${b.emoji} ${b.name} has ${b.left} HP left`}</p></>],
    ['s-velo', <><p className="kicker">Velo</p><b className="huge">{w.veloUnder}/7</b><p>days at or under your limit</p>
      <p>{(w.velo / 7).toFixed(1)} pouches a day on average</p>{w.cravings > 0 && <p className="mute">💪 {w.cravings} craving{w.cravings > 1 ? 's' : ''} ridden out</p>}</>],
    ['s-garden', <><p className="kicker">Garden</p>
      {w.photos.length ? <div className="collage">{w.photos.slice(0, 4).map(ph => <img key={ph.id} src={`/photos/${ph.file}`} alt={ph.name || 'Garden photo'} />)}</div>
        : <b className="huge">🌱</b>}
      <p>{w.photos.length ? `${w.photos.length} new photo${w.photos.length > 1 ? 's' : ''}` : 'No photos this week — your plants miss you'}</p></>],
    ['s-outro', <><p className="kicker">This week you earned</p><b className="huge">+{w.xp} XP</b><p>Level {level} · {w.quests} side quest{w.quests === 1 ? '' : 's'} done</p>
      <p className="mute">Rough season, not a rough life. See you next week.</p></>],
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setI(x => Math.min(x + 1, slides.length - 1)), 5000);
    return () => clearTimeout(t);
  }, [i, slides.length]);
  return <div className="overlay" role="dialog" aria-label="Your week recap" onClick={onClose}>
    <div className={`story ${slides[i][0]}`} onClick={e => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX - r.left < r.width / 3) setI(Math.max(0, i - 1));
      else if (i === slides.length - 1) onClose();
      else setI(i + 1);
    }}>
      <div className="story-bars">{slides.map(([k], j) => <span key={k}><i className={j < i ? 'full' : j === i ? 'run' : ''} /></span>)}</div>
      <div className="story-body" key={i}>{slides[i][1]}</div>
    </div>
  </div>;
}

function Notes({ d, act }: P) {
  const [text, setText] = useState(d.settings.notes);
  return <Card title="Notes & goals" className="span-5" extra={text !== d.settings.notes ? <span className="mute">saves when you click away</span> : undefined}>
    <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Goals, ideas, anything on your mind…"
      onBlur={() => text !== d.settings.notes && act(() => api('/settings', 'PATCH', { notes: text }))} />
  </Card>;
}

function SettingsPanel({ s, act, onSaved }: { s: Settings; act: Act; onSaved: () => void }) {
  return <form className="card settings" onSubmit={e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    act(() => api('/settings', 'PATCH', { ...v, startCash: +v.startCash, veloLimit: +v.veloLimit }), 'Settings saved').then(ok => ok && onSaved());
  }}>
    <label>Name<input name="name" defaultValue={s.name} required /></label>
    <label>City (for weather)<input name="city" defaultValue={s.city} required /></label>
    <label>Cash when you started (PKR)<input name="startCash" type="number" step="any" defaultValue={s.startCash} /></label>
    <label>Velo daily limit<input name="veloLimit" type="number" min="0" defaultValue={s.veloLimit} /></label>
    <button className="primary">Save</button>
  </form>;
}
