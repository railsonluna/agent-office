#!/usr/bin/env node
// Agent Office: recebe eventos dos hooks do Claude Code e transmite pro browser via SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 7777;
const HOST = '127.0.0.1';
const INDEX = path.join(__dirname, 'public', 'index.html');

// Interactive questions (opt-in, see hook-ask.js): the page proves who it is with a per-run token.
const TOKEN = crypto.randomBytes(16).toString('hex');
const TOKEN_PLACEHOLDER = '__AO_TOKEN__';
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ASK_TIMEOUT_MS = 120000;
const VIEWER_TTL_MS = 12000;

const clients = new Set();
const sessions = new Map(); // session_id -> { session_id, cwd, first, last, tools }
const viewers = new Map(); // session_id -> { t: last heartbeat of a page able to answer for that session, hold: seconds the hook may wait }
const pending = new Map(); // ask id -> { id, sid, kind: 'question' | 'permission', qs (full text), tool, input, res, timer }

const short = (s, n) => (typeof s === 'string' ? s.slice(0, n) : undefined);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Full text is kept server-side (it is echoed back to Claude Code); the browser gets shortened copies.
function cleanQuestions(input) {
  if (!isObj(input) || !Array.isArray(input.questions)) return undefined;
  const qs = input.questions.filter(isObj).slice(0, 4).map((q) => ({
    question: short(q.question, 2000) || '',
    header: short(q.header, 80) || '',
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).filter(isObj).slice(0, 4)
      .map((o) => ({ label: short(o.label, 500) || '', description: short(o.description, 1000) || '' })),
  })).filter((q) => q.question && q.options.length >= 2);
  return qs.length ? qs : undefined;
}
const forBrowser = (qs) => qs && qs.map((q) => ({
  question: q.question.slice(0, 300), header: q.header.slice(0, 40), multiSelect: q.multiSelect,
  options: q.options.map((o) => ({ label: o.label.slice(0, 100), description: o.description.slice(0, 200) })),
}));

// What a permission prompt is about, for the page: never file contents, only the command / path / url.
function summarize(tool, input) {
  const i = isObj(input) ? input : {};
  const pick = i.command ?? i.file_path ?? i.notebook_path ?? i.url ?? i.pattern ?? i.query ?? i.description;
  let s = typeof pick === 'string' ? pick : Object.keys(i).slice(0, 6).join(', ');
  const body = typeof i.content === 'string' ? i.content : typeof i.new_string === 'string' ? i.new_string : null;
  if (body !== null) s += `  (${body.length} caracteres)`;
  return s.slice(0, 800);
}

function trim(e) {
  const i = isObj(e.tool_input) ? e.tool_input : {};
  const r = e.tool_response;
  let failed = false;
  if (r && typeof r === 'object') {
    const tail = `${r.stderr || ''} ${(r.stdout || '').slice(-400)}`;
    failed = !!(r.is_error || r.interrupted || (r.exit_code && r.exit_code !== 0) ||
      (r.exitCode && r.exitCode !== 0) || /\b(fail(ed|ing|ure)?|error)\b/i.test(tail));
  } else if (typeof r === 'string') {
    failed = /exit code [1-9]|\berror\b/i.test(r.slice(-400));
  }
  return {
    hook_event_name: e.hook_event_name,
    session_id: e.session_id,
    cwd: e.cwd,
    tool_name: e.tool_name,
    tool_input: {
      file_path: short(i.file_path || i.notebook_path, 300),
      command: short(i.command, 200),
      pattern: short(i.pattern, 100),
      query: short(i.query, 100),
      url: short(i.url, 200),
      description: short(i.description, 120),
      subagent_type: short(i.subagent_type, 60),
    },
    questions: e.tool_name === 'AskUserQuestion' ? forBrowser(cleanQuestions(i)) : undefined,
    failed: e.hook_event_name === 'PostToolUse' ? failed : undefined,
    message: short(e.message, 400),
    notification_type: short(e.notification_type, 40),
    last_assistant_message: e.hook_event_name === 'Stop' ? short(e.last_assistant_message, 2000) : undefined,
    ts: Date.now(),
  };
}

function broadcast(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) res.write(data);
}

function readBody(req, limit, cb) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > limit) req.destroy(); });
  req.on('end', () => cb(body));
}
function parseObj(body) {
  try { const v = JSON.parse(body); return isObj(v) ? v : null; } catch { return null; }
}

function trusted(req) {
  const origin = req.headers.origin;
  if (!HOSTS.has(req.headers.host || '') || (origin && !ORIGINS.has(origin))) return false;
  const sent = Buffer.from(String(req.headers['x-ao-token'] || ''));
  const want = Buffer.from(TOKEN);
  return sent.length === want.length && crypto.timingSafeEqual(sent, want);
}

// Releases the waiting hook. No result (or timeout / cancel) => 204, so Claude Code asks in the terminal as usual.
function finishAsk(id, result) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  if (!p.res.writableEnded && !p.res.destroyed) {
    if (result && p.kind === 'permission') {
      p.res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: result } }));
    } else if (result) {
      const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...p.input, answers: result } } };
      p.res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    } else p.res.writeHead(204).end();
  }
  broadcast({ type: 'ask_end', id, kind: p.kind, session_id: p.sid, answered: !!result, decision: p.kind === 'permission' && result ? result.behavior : undefined });
}

