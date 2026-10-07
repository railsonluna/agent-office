# Agent Office

An animated office that shows your Claude Code sessions working in real time. Each Claude Code session becomes a character;
tool calls become actions (reading at the shelf, running Bash at the server rack, waiting for you with a raised hand, etc.).

- Zero dependencies. Needs **Node.js 18+** and **`curl`** in `PATH`. No `npm install` step.
- Backend: one file (`server.js`). Frontend: one file (`public/index.html`, canvas, no build step).
- UI text is in Brazilian Portuguese (pt-BR). Docs for humans are in `README.md` (pt-BR); this file is for Claude.

## Setup (follow these steps in order)

The user usually asks something like "set this up for me". Do exactly this:

1. **Check prerequisites**: `node -v` (must be 18+) and `curl --version`. Stop and tell the user if either is missing.
2. **Work from the project root** (the folder that contains this file). There is nothing to install.
3. **Install the Claude Code hooks, but ask the user first.**
   `npm run hooks:on` edits the user's **global** `~/.claude/settings.json`, so it affects every Claude Code session on the machine.
   Explain that, then get an explicit yes. The script:
   - copies the existing file to `~/.claude/settings.json.bak-<timestamp>` before writing;
   - is idempotent (it removes its own old entries first; they are recognised by `src=agent-office` in the command);
   - leaves the user's other hooks untouched;
   - refuses to touch the file if it is not valid JSON.
   Custom port: `PORT=8888 npm run hooks:on` (and then `PORT=8888 npm start`).
4. **Start the server**: `npm start`. It runs in the foreground; run it in a separate terminal or as a background task.
   It listens on `http://127.0.0.1:7777` only (override with `PORT`).
5. **Open** http://localhost:7777 in a browser and click once on the page (this unlocks audio).
6. **Hooks only apply to NEW Claude Code sessions.** Tell the user to open a fresh session in any project; it appears as a character.
7. **Verify without waiting for a real session**:
   ```bash
   curl -i -X POST -H 'Content-Type: application/json' \
     -d '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"/tmp/demo"}' \
     http://127.0.0.1:7777/event
   ```
   Expect `HTTP/1.1 204` and a character named `demo` walking in. Clean up with the same call using `"hook_event_name":"SessionEnd"`.
   The **Rodar demo** button in the page plays a scripted session as well.

