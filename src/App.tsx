import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  COUNTERS, HABITS, addDays, daysBetween, doneCount, money, pkr, streak, weekTotal, xp, ymd,
  type Count, type Day, type Item, type Settings,
} from './logic.ts';

type Weather = { city: string; temp: number; code: number; rain: number; hi: number; lo: number };
type Data = { photos: Item[]; days: Record<string, Day>; settings: Settings };
type Act = (fn: () => Promise<unknown>, msg?: string) => Promise<boolean>;
type P = { d: Data; today: string; act: Act };

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const LINES = [
  'Small steps, every single day.', 'One good DM can change the whole month.', 'Water the plants. Water yourself too.',
  'You built a whole SaaS alone. You can do hard things.', 'Rough season, not a rough life.',
  'Show up today — future you is watching.', 'Progress over perfection.', 'Consistency is the cheat code.',
];

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

export default function App() {
  const [d, setD] = useState<Data | null>(null);
  const [wx, setWx] = useState<Weather | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const today = ymd();

  const load = useCallback(async () => {
    const [photos, days, settings] = await Promise.all([api('/photos'), api('/days'), api('/settings')]);
    setD({ photos, days, settings });
  }, []);
  const flash = (text: string, bad = false) => { setToast({ text, bad }); setTimeout(() => setToast(null), 3000); };
  // every mutation: call API → reload → toast; errors surface instead of failing silently
  const act: Act = (fn, msg) => fn().then(load).then(
    () => { if (msg) flash(msg); return true; },
    (e: Error) => { flash(e.message, true); return false; });
  const loadWeather = () => api<Weather>('/weather').then(setWx, () => setWx(null));
  useEffect(() => { load().catch((e: Error) => flash(e.message, true)); loadWeather(); }, [load]);

  if (!d) return <div className="loading">🪐 Loading…</div>;
  const p: P = { d, today, act };
  const lv = xp(d.days, d.photos.length);
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return <>
    <header className="top">
      <div>
        <p className="mute">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{greet}, {d.settings.name} 👋</h1>
        <p className="line">“{LINES[Math.abs(daysBetween('2026-01-01', today)) % LINES.length]}”</p>
      </div>
      <div className="top-right">
        {wx && <div className="chip" title={`${wx.lo}° – ${wx.hi}° today`}>{weatherIcon(wx.code)} {wx.temp}° · {wx.rain}% rain · {wx.city}</div>}
        <div className="level" title={`${lv.total} XP · ${lv.toNext} XP to next level`}>
          <div className="level-row"><b>Lv {lv.level}</b><span>{lv.title}</span></div>
          <div className="bar"><i style={{ width: `${lv.pct * 100}%` }} /></div>
        </div>
        <button className="icon-btn" onClick={() => setShowSettings(s => !s)} aria-label="Settings">⚙️</button>
      </div>
    </header>
    {showSettings && <SettingsPanel s={d.settings} act={act} onSaved={() => { setShowSettings(false); loadWeather(); }} />}
    <main className="grid">
      <Today {...p} />
      <Velo {...p} />
      <Money {...p} />
      <Hunt {...p} />
      <Consistency {...p} />
      <Garden {...p} />
      <Notes {...p} />
    </main>
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

function Ring({ value, label }: { value: number; label: string }) {
  const r = 40, c = 2 * Math.PI * r;
  return <svg viewBox="0 0 100 100" className="ring" role="img" aria-label={`${label} habits done`}>
    <circle cx="50" cy="50" r={r} className="ring-bg" />
    <circle cx="50" cy="50" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 50 50)" />
    <text x="50" y="57" textAnchor="middle">{label}</text>
  </svg>;
}

// shared by every counter: patch one field of today's row
const bump = ({ d, today, act }: P, k: Count, by: number, msg?: string) =>
  act(() => api(`/days/${today}`, 'PATCH', { [k]: Math.max(0, (d.days[today]?.[k] ?? 0) + by) }), msg);

