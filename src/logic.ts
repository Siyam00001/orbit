// Pure logic shared by the UI and logic.check.ts — no React, no fetch.
export type Item = { id: number; [field: string]: any };
export type Count = 'velo' | 'dms' | 'apps' | 'replies' | 'spent' | 'earned' | 'cravings';
export type Day = { habits?: Record<string, boolean>; mood?: number; quest?: boolean; skills?: string[] } & { [K in Count]?: number };
export type Settings = { name: string; city: string; startCash: number; veloLimit: number; notes: string };

export const HABITS = [
  ['move', '💪', 'Workout or 30-min walk'],
  ['dms', '✉️', '5–10 cold DMs'],
  ['apps', '📄', '3 job applications'],
  ['fiverr', '🟢', 'Check Fiverr inbox'],
  ['protein', '🥚', 'Protein every meal'],
  ['garden', '🌿', 'Check the garden'],
] as const;
export const COUNTERS = [['dms', '✉️', 'DMs sent'], ['apps', '📄', 'Applications'], ['replies', '💬', 'Replies']] as const;
export const TITLES = ['Rookie', 'Hustler', 'Builder', 'Shipper', 'Operator', 'Closer', 'Legend'];

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s: string, n: number) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const pkr = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-PK');

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** RFC 7396 JSON merge-patch — same semantics as SQLite's json_patch, so both backends agree. */
export function mergePatch(target: unknown, patch: unknown): any {
  if (!isObj(patch)) return patch;
  const out: Record<string, any> = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) if (v === null) delete out[k]; else out[k] = mergePatch(out[k], v);
  return out;
}

// ── sync granularity: one key per day field (each habit separately), per setting and per item,
//    so edits made on two devices to different things never overwrite each other ──
export const parseKey = (k: string) => { const [type, a, b] = k.split('|'); return { type, a, b }; };
export function dayPatchKeys(date: string, patch: Record<string, unknown>) {
  const keys: string[] = [];
  for (const [f, v] of Object.entries(patch)) {
    if (f === 'habits' && isObj(v)) for (const h of Object.keys(v)) keys.push(`d|${date}|h.${h}`);
    else keys.push(`d|${date}|${f}`);
  }
  return keys;
}
export const dayField = (d: Day | undefined, field: string): unknown =>
  (field.startsWith('h.') ? d?.habits?.[field.slice(2)] : (d as Record<string, unknown> | undefined)?.[field]) ?? null;
/** Set (or delete, for null) one field of a day; never mutates the input. */
export function setDayField(d: Day, field: string, v: unknown): Day {
  const out: Record<string, any> = { ...d, habits: { ...d.habits } };
  if (field.startsWith('h.')) { if (v == null) delete out.habits[field.slice(2)]; else out.habits[field.slice(2)] = v; }
  else if (v == null) delete out[field]; else out[field] = v;
  if (!Object.keys(out.habits).length) delete out.habits;
  return out as Day;
}

export const doneCount = (d?: Day) => HABITS.filter(([id]) => d?.habits?.[id]).length;
const perfect = (d?: Day) => doneCount(d) === HABITS.length;

/** Consecutive perfect days; an unfinished today doesn't break the streak yet. */
export function streak(days: Record<string, Day>, today: string) {
  let d = perfect(days[today]) ? today : addDays(today, -1), n = 0;
  while (perfect(days[d])) { n++; d = addDays(d, -1); }
  return n;
}

/** A counter summed over the last 7 days, today included. */
export const weekTotal = (days: Record<string, Day>, k: Count, today: string) =>
  Array.from({ length: 7 }, (_, i) => days[addDays(today, -i)]?.[k] ?? 0).reduce((a, b) => a + b, 0);

