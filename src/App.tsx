import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  HABITS, STAGES, addDays, daysBetween, doneCount, money, needsFollowUp, pkr, streak, thirst, xp, ymd,
  type Day, type Item, type Settings,
} from './logic.ts';

type Weather = { city: string; temp: number; code: number; rain: number; hi: number; lo: number };
type Data = { jobs: Item[]; money: Item[]; body: Item[]; plants: Item[]; days: Record<string, Day>; settings: Settings };
type Act = (fn: () => Promise<unknown>, msg?: string) => Promise<boolean>;
type P = { d: Data; today: string; act: Act };
type Field = [name: string, type: string, placeholder?: string, options?: readonly string[]];

const KINDS = ['jobs', 'money', 'body', 'plants'] as const;
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const WHERE = ['X', 'LinkedIn', 'Fiverr', 'Reddit', 'Product Hunt', 'Job board', 'Other'];
const PLANT_EMOJI = ['🌿', '🌱', '🪴', '🌵', '🌹', '🌻', '🌼', '🍅', '🌶️', '🍋', '🌳'];
const LINES = [
  'Small steps, every single day.', 'One good DM can change the whole month.', 'Water the plants. Water yourself too.',
  'You built a whole SaaS alone. You can do hard things.', 'Rough season, not a rough life.',
  'Show up today — future you is watching.', 'Progress over perfection.', 'Consistency is the cheat code.',
];

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
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
    const [jobs, money, body, plants, days, settings] = await Promise.all([...KINDS.map(k => api(`/items/${k}`)), api('/days'), api('/settings')]);
    setD({ jobs, money, body, plants, days, settings });
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
  const lv = xp(d.days, d.jobs, d.plants, d.body);
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
      <Jobs {...p} />
      <Garden {...p} wx={wx} />
      <Body {...p} />
      <Consistency {...p} />
      <Notes {...p} />
    </main>
    {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role="status">{toast.text}</div>}
  </>;
}

const Card = ({ title, extra, className = '', children }: { title: string; extra?: ReactNode; className?: string; children: ReactNode }) =>
  <section className={`card ${className}`}><div className="card-head"><h2>{title}</h2>{extra}</div>{children}</section>;

const Del = ({ kind, id, act }: { kind: string; id: number; act: Act }) =>
  <button className="del" aria-label="Delete" title="Delete" onClick={() => confirm('Delete this?') && act(() => api(`/items/${kind}/${id}`, 'DELETE'))}>×</button>;

/** Uncontrolled add-form; placeholders containing "optional" aren't required. Resets only on success. */
function QuickForm({ fields, today, onAdd }: { fields: Field[]; today: string; onAdd: (v: Record<string, string>) => Promise<boolean> }) {
  return <form className="qf" onSubmit={e => {
    e.preventDefault();
    const f = e.currentTarget;
    onAdd(Object.fromEntries(new FormData(f)) as Record<string, string>).then(ok => ok && f.reset());
  }}>
    {fields.map(([name, type, ph, opts]) => type === 'select'
      ? <select key={name} name={name} aria-label={name}>{opts!.map(o => <option key={o}>{o}</option>)}</select>
      : <input key={name} name={name} type={type} placeholder={ph} aria-label={ph ?? name} defaultValue={type === 'date' ? today : undefined}
          required={!ph?.includes('optional')} {...(type === 'number' && { step: 'any', min: 0 })} />)}
    <button className="primary">Add</button>
  </form>;
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 40, c = 2 * Math.PI * r;
  return <svg viewBox="0 0 100 100" className="ring" role="img" aria-label={`${label} habits done`}>
    <circle cx="50" cy="50" r={r} className="ring-bg" />
    <circle cx="50" cy="50" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 50 50)" />
    <text x="50" y="57" textAnchor="middle">{label}</text>
  </svg>;
}

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

function Velo({ d, today, act }: P) {
  const n = d.days[today]?.velo ?? 0, limit = d.settings.veloLimit;
  const week = Array.from({ length: 7 }, (_, i) => { const k = addDays(today, i - 6); return [k, d.days[k]?.velo ?? 0] as const; });
  const max = Math.max(limit, 1, ...week.map(([, v]) => v));
  const set = (v: number) => act(() => api(`/days/${today}`, 'PATCH', { velo: Math.max(0, v) }));
  return <Card title="Velo" className="span-3">
    <div className="counter">
      <button onClick={() => set(n - 1)} aria-label="One less">−</button>
      <b className={n > limit ? 'bad' : ''}>{n}</b>
      <button onClick={() => set(n + 1)} aria-label="One more">+</button>
    </div>
    <p className="mute center">{n > limit ? `${n - limit} over your limit of ${limit}` : `${limit - n} left of ${limit} today`}</p>
    <div className="bars">{week.map(([k, v]) =>
      <div key={k} title={`${k}: ${v}`}>
        <span className="track"><i className={v > limit ? 'over' : ''} style={{ height: `${(v / max) * 100}%` }} /></span>
        <small>{'SMTWTFS'[new Date(k + 'T12:00').getDay()]}</small>
      </div>)}
    </div>
  </Card>;
}