function Today({ d, today, act }: P) {
  const day = d.days[today], done = doneCount(day);
  const set = (patch: Day, msg?: string) => act(() => api(`/days/${today}`, 'PATCH', patch), msg);
  return <Card title="Today" className="span-5" extra={<span className="pill">{streak(d.days, today)} day streak 🔥</span>}>
    <div className="today-top">
      <Ring value={done / HABITS.length} label={`${done}/${HABITS.length}`} />
      <div>
        <p className="mute">How are you feeling?</p>
        <div className="moods">{MOODS.map((m, i) =>
          <button key={m} className={day?.mood === i + 1 ? 'on' : ''} onClick={() => set({ mood: i + 1 })} aria-label={`Mood ${i + 1} of 5`}>{m}</button>)}
        </div>
        {done === HABITS.length && <p className="ok">Perfect day. Proud of you ✨</p>}
      </div>
    </div>
    <ul className="habits">{HABITS.map(([id, icon, label]) =>
      <li key={id} className={day?.habits?.[id] ? 'done' : ''}><label>
        <input type="checkbox" checked={!!day?.habits?.[id]}
          onChange={e => set({ habits: { [id]: e.target.checked } }, e.target.checked && done + 1 === HABITS.length ? '🎉 Perfect day! +60 XP' : undefined)} />
        <span className="hicon">{icon}</span>{label}
      </label></li>)}
    </ul>
  </Card>;
}

function Velo(p: P) {
  const { d, today } = p, n = d.days[today]?.velo ?? 0, limit = d.settings.veloLimit;
  const week = Array.from({ length: 7 }, (_, i) => { const k = addDays(today, i - 6); return [k, d.days[k]?.velo ?? 0] as const; });
  const max = Math.max(limit, 1, ...week.map(([, v]) => v));
  return <Card title="Velo" className="span-3">
    <Stepper big n={n} bad={n > limit} onStep={s => bump(p, 'velo', s)} />
    <p className="mute center">{n > limit ? `${n - limit} over your limit of ${limit}` : `${limit - n} left of ${limit} today`}</p>
    <div className="bars">{week.map(([k, v]) =>
      <div key={k} title={`${k}: ${v}`}>
        <span className="track"><i className={v > limit ? 'over' : ''} style={{ height: `${(v / max) * 100}%` }} /></span>
        <small>{'SMTWTFS'[new Date(k + 'T12:00').getDay()]}</small>
      </div>)}
    </div>
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
  return <Card title="Money" className="span-4">
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

function Hunt(p: P) {
  const { d, today } = p;
  return <Card title="Job hunt" className="span-5">
    {COUNTERS.map(([k, icon, label]) => {
      const n = d.days[today]?.[k] ?? 0;
      return <div key={k} className="crow">
        <span className="hicon">{icon}</span>
        <span className="clabel">{label}<small className="mute">{weekTotal(d.days, k, today)} this week</small></span>
        <Stepper n={n} onStep={s => bump(p, k, s, k === 'replies' && s > 0 ? '💬 A reply! Answer it fast.' : undefined)} />
      </div>;
    })}
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

function Garden({ d, today, act }: P) {
  const [name, setName] = useState('');
  const pick = useRef<HTMLInputElement>(null);
  const upload = (f: File) => act(() => api(`/photos?name=${encodeURIComponent(name)}&date=${today}`, 'POST', f), '📸 Saved')
    .then(ok => ok && setName(''));
  return <Card title="Garden 🌱" className="span-7" extra={<span className="mute">{d.photos.length} photos</span>}>
    <div className="snap">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (optional)" aria-label="Photo name" />
      <button className="primary" onClick={() => pick.current!.click()}>📸 Add photo</button>
      <input ref={pick} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
    </div>
    <div className="photos">
      {d.photos.map(ph => <figure key={ph.id}>
        <a href={`/photos/${ph.file}`} target="_blank" rel="noreferrer"><img src={`/photos/${ph.file}`} alt={ph.name || 'Garden photo'} loading="lazy" /></a>
        <figcaption>
          <span>{ph.name}</span><small className="mute">{ph.date.slice(5)}</small>
          <button className="del" aria-label="Delete photo" onClick={() => confirm('Delete this photo?') && act(() => api(`/photos/${ph.id}`, 'DELETE'))}>×</button>
        </figcaption>
      </figure>)}
      {!d.photos.length && <p className="empty">Snap your plants — watch them grow over time 🌿</p>}
    </div>
  </Card>;
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