// The page sends the picked option INDEXES per question (and/or a free-text answer, Claude's "Other"); the answer text is built here
// from the full original text. Multi-select labels are joined with commas (labels may contain commas themselves).
function buildAnswers(p, picks, custom) {
  if ((picks !== undefined && !Array.isArray(picks)) || (custom !== undefined && !Array.isArray(custom))) return null;
  if ((picks && picks.length !== p.qs.length) || (custom && custom.length !== p.qs.length)) return null;
  const answers = {};
  for (let k = 0; k < p.qs.length; k++) {
    const q = p.qs[k], c = custom && typeof custom[k] === 'string' ? custom[k].trim().slice(0, 2000) : '';
    if (c) { answers[q.question] = c; continue; }
    const pk = picks && picks[k];
    if (!Array.isArray(pk) || !pk.length || pk.length > q.options.length || (!q.multiSelect && pk.length !== 1)) return null;
    if (!pk.every((i) => Number.isInteger(i) && i >= 0 && i < q.options.length) || new Set(pk).size !== pk.length) return null;
    answers[q.question] = [...pk].sort((x, y) => x - y).map((i) => q.options[i].label).join(',');
  }
  return answers;
}

// A page that vanished (closed tab, crash, lost heartbeat) must not leave the terminal waiting for the full timeout.
setInterval(() => {
  const now = Date.now();
  for (const p of [...pending.values()]) { const v = viewers.get(p.sid); if (!v || now - v.t > VIEWER_TTL_MS) finishAsk(p.id, null); }
}, 2000).unref();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (req.method === 'POST' && url.pathname === '/event') {
    readBody(req, 5e6, (body) => {
      res.writeHead(204).end();
      const e = parseObj(body);
      if (!e) return;
      const ev = trim(e);
      if (ev.session_id) {
        if (ev.hook_event_name === 'SessionEnd') sessions.delete(ev.session_id);
        else {
          const prev = sessions.get(ev.session_id);
          sessions.set(ev.session_id, {
            session_id: ev.session_id, cwd: ev.cwd, first: prev ? prev.first : ev.ts, last: ev.ts,
            tools: (prev ? prev.tools : 0) + (ev.hook_event_name === 'PreToolUse' ? 1 : 0),
          });
        }
      }
      broadcast(ev);
    });
    return;
  }

  // Called by hook-ask.js (AskUserQuestion questions and PermissionRequest prompts). Holds the request only while a page registered as viewer for that session.
  if (req.method === 'POST' && url.pathname === '/ask') {
    if (req.headers.origin || !/application\/json/.test(req.headers['content-type'] || '')) { res.writeHead(403).end(); return; }
    readBody(req, 2e6, (body) => {
      const e = parseObj(body), sid = e && e.session_id, v = typeof sid === 'string' ? viewers.get(sid) : undefined;
      const isPerm = !!e && e.hook_event_name === 'PermissionRequest' && typeof e.tool_name === 'string' && e.tool_name !== 'AskUserQuestion';
      const qs = e && !isPerm && e.tool_name === 'AskUserQuestion' ? cleanQuestions(e.tool_input) : undefined;
      if (!e || !(isPerm || qs) || !v || Date.now() - v.t > VIEWER_TTL_MS) { res.writeHead(204).end(); return; }
      const id = crypto.randomBytes(6).toString('hex'), hold = Math.max(5, Math.min(120, v.hold || 120)) * 1000, until = Date.now() + hold;
      const p = { id, sid, kind: isPerm ? 'permission' : 'question', qs, tool: isPerm ? e.tool_name : undefined, input: e.tool_input, res, timer: setTimeout(() => finishAsk(id, null), hold) };
      pending.set(id, p);
      res.on('close', () => finishAsk(id, null));
      broadcast(isPerm
        ? { type: 'ask', id, kind: 'permission', session_id: sid, until, tool: { name: e.tool_name, summary: summarize(e.tool_name, e.tool_input) } }
        : { type: 'ask', id, kind: 'question', session_id: sid, until, questions: forBrowser(qs) });
    });
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/answer' || url.pathname === '/viewer')) {
    if (!trusted(req)) { res.writeHead(403).end(); return; }
    readBody(req, 1e5, (body) => {
      const d = parseObj(body);
      if (!d) { res.writeHead(400).end(); return; }
      if (url.pathname === '/viewer') {
        const ids = Array.isArray(d.session_ids) ? d.session_ids.filter((x) => typeof x === 'string').slice(0, 32) : typeof d.session_id === 'string' ? [d.session_id] : [];
        if (!ids.length) { res.writeHead(400).end(); return; }
        const hold = Math.max(5, Math.min(120, Number(d.hold) || 120));
        for (const sid of ids) {
          if (d.on) viewers.set(sid, { t: Date.now(), hold });
          else { viewers.delete(sid); for (const p of [...pending.values()]) if (p.sid === sid) finishAsk(p.id, null); }
        }
        res.writeHead(204).end();
        return;
      }
      const p = pending.get(d.id);
      if (!p) { res.writeHead(400).end(); return; }
      if (d.cancel === true) { finishAsk(p.id, null); res.writeHead(204).end(); return; }
      if (p.kind === 'permission') {
        if (d.decision !== 'allow' && d.decision !== 'deny') { res.writeHead(400).end(); return; }
        finishAsk(p.id, d.decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Negado pelo Agent Office' });
        res.writeHead(204).end();
        return;
      }
      const answers = buildAnswers(p, d.picks, d.custom);
      if (!answers) { res.writeHead(400).end(); return; }
      finishAsk(p.id, answers);
      res.writeHead(204).end();
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const cutoff = Date.now() - 30 * 60 * 1000; // sessões ativas nos últimos 30 min
    const live = [...sessions.values()].filter((s) => s.last > cutoff);
    res.write(`data: ${JSON.stringify({ type: 'snapshot', sessions: live })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(INDEX, 'utf8', (err, html) => {
      if (err) { res.writeHead(500).end('index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html.split(TOKEN_PLACEHOLDER).join(TOKEN));
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Agent Office rodando em http://localhost:${PORT}\n`);
});