function Money({ d, today, act }: P) {
  const m = money(d.money, d.settings.startCash, today);
  const tone = m.runway < 30 ? 'bad' : m.runway < 90 ? 'warn' : 'ok';
  return <Card title="Money" className="span-4">
    <div className="big">{pkr(m.cash)}</div>
    <p className="mute">cash on hand{!d.settings.startCash && !d.money.length && ' — set your starting cash in ⚙️'}</p>
    <div className="stats">
      <div><b className={tone}>{m.runway === Infinity ? '∞' : m.runway}</b><small>days runway</small></div>
      <div><b className="ok">+{pkr(m.income)}</b><small>in this month</small></div>
      <div><b className="bad">−{pkr(m.expense)}</b><small>out this month</small></div>
    </div>
    <QuickForm today={today}
      fields={[['type', 'select', undefined, ['Expense', 'Income']], ['amount', 'number', 'Amount'], ['note', 'text', 'What for (optional)'], ['date', 'date']]}
      onAdd={v => act(() => api('/items/money', 'POST', v), v.type === 'Income' ? '💰 Money in! Nice.' : undefined)} />
    <ul className="list">{d.money.slice(0, 5).map(e =>
      <li key={e.id}>
        <span className={e.type === 'Income' ? 'ok' : ''}>{e.type === 'Income' ? '+' : '−'}{pkr(+e.amount)}</span>
        <span className="mute">{e.note || e.type} · {e.date.slice(5)}</span>
        <Del kind="money" id={e.id} act={act} />
      </li>)}
    </ul>
  </Card>;
}

function Jobs({ d, today, act }: P) {
  const stage = (j: Item, s: string) => act(() => api(`/items/jobs/${j.id}`, 'PATCH', { stage: s }),
    s === 'Won' ? '🏆 Client won! +150 XP' : s === 'Call' ? '📞 Got a call — prep and crush it' : undefined);
  const week = d.jobs.filter(j => daysBetween(j.date, today) < 7).length;
  const passed = d.jobs.filter(j => j.stage === 'No').length;
  return <Card title="Job pipeline" className="span-12" extra={<span className="mute">{week} reached out this week · {passed} passed</span>}>
    <QuickForm today={today}
      fields={[['who', 'text', 'Name / company'], ['where', 'select', undefined, WHERE], ['kind', 'select', undefined, ['DM', 'Application', 'Gig']], ['note', 'text', 'Note (optional)'], ['date', 'date']]}
      onAdd={v => act(() => api('/items/jobs', 'POST', { ...v, stage: 'Sent' }))} />
    <div className="kanban">{STAGES.slice(0, 4).map((s, i) => {
      const list = d.jobs.filter(j => j.stage === s);
      return <div key={s} className={`col s-${s}`}>
        <h3>{s}<span>{list.length}</span></h3>
        {list.map(j => <div key={j.id} className="job">
          <div className="job-top"><b>{j.who}</b>{needsFollowUp(j, today) && <span className="pill warn">follow up</span>}</div>
          <small className="mute">{j.kind} · {j.where} · {j.date.slice(5)}</small>
          {j.note && <p>{j.note}</p>}
          <div className="job-actions">
            {i > 0 && <button onClick={() => stage(j, STAGES[i - 1])} aria-label="Move back">←</button>}
            {i < 3 && <button onClick={() => stage(j, STAGES[i + 1])} aria-label="Move forward">→</button>}
            <button onClick={() => stage(j, 'No')} title="They passed">pass</button>
            <Del kind="jobs" id={j.id} act={act} />
          </div>
        </div>)}
        {!list.length && <p className="empty">{['Send some DMs ✉️', 'Replies land here', 'Calls land here', 'Wins land here 🏆'][i]}</p>}
      </div>;
    })}</div>
  </Card>;
}