/** Cash on hand and how many days it lasts at the recent spend rate. */
export function money(days: Record<string, Day>, startCash: number, today: string) {
  const entries = Object.entries(days);
  const cash = entries.reduce((a, [, d]) => a + (d.earned ?? 0) - (d.spent ?? 0), +startCash);
  const recent = entries.filter(([k, d]) => d.spent && daysBetween(k, today) >= 0 && daysBetween(k, today) < 30);
  const span = recent.length ? Math.max(...recent.map(([k]) => daysBetween(k, today))) + 1 : 0; // days of data, ≤30
  const spent = recent.reduce((a, [, d]) => a + d.spent!, 0);
  const month = entries.filter(([k]) => k.startsWith(today.slice(0, 7)));
  const sum = (k: Count) => month.reduce((a, [, d]) => a + (d[k] ?? 0), 0);
  return { cash, runway: spent ? Math.max(0, Math.floor(cash / (spent / span))) : Infinity, earned: sum('earned'), spent: sum('spent') };
}

// ── weekly boss fight: job-hunt counters deal damage, a new boss every Monday ──
export const BOSSES = [
  ['👻', 'The Ghoster', 40], ['🤖', 'ATS Bot 3000', 50], ['🐌', '"We\'ll get back to you"', 40], ['🧛', 'Unpaid Trial Vampire', 45],
  ['🦑', 'Recruiter Kraken', 60], ['🗿', 'Seen at 2pm', 45], ['🐉', 'The Hiring Freeze', 70], ['🎭', '"Exposure Pay" Client', 50],
] as const;
export const DAMAGE = { dms: 1, apps: 2, replies: 10 } as const;
const damage = (d?: Day) => (d?.dms ?? 0) * DAMAGE.dms + (d?.apps ?? 0) * DAMAGE.apps + (d?.replies ?? 0) * DAMAGE.replies;
export const mondayOf = (s: string) => addDays(s, -((new Date(s + 'T12:00').getDay() + 6) % 7));
const bossFor = (monday: string) => {
  const n = BOSSES.length, w = Math.floor(daysBetween('2026-01-05', monday) / 7); // 2026-01-05 is a Monday
  return BOSSES[((w % n) + n) % n];
};

export function boss(days: Record<string, Day>, today: string) {
  const monday = mondayOf(today), elapsed = daysBetween(monday, today);
  const dmg = Array.from({ length: elapsed + 1 }, (_, i) => damage(days[addDays(monday, i)])).reduce((a, b) => a + b, 0);
  const [emoji, name, hp] = bossFor(monday);
  return { emoji, name, hp, dmg, left: Math.max(0, hp - dmg), dead: dmg >= hp, daysLeft: 6 - elapsed };
}

export function bossesBeaten(days: Record<string, Day>) {
  const weeks: Record<string, number> = {};
  for (const [k, d] of Object.entries(days)) { const m = mondayOf(k); weeks[m] = (weeks[m] ?? 0) + damage(d); }
  return Object.entries(weeks).filter(([m, dmg]) => dmg >= bossFor(m)[2]).length;
}

// ── your world: a planet that mirrors the last 7 days ──
export function world(days: Record<string, Day>, today: string, photos: number, veloLimit: number) {
  const week = Array.from({ length: 7 }, (_, i) => doneCount(days[addDays(today, -i)]));
  return {
    health: week.reduce((a, b) => a + b, 0) / (7 * HABITS.length), // 0 barren … 1 lush
    moons: Math.min(streak(days, today), 7),
    trees: Math.min(photos, 14),
    smog: (days[today]?.velo ?? 0) > veloLimit,
    mood: days[today]?.mood ?? 0,
    satellites: Math.min(Object.keys(learned(days)).length, 10),
  };
}

// ── daily side quest: same quest all day, a new one tomorrow ──
export const QUESTS = [
  'Text an old friend you miss', 'Drink 2 glasses of water right now', '10-minute walk without your phone',
  'Stretch for 5 minutes', 'Eat one piece of fruit', 'Clean one small thing — just your desk',
  'Step outside and look at the sky for 2 minutes', 'Send someone a thank-you message', 'Learn one new AI trick and note it',
  'Water a plant and talk to it (seriously)', 'Call a family member', '20 push-ups, split up is fine',
  'In bed before 1am tonight', 'Write 3 things you\'re grateful for in Notes', 'Listen to one full album, no skipping',
  'Make chai for someone else', 'Post one thing you built on LinkedIn or X', 'Unfollow 5 accounts that drain you',
  'Photograph something beautiful', 'Ask someone how they\'re really doing',
];
export const questFor = (date: string) => QUESTS[(Math.imul(daysBetween('2026-01-01', date), 2654435761) >>> 0) % QUESTS.length];

