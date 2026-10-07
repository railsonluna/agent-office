#!/usr/bin/env node
// Adiciona (ou remove com --uninstall) os hooks do Agent Office no ~/.claude/settings.json.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT) || 7777;
const MARK = 'src=agent-office';
const CMD = `curl -s --max-time 1 -X POST -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:${PORT}/event?${MARK}' >/dev/null 2>&1 || true`;

const TOOL_EVENTS = ['PreToolUse', 'PostToolUse'];
const OTHER_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop'];

const file = path.join(os.homedir(), '.claude', 'settings.json');
const uninstall = process.argv.includes('--uninstall');
const interactive = process.argv.includes('--interactive');
const ASK_CMD = `node "${path.join(__dirname, 'hook-ask.js')}" ${MARK} ${PORT}`;

let settings = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    settings = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`Não consegui ler ${file} (JSON inválido). Nada foi alterado.\n${err.message}`);
    process.exit(1);
  }
  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  console.log(`Backup salvo em ${backup}`);
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

settings.hooks = settings.hooks || {};

const isOurs = (h) => typeof h.command === 'string' && h.command.includes(MARK);

// remove entradas antigas nossas (deixa tudo idempotente)
for (const ev of Object.keys(settings.hooks)) {
  settings.hooks[ev] = (settings.hooks[ev] || [])
    .map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((m) => m.hooks.length > 0);
  if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
}

if (!uninstall) {
  const hook = { type: 'command', command: CMD };
  for (const ev of TOOL_EVENTS) {
    (settings.hooks[ev] = settings.hooks[ev] || []).push({ matcher: '*', hooks: [hook] });
  }
  for (const ev of OTHER_EVENTS) {
    (settings.hooks[ev] = settings.hooks[ev] || []).push({ hooks: [hook] });
  }
  // opt-in: lets the page answer AskUserQuestion questions and permission prompts; hook-ask.js stays silent unless a page registered as viewer
  if (interactive) {
    (settings.hooks.PreToolUse = settings.hooks.PreToolUse || []).push({ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: ASK_CMD, timeout: 130 }] });
    // permission prompts: the page can allow/deny; without an answer in time the terminal dialog appears as usual
    (settings.hooks.PermissionRequest = settings.hooks.PermissionRequest || []).push({ matcher: '*', hooks: [{ type: 'command', command: ASK_CMD, timeout: 130 }] });
  }
}

if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log(uninstall
  ? 'Hooks do Agent Office removidos.'
  : `Hooks do Agent Office instalados em ${file}${interactive ? ' (com perguntas interativas)' : ''}.\nAbra uma sessão nova do Claude Code pra eles valerem.`);
