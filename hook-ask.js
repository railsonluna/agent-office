#!/usr/bin/env node
// Blocking hook for AskUserQuestion (PreToolUse) and PermissionRequest (installed only with `npm run hooks:on -- --interactive`).
// Asks the local Agent Office server to show the question / permission prompt in the page and waits for the answer.
// Any problem (server down, no page registered as viewer, timeout) exits silently, so Claude Code asks in the terminal as usual.
const http = require('http');

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a))) || 7777;
const WAIT_MS = 125000;

let raw = '';
process.stdin.on('data', (c) => { raw += c; }).on('end', () => {
  let e;
  try { e = JSON.parse(raw); } catch { process.exit(0); }
  if (!e || (e.tool_name !== 'AskUserQuestion' && e.hook_event_name !== 'PermissionRequest')) process.exit(0);
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/ask', method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: WAIT_MS },
    (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => { if (res.statusCode === 200 && out) process.stdout.write(out); process.exit(0); });
    },
  );
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(raw);
});