// ── career roadmap: [id, title, why it matters, search phrase] — learned skills are stored on the day you learned them ──
export const ROADMAP = [
  { track: '🤖 AI engineering', skills: [
    ['prompts', 'Prompt engineering', 'Clear instructions, examples and roles — the base of every AI feature.', 'prompt engineering for developers'],
    ['structured', 'Structured outputs', 'Make models return JSON your code can trust (Zod schemas).', 'LLM structured outputs JSON schema zod'],
    ['tools', 'Tool / function calling', 'Let a model call your APIs — the core of every agent.', 'LLM function calling tool use tutorial'],
    ['embeddings', 'Embeddings & vector search', 'Search by meaning, not keywords (pgvector, Pinecone).', 'embeddings vector search pgvector tutorial'],
    ['rag', 'RAG — chat with your docs', 'The #1 thing clients ask for: AI over their own data.', 'RAG retrieval augmented generation tutorial'],
    ['streaming', 'Streaming responses', 'Token-by-token UI that feels instant.', 'stream LLM response React Node tutorial'],
    ['agents', 'AI agents & tool loops', 'Multi-step tasks: plan, call tools, check results.', 'build AI agent tool loop tutorial'],
    ['mcp', 'MCP (Model Context Protocol)', 'The standard way to plug tools and data into AI apps.', 'Model Context Protocol MCP server tutorial'],
    ['evals', 'Evals — testing AI output', 'Prove your AI feature works before a client finds out it doesn\'t.', 'LLM evals testing tutorial'],
    ['guardrails', 'Prompt injection & guardrails', 'Stop user input from hijacking your AI.', 'prompt injection guardrails LLM security'],
  ] },
  // from 18 real remote Indeed posts (Oct 2026): what they ask for that the other tracks don't cover, in their wording
  { track: '📈 What remote jobs want', skills: [
    ['pyfastapi', 'Python & FastAPI for AI', '"Fluent Python… async programming… FastAPI" (8 of 18 remote posts).', 'FastAPI async tutorial LLM backend'],
    ['clouddeploy', 'Deploying to AWS / GCP', '"Deploying and managing applications on AWS" (10 of 18 posts ask for cloud).', 'deploy Node app AWS ECS RDS S3 tutorial'],
    ['aicoding', 'Shipping with AI coding agents', '"Proficiency with AI coding agents (Cursor, Claude Code, Codex)" (7 posts).', 'Claude Code Cursor workflow professional developers'],
    ['agentframeworks', 'LangGraph & agent frameworks', '"LLM calls tools or APIs and takes action on its own… not a chatbot wrapper."', 'LangGraph tutorial build agent'],
    ['agentmemory', 'Agent context & memory', '"Agent design, skills, context, and memory."', 'context engineering LLM agents memory'],
    ['hitl', 'Human in the loop & handoff', '"Know when to act, ask a question, or hand off to a human."', 'human in the loop AI agent approval pattern'],
    ['tenantauth', 'Multi tenant auth & RBAC', '"Permission aware APIs" and "tenant isolation" (5 posts).', 'multi-tenant SaaS RBAC row level security Postgres'],
    ['webhooks', 'Webhooks & event driven flows', '"Event driven workflows… API/webhook integrations."', 'webhooks event-driven architecture tutorial'],
    ['terraform', 'Infrastructure as code', '"Deploying resources via Terraform" (3 posts).', 'Terraform beginner tutorial AWS'],
  ] },
  { track: '🚀 Ship like a senior', skills: [
    ['ts', 'Advanced TypeScript', 'Generics and utility types — reads senior in any codebase.', 'advanced TypeScript generics utility types'],
    ['postgres', 'Postgres & SQL', 'Most jobs use it; Firestore alone limits you.', 'PostgreSQL SQL tutorial for developers'],
    ['auth', 'Auth: OAuth & sessions', 'Login done right shows up in every SaaS gig.', 'OAuth sessions JWT authentication explained'],
    ['docker', 'Docker', 'Ship anywhere — expected in remote job interviews.', 'Docker tutorial for Node.js developers'],
    ['testing', 'Testing: Vitest + Playwright', 'Unit and browser tests — the habit clients pay more for.', 'Vitest Playwright testing tutorial'],
    ['cicd', 'CI/CD with GitHub Actions', 'You already have one deploying Orbit — learn it properly.', 'GitHub Actions CI CD tutorial'],
    ['nextjs', 'Next.js App Router', 'The most requested React framework in job posts.', 'Next.js App Router tutorial'],
    ['design', 'System design basics', 'Queues, caching, scaling — interviews always ask.', 'system design basics for web developers'],
  ] },
  { track: '💼 Get paid', skills: [
    ['casestudy', 'Write a case study', 'Turn imgnfn and Orbit into stories clients trust.', 'developer portfolio case study how to write'],
    ['proposals', 'Winning proposals & DMs', 'Short, specific, about their problem — not your CV.', 'freelance proposal writing tips developer'],
    ['pricing', 'Pricing your work', 'Fixed vs hourly, and when to raise your rates.', 'how to price freelance software development'],
    ['scoping', 'Client calls & scoping', 'Ask the right questions before you quote.', 'freelance developer discovery call scoping'],
    ['async', 'Async communication', 'Clear updates and Loom videos — remote teams hire for this.', 'async communication remote developer'],
    ['interviews', 'Remote interview prep', 'Take-homes, live coding, and talking about past work.', 'remote developer interview preparation'],
  ] },
  { track: '🧠 AI system design', skills: [
    ['llmarch', 'LLM app architecture', 'Where the model sits: API layer, prompts, tools, storage — the big picture.', 'LLM application architecture explained'],
    ['ragdesign', 'Designing a RAG pipeline', 'Chunking, embedding, retrieval, re-ranking — and where it breaks.', 'RAG pipeline design chunking reranking'],
    ['aicost', 'Cost & caching', 'Prompt caching, batching and cheaper models — keep the bill sane.', 'LLM cost optimization prompt caching batching'],
    ['ailatency', 'Latency & streaming at scale', 'Make AI feel fast: streaming, parallel calls, timeouts.', 'reduce LLM latency streaming production'],
    ['aiqueues', 'Queues & background AI jobs', 'Long generations belong in a queue — you already built one.', 'background job queue for AI tasks architecture'],
    ['fallbacks', 'Model routing & fallbacks', 'Route easy tasks to cheap models; survive provider outages.', 'LLM model routing fallback strategy'],
    ['aiobs', 'Observability for AI apps', 'Log prompts, costs and failures so you can debug real users.', 'LLM observability tracing logging'],
  ] },
  { track: '🎨 UI / UX', skills: [
    ['uxbasics', 'UX fundamentals', 'Who the user is, what they need, the shortest path to it.', 'UX design fundamentals for developers'],
    ['hierarchy', 'Visual hierarchy & spacing', 'Size, contrast and whitespace decide what people see first.', 'visual hierarchy spacing UI design tips'],
    ['typecolor', 'Typography & color', 'Two fonts, a tight palette, enough contrast — instant polish.', 'typography and color for UI design'],
    ['figma', 'Figma basics', 'Sketch a screen before coding it — and speak designers\' language.', 'Figma tutorial for beginners developers'],
    ['mobileux', 'Mobile UX patterns', 'Thumb zones, bottom bars, big tap targets — like Orbit\'s dock.', 'mobile UX design patterns thumb zone'],
    ['a11y', 'Accessibility', 'Contrast, labels, keyboard use — more users, fewer lawsuits.', 'web accessibility basics WCAG developers'],
    ['designsys', 'Design systems (Tailwind + shadcn)', 'Reusable components so every screen looks consistent.', 'design system Tailwind shadcn ui tutorial'],
  ] },
  { track: '🎯 Interview cracking', skills: [
    ['dsaarrays', 'Arrays & hash maps', 'The pattern behind half of all coding questions.', 'arrays hash maps interview patterns'],
    ['twoptr', 'Two pointers & sliding window', 'Turn O(n²) brute force into O(n) — interviewers love it.', 'two pointers sliding window interview problems'],
    ['treesgraphs', 'Trees & graphs (BFS/DFS)', 'Traversals show up constantly — learn them once, properly.', 'trees graphs BFS DFS interview'],
    ['dpbasics', 'Dynamic programming basics', 'Break problems into overlapping subproblems — just the basics.', 'dynamic programming for beginners interview'],
    ['jsreact', 'JS & React interview questions', 'Closures, event loop, hooks, rendering — your daily tools, explained.', 'JavaScript React interview questions'],
    ['sdinterview', 'System design interview framework', 'Requirements → API → data → scale: a calm 45-minute script.', 'system design interview framework step by step'],
    ['star', 'Behavioral answers (STAR)', 'Turn Nvgen and imgnfn into crisp stories that land offers.', 'STAR method behavioral interview examples software'],
    ['negotiate', 'Salary negotiation', 'Remote roles pay in dollars — don\'t undersell yourself.', 'salary negotiation tips software developer remote'],
  ] },
] as const;
export const SKILLS = ROADMAP.flatMap(t => t.skills.map(([id, title, why, q]) => ({ id, title, why, q, track: t.track })));