function Garden({ d, today, act, wx }: P & { wx: Weather | null }) {
  const rainy = (wx?.rain ?? 0) >= 60;
  const plants = [...d.plants].sort((a, b) => thirst(b, today) - thirst(a, today));
  const water = (p: Item) => act(() => api(`/items/plants/${p.id}`, 'PATCH', { lastWatered: today, waterCount: (+p.waterCount || 0) + 1 }), `💧 ${p.name} watered`);
  const thirsty = plants.filter(p => thirst(p, today) >= 1).length;
  return <Card title="Garden" className="span-7"
    extra={<span className="mute">{thirsty ? `${thirsty} thirsty` : 'all happy'}{rainy && ` · 🌧️ ${wx!.rain}% rain today`}</span>}>
    <div className="plants">
      {plants.map(p => {
        const t = thirst(p, today), skip = rainy && p.place === 'Outdoor', due = t >= 1 && !skip;
        return <div key={p.id} className={`plant ${due ? 'thirsty' : ''}`}>
          <div className="plant-emoji">{p.emoji}</div>
          <b>{p.name}</b>
          <small className="mute">{p.spot || p.place} · every {p.every}d</small>
          <div className="bar thirst" title="thirst"><i style={{ width: `${Math.min(1, t) * 100}%` }} /></div>
          <small className={due ? 'warn' : 'mute'}>{t >= 1 ? (skip ? 'rain will do it 🌧️' : 'needs water') : t >= 0.7 ? 'water soon' : 'happy'}</small>
          <div className="plant-actions"><button onClick={() => water(p)}>💧 Water</button><Del kind="plants" id={p.id} act={act} /></div>
        </div>;
      })}
      {!plants.length && <p className="empty">Add your first plant below 🌱</p>}
    </div>
    <QuickForm today={today}
      fields={[['emoji', 'select', undefined, PLANT_EMOJI], ['name', 'text', 'Plant name'], ['place', 'select', undefined, ['Outdoor', 'Indoor']],
        ['spot', 'text', 'Spot (optional)'], ['every', 'number', 'Water every N days'], ['lastWatered', 'date']]}
      onAdd={v => act(() => api('/items/plants', 'POST', v), `🌱 ${v.name} added`)} />
  </Card>;
}

function Spark({ values, goal }: { values: number[]; goal?: number }) {
  if (values.length < 2) return null;
  const all = goal ? [...values, goal] : values, lo = Math.min(...all), hi = Math.max(...all);
  const y = (v: number) => 56 - ((v - lo) / (hi - lo || 1)) * 52;
  return <svg className="spark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
    {goal && <line x1="0" x2="300" y1={y(goal)} y2={y(goal)} className="goal" />}
    <polyline points={values.map((v, i) => `${(i / (values.length - 1)) * 300},${y(v)}`).join(' ')} />
  </svg>;
}

function Body({ d, today, act }: P) {
  const pts = [...d.body].sort((a, b) => (a.date < b.date ? -1 : 1));
  const w = pts.map(p => +p.weight), last = pts.at(-1), goal = +d.settings.goalWeight;
  const change = w.length ? w[w.length - 1] - w[0] : 0;
  return <Card title="Body" className="span-5" extra={last && goal ? <span className="mute">{Math.abs(+last.weight - goal).toFixed(1)} kg to goal</span> : undefined}>
    {last
      ? <div className="stats">
          <div><b>{last.weight} kg</b><small>now</small></div>
          <div><b className={change <= 0 ? 'ok' : 'bad'}>{change > 0 ? '+' : ''}{change.toFixed(1)}</b><small>kg since start</small></div>
          <div><b>{last.waist ? `${last.waist} cm` : '—'}</b><small>waist</small></div>
        </div>
      : <p className="mute">Weigh in weekly — same time, after waking. Waist shrinking = abs loading.</p>}
    <Spark values={w} goal={goal || undefined} />
    <QuickForm today={today} fields={[['weight', 'number', 'Weight kg'], ['waist', 'number', 'Waist cm (optional)'], ['date', 'date']]}
      onAdd={v => act(() => api('/items/body', 'POST', v), '📏 Logged')} />
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
    act(() => api('/settings', 'PATCH', { ...v, startCash: +v.startCash, veloLimit: +v.veloLimit, goalWeight: +v.goalWeight }), 'Settings saved')
      .then(ok => ok && onSaved());
  }}>
    <label>Name<input name="name" defaultValue={s.name} required /></label>
    <label>City (for weather)<input name="city" defaultValue={s.city} required /></label>
    <label>Cash when you started (PKR)<input name="startCash" type="number" step="any" defaultValue={s.startCash} /></label>
    <label>Velo daily limit<input name="veloLimit" type="number" min="0" defaultValue={s.veloLimit} /></label>
    <label>Goal weight (kg)<input name="goalWeight" type="number" step="any" min="0" defaultValue={s.goalWeight} /></label>
    <button className="primary">Save</button>
  </form>;
}