**Optional, ask first: answering from the page.** `npm run hooks:on -- --interactive` additionally installs two blocking hooks that run `node hook-ask.js`:
`PreToolUse` (matcher `AskUserQuestion`) and `PermissionRequest` (matcher `*`). They let the user answer Claude's multiple-choice questions (Cave Mode doors or the answer panel)
and **allow / deny permission prompts** from the page. Because that can approve commands, explain it plainly and get an explicit yes. It is opt-in and fail-open: the hook only waits
while a page registered as viewer for that session (Cave Mode, or the Director's office with "Responder no canvas" on, ~25 s) and otherwise returns immediately, so Claude Code asks in the
terminal as usual. Explain that the terminal waits while the question is on screen (the "Responder no terminal" button, Esc, or the timeout hands it back).
Both mechanisms were verified end-to-end with Claude Code 2.1.x (a real `AskUserQuestion` answered from the doors; a real `PermissionRequest` allowed and denied by a probe hook).

To remove everything: `npm run hooks:off` (removes only this tool's hook entries and keeps a backup of the file). Then stop the server.

## How it works

```
Claude Code hooks --curl POST--> server.js /event --SSE /events--> browser (public/index.html)
```

- `install.js` registers hooks for `PreToolUse`, `PostToolUse` (matcher `*`), `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
  `Notification`, `Stop` and `SubagentStop`. Each runs a `curl` that POSTs the hook payload to the local server and always exits 0
  (`--max-time 1 ... || true`), so a stopped server never slows down or breaks Claude Code.
- `server.js` trims each payload to a few fields, keeps a small in-memory session table (last 30 min, replayed to new browser tabs
  as a `snapshot`), and fans events out over Server-Sent Events. Endpoints: `POST /event`, `GET /events`, `GET /` (serves `index.html`).
  The HTML is read from disk on every request, so frontend edits only need a browser reload, not a server restart (server edits do).
- Answering from the page (opt-in): `hook-ask.js` POSTs the `AskUserQuestion` payload or the `PermissionRequest` payload to `POST /ask`. The server holds that request only if a page sent a
  recent `POST /viewer` heartbeat for the session (`session_id` or `session_ids`, plus `hold` seconds: default 120 for Cave Mode, 25 for the answer panel), broadcasts an `ask` SSE message
  (`kind: 'question' | 'permission'`), and answers the hook once the page calls `POST /answer`: questions get `permissionDecision: "allow"` + `updatedInput.answers` (picked option indexes and/or
  free text), permissions get `decision: {behavior: 'allow' | 'deny'}`. No viewer, timeout, cancel or any error returns 204, so Claude Code asks in the terminal. The page side is the answer
  panel (`#aq`, `panelAsk` / `panelEnd` / `aqTick`) and, in Cave Mode, the doors.

## Files

| Path | Purpose |
|---|---|
| `server.js` | HTTP + SSE server, binds `127.0.0.1` |
| `tests/` | `flow.test.js` and `server.test.js`, zero-dependency Node scripts (`npm test`) |
| `install.js` | Adds / removes the hooks in `~/.claude/settings.json` (`--interactive` adds the question hook) |
| `hook-ask.js` | Opt-in blocking hook for `AskUserQuestion`, talks to `/ask` on localhost |
| `public/index.html` | The whole frontend (two `<script>` blocks, see below) |
| `README.md` | Human docs (pt-BR): event table, scenes, features |
| `CHANGELOG.md` | Release notes |

## Privacy and security

- The server binds to `127.0.0.1` only. Never change `HOST` to `0.0.0.0` and never expose the port.
- The hook `curl` posts the full hook payload to the local server only. The server keeps just: tool name, file path, the first 200 chars of a Bash command, search
  query/pattern, URL, subagent description, the notification `message` and `notification_type`, a computed "failed" flag, and, for `Stop` only, `last_assistant_message`
  (max 2000 chars, used by the Director's office to show the last reply). Prompts, file contents, tool output and `transcript_path` are dropped before anything is
  stored or sent to the browser.
  Permission prompts reach the page as the tool name plus a one-line summary (command, path or URL, and only the *length* of any file content), never the content itself.
- `/answer` and `/viewer` require a per-run random token (injected into the served HTML) plus a same-origin `Origin`/`Host` check, so other web pages
  cannot answer questions or register as a viewer. `/ask` rejects requests that carry an `Origin` header or a non-JSON content type. The page answers with the picked option
  INDEXES per question (`picks`); the server validates them and builds the answer text from the full original question/labels (so commas and long text survive).
  A pending ask is released automatically when the browser's heartbeat lapses. Never loosen these checks.
- Nothing is persisted by the server. The browser stores a few preferences in `localStorage` (`agent-office-*` keys: scene, YouTube link,
  timeline toggle, arcade high scores).
- Do not commit logs, backups or real project names into this folder. The demo button uses fake paths on purpose.

## Working on the frontend (`public/index.html`)

- **Main script**: scenes, agents, movement, scoreboard, record player, click handlers. **Extras script** (between `<!-- extras:start -->`
  and `<!-- extras:end -->`, at the end of the file): state badges, tool icons, timeline, fullscreen, arcade games, daily meeting, door.
  The extras block only *wraps* functions of the main script (`handle`, `push`, `drawAgent`, `scoreboard`, `drawBall`, `drawBar`), so it can be
  removed without breaking the rest.
- **Cave Mode** is not a `SCENES` entry: it is a full-canvas mode in the extras block (`cave`, `drawCave`, `enterCave`/`exitCave`) that replaces `draw()` while active.
  It renders a pseudo-3D tunnel (rings projected toward a vanishing point), the agent seen from behind, and reuses `stateOf()`/`actionText()`
  for the agent's pose and speech bubble. Entry point: the "Cave Mode" button appended to `#agentCard`.
  Stages: the first stage is the catacombs (mining). Choosing a door calls `nextStage(BIOME_BY_DOOR[door])`: green=jungle, red=hell, blue=ice, purple=catacombs.
  From stage 2 on the agent fights (`WEAPONS` per biome, monsters in `drawMonster`, combat in `drawCave`); biome look/palette/decor lives in `BIOMES`.
  "Simular pergunta" / "Auto" use `SIMQ` fake questions (id `'sim'`, never sent to the server) so every stage can be seen without a real Claude question.
- **Agent flow** (work / ask / deliver / gone) is a pure state machine, `flowReduce(flow, hookEvent, now)`, kept between `// flow:start` and `// flow:end` markers
  in the extras block so `tests/flow.test.js` can run it in Node. It runs for every agent in EVERY scene (stored in `ext(a).flow`); the heuristic that decides whether a final
  message is a question is the isolated `looksLikeQuestion`. A scene gets physical queues only if it declares `queues` (`{ask, deliver}` with counter/line geometry), `slots` (desk
  positions, applied on scene switch) and `nav()` (obstacle rects for the A* path planner that replaces the corridor router). `flowTick` moves agents (hold act + `goTo`), `flowCount('ask'|'deliver')`
  feeds the counter signs. In queue scenes Notification/Stop are not sent to the original `handle` (they would trigger the default coffee/bell behaviour) and every station action is remapped to the desk.
- **Scenes** live in the `SCENES` object: `office`, `halloween`, `vila`, `obra`. A scene provides `room()`, `desk(slot)`, `pet()`,
  optional `costume(ci, bob)`, `overlay()`, `ink`, `smoke`, `party`, and optionally a break area (`lounge`, `loungeFloor`, `loungeItems`,
  `say`, `shot`, `mark`). Stations (`ST`) sit at the same coordinates in every scene so scenes can be switched mid-work; draw each station on top of them.
- **To add a scene**: copy an existing one, add its entry to `SCENES` (it shows up in the selector automatically), then check it with agents
  present, in the break area, and after a scene switch.
- Conventions: canvas logic uses logical coordinates (W=1150, H=650); colors are inline hex; keep comments to the non-obvious *why*;
  no new dependencies and no build step.
- **Testing**: `npm test` runs `tests/flow.test.js` (state machine + question heuristic, with real captured Stop payloads) and `tests/server.test.js` (server + hook-ask, starts a server on port 7793). For the UI run `node --check` on each extracted `<script>` block, click **Rodar demo**, and look at the page.
  Headless Chrome screenshots work for visual checks (`--headless=new --screenshot=out.png file://.../index.html`).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Page says "sem servidor" | Server not running: `npm start`. Different port: use the same `PORT` for install, start and the URL. |
| `EADDRINUSE` on start | Port 7777 is taken: `PORT=8888 npm start` and reinstall hooks with the same `PORT`. |
| Server up but no characters | Hooks are read at session start: open a **new** Claude Code session. Check `~/.claude/settings.json` for commands containing `src=agent-office`. |
| Characters never appear, `curl` smoke test returns 204 | Hooks not installed or session not new; run `npm run hooks:on` (after asking the user). |
| Doors show but clicking does nothing | Interactive mode is off (preview only): `npm run hooks:on -- --interactive`, then open a new session. Check the hint at the bottom of the screen. |
| Changes to `index.html` not visible | Hard-reload the browser tab. `server.js` changes need a server restart. |

Tested on macOS with Node 20. Linux should work. Windows is untested: the hook command needs a bash-compatible shell and `curl`.

## Rules for Claude in this repo

- Never run `npm run hooks:on` (with or without `--interactive`) / `hooks:off` without the user's explicit confirmation, and never edit `~/.claude/settings.json` by hand.
- Do not commit, push, or run destructive commands unless asked.
- Keep it dependency-free and keep the frontend in the single `public/index.html`.
- Keep user-facing UI strings in pt-BR, and code, comments and this file in English.