/** skill id → the date it was learned */
export function learned(days: Record<string, Day>) {
  const out: Record<string, string> = {};
  for (const [date, d] of Object.entries(days)) for (const id of d.skills ?? []) out[id] = date;
  return out;
}

/** The next concept to study: first unlearned skill, walking the tracks in order. */
export const nextSkill = (days: Record<string, Day>) => { const l = learned(days); return SKILLS.find(s => !l[s.id]) ?? null; };

/** XP one day earns — kept in one place so the level bar and the weekly recap agree. */
export const dayXp = (d: Day) => doneCount(d) * 10 + (d.mood ? 2 : 0) + (d.dms ?? 0) + (d.apps ?? 0) * 2
  + (d.replies ?? 0) * 10 + (d.cravings ?? 0) * 15 + (d.quest ? 20 : 0) + (d.skills?.length ?? 0) * 40;

/** Last 7 days, today included, for the stories-style recap. */
export function wrapped(days: Record<string, Day>, photos: Item[], today: string, veloLimit: number) {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const ds = keys.map(k => days[k] ?? {});
  const sum = (k: Count) => ds.reduce((a, d) => a + (d[k] ?? 0), 0);
  const ticks = ds.map(doneCount), top = Math.max(...ticks);
  return {
    from: keys[0], ticks: ticks.reduce((a, b) => a + b, 0), perfect: ticks.filter(t => t === HABITS.length).length,
    best: top ? keys[ticks.indexOf(top)] : null, bestTicks: top,
    dms: sum('dms'), apps: sum('apps'), replies: sum('replies'), velo: sum('velo'), cravings: sum('cravings'),
    veloUnder: ds.filter(d => (d.velo ?? 0) <= veloLimit).length, quests: ds.filter(d => d.quest).length,
    skills: ds.reduce((a, d) => a + (d.skills?.length ?? 0), 0),
    photos: photos.filter(p => p.date >= keys[0] && p.date <= today), xp: ds.reduce((a, d) => a + dayXp(d), 0),
  };
}

/** Everything you do earns XP; level n starts at (n-1)² × 100. */
export function xp(days: Record<string, Day>, photos: number) {
  const total = Object.values(days).reduce((a, d) => a + dayXp(d), 0) + photos * 3 + bossesBeaten(days) * 100;
  const level = Math.floor(Math.sqrt(total / 100)) + 1;
  const from = (level - 1) ** 2 * 100, to = level ** 2 * 100;
  return { total, level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], pct: (total - from) / (to - from), toNext: to - total };
}
