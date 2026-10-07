// Integration tests for server.js + hook-ask.js (starts the server on port 7793; no Claude Code needed).
const http = require('http'), { spawn } = require('child_process');
const PORT = 7793, DIR = process.argv[2] || require('path').join(__dirname, '..');
const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => { let o = ''; res.on('data', (c) => o += c); res.on('end', () => resolve({ status: res.statusCode, body: o })); });
  req.on('error', (e) => resolve({ status: 'ERR', body: e.message })); if (body) req.write(body); req.end();
});
const J = { 'Content-Type': 'application/json' };
const pay = (qs, sid = 's1') => JSON.stringify({ hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'AskUserQuestion', tool_input: { questions: qs } });
const mkq = (labels, multi = false, q = 'Q?') => [{ question: q, header: 'h', multiSelect: multi, options: labels.map((l) => ({ label: l, description: 'd' })) }];
let fails = 0, n = 0; const ok = (name, cond, extra = '') => { n++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = spawn('node', ['server.js'], { cwd: DIR, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' }); await wait(700);
  const page = await call('GET', '/'); const TOKEN = (page.body.match(/const AO_TOKEN = '([0-9a-f]{32})'/) || [])[1];
  ok('token injetado', !!TOKEN && !page.body.includes('__AO_TOKEN__'));
  const A = { ...J, 'X-AO-Token': TOKEN };
  const sse = []; http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => res.on('data', (c) => String(c).split('\n').filter((l) => l.startsWith('data: ')).forEach((l) => { try { sse.push(JSON.parse(l.slice(6))); } catch {} }))); await wait(200);
  const view = (on, sid = 's1') => call('POST', '/viewer', { headers: A, body: JSON.stringify({ session_id: sid, on }) });
  const lastAsk = () => sse.filter((m) => m.type === 'ask').pop();
  // --- bug: corpo "null" derrubava o servidor ---
  for (const path of ['/ask', '/event', '/viewer', '/answer']) { await call('POST', path, { headers: path === '/ask' || path === '/event' ? J : A, body: 'null' }); await call('POST', path, { headers: { 'Content-Type': 'text/plain' }, body: 'null' }); await call('POST', path, { headers: J, body: '[1,2]' }); }
  const alive = await call('GET', '/'); ok('servidor segue vivo após corpos null/array/inválidos em todas as rotas', alive.status === 200);
  // --- 204 sem navegador, token/origem ---
  let r = await call('POST', '/ask', { headers: J, body: pay(mkq(['A', 'B'])) }); ok('sem viewer: /ask => 204 imediato', r.status === 204);
  r = await call('POST', '/viewer', { headers: J, body: JSON.stringify({ session_id: 's1', on: true }) }); ok('/viewer sem token => 403', r.status === 403);
  r = await call('POST', '/viewer', { headers: { ...A, Origin: 'http://evil.example' }, body: JSON.stringify({ session_id: 's1', on: true }) }); ok('/viewer Origin estranha => 403', r.status === 403);
  r = await call('POST', '/viewer', { headers: { ...A, Host: 'evil.example' }, body: JSON.stringify({ session_id: 's1', on: true }) }); ok('/viewer Host estranho => 403', r.status === 403);
  r = await call('POST', '/ask', { headers: { ...J, Origin: 'http://evil.example' }, body: pay(mkq(['A', 'B'])) }); ok('/ask com Origin => 403', r.status === 403);
  await view(true);
  // --- fluxo feliz por índice ---
  let hook = call('POST', '/ask', { headers: J, body: pay(mkq(['React', 'Vue', 'Svelte'], false, 'Qual framework?')) }); await wait(250);
  let ev = lastAsk(); ok('SSE traz 3 opções', ev && ev.questions[0].options.length === 3);
  r = await call('POST', '/answer', { headers: J, body: JSON.stringify({ id: ev.id, picks: [[1]] }) }); ok('picks sem token => 403', r.status === 403);
  for (const bad of [[[5]], [[-1]], [[0, 1]], [[]], [], [[1.5]], 'x', [[1], [0]]]) { r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, picks: bad }) }); if (r.status !== 400) { ok('picks inválido ' + JSON.stringify(bad) + ' => 400', false, 'status ' + r.status); } }
  ok('picks inválidos (índice fora, negativo, múltiplo em single, vazio, decimal, tamanho errado) => 400', true);
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, picks: [[1]] }) }); ok('pick válido => 204', r.status === 204);
  let h = await hook, out = JSON.parse(h.body || '{}').hookSpecificOutput || {};
  ok('hook recebe allow + answers {"Qual framework?":"Vue"} + perguntas originais', h.status === 200 && out.permissionDecision === 'allow' && out.updatedInput.answers['Qual framework?'] === 'Vue' && out.updatedInput.questions.length === 1, h.body);
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, picks: [[1]] }) }); ok('reenviar => 400', r.status === 400);
  // --- bug: vírgula no rótulo (multi) ---
  await view(true);
  hook = call('POST', '/ask', { headers: J, body: pay(mkq(['Sim, tudo', 'Só testes', 'Nada'], true, 'Quais?')) }); await wait(250); ev = lastAsk();
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, picks: [[0, 1]] }) }); ok('multi com rótulo com vírgula => 204', r.status === 204);
  out = JSON.parse((await hook).body).hookSpecificOutput; ok('...e a resposta é "Sim, tudo,Só testes"', out.updatedInput.answers['Quais?'] === 'Sim, tudo,Só testes', JSON.stringify(out.updatedInput.answers));
  // --- bug: texto longo era truncado antes de voltar pro Claude ---
  await view(true);
  const longQ = 'P'.repeat(450), longL = 'L'.repeat(260);
  hook = call('POST', '/ask', { headers: J, body: pay(mkq([longL, 'curta'], false, longQ)) }); await wait(250); ev = lastAsk();
  ok('browser recebe cópia curta (300/100)', ev.questions[0].question.length === 300 && ev.questions[0].options[0].label.length === 100);
  await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, picks: [[0]] }) }); out = JSON.parse((await hook).body).hookSpecificOutput;
  ok('...mas o Claude recebe a pergunta e o rótulo COMPLETOS', out.updatedInput.answers[longQ] === longL, Object.keys(out.updatedInput.answers)[0].length + '');
  // --- bug: mais de 4 opções ---
  await view(true);
  hook = call('POST', '/ask', { headers: J, body: pay(mkq(['a', 'b', 'c', 'd', 'e', 'f'])) }); await wait(250); ev = lastAsk();
  ok('pergunta com 6 opções chega com 4', ev.questions[0].options.length === 4); await view(false); await hook;
  // --- cancelamento (botão/Esc) ---
  await view(true); hook = call('POST', '/ask', { headers: J, body: pay(mkq(['A', 'B'])) }); await wait(250); ev = lastAsk();
  r = await call('POST', '/answer', { headers: J, body: JSON.stringify({ id: ev.id, cancel: true }) }); ok('cancelar sem token => 403', r.status === 403);
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, cancel: true }) }); ok('cancelar com token => 204', r.status === 204);
  ok('...e o hook sai 204 (volta pro terminal)', (await hook).status === 204);
  await view(true); hook = call('POST', '/ask', { headers: J, body: pay(mkq(['A', 'B'])) }); await wait(250); await view(false); ok('sair da caverna libera o hook (204)', (await hook).status === 204);
  // --- bug: página some com pergunta pendente ---
  await view(true); const t0 = Date.now(); hook = call('POST', '/ask', { headers: J, body: pay(mkq(['A', 'B'])) });
  const rel = await hook; const secs = (Date.now() - t0) / 1000;
  ok('página some (sem heartbeat): hook liberado em <= 16s (era 120s) -> ' + secs.toFixed(1) + 's', rel.status === 204 && secs <= 16, 'status ' + rel.status + ' ' + secs);
  // --- hook-ask.js real ---
  const run = (stdin) => new Promise((res) => { const p = spawn('node', ['hook-ask.js', String(PORT)], { cwd: DIR }); let o = ''; p.stdout.on('data', (c) => o += c); p.on('close', (code) => res({ code, o })); p.stdin.end(stdin); });
  await view(true); const pr = run(pay(mkq(['A', 'B', 'C'], false, 'Pergunta real?'))); await wait(400); ev = lastAsk();
  await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, picks: [[2]] }) }); const hr = await pr;
  ok('hook-ask.js imprime JSON e sai 0', hr.code === 0 && JSON.parse(hr.o).hookSpecificOutput.updatedInput.answers['Pergunta real?'] === 'C', JSON.stringify(hr));
  ok('hook-ask.js ignora outras ferramentas', (await run(JSON.stringify({ tool_name: 'Bash', session_id: 's1' }))).o === '');
  // --- campos novos do fluxo (Stop / Notification) chegam ao navegador ---
  await call('POST', '/event', { headers: J, body: JSON.stringify({ hook_event_name: 'Stop', session_id: 's9', cwd: '/x', last_assistant_message: 'Pronto.\n\nQuer que eu abra o PR?', stop_hook_active: false, transcript_path: '/secret/path.jsonl' }) });
  await call('POST', '/event', { headers: J, body: JSON.stringify({ hook_event_name: 'Notification', session_id: 's9', notification_type: 'permission_prompt', message: 'Claude precisa da sua permissão' }) }); await wait(250);
  const stp = sse.filter((m) => m.hook_event_name === 'Stop').pop(), ntf = sse.filter((m) => m.hook_event_name === 'Notification').pop();
  ok('Stop repassa last_assistant_message e NÃO vaza transcript_path', stp && stp.last_assistant_message.includes('Quer que eu') && !JSON.stringify(stp).includes('secret'));
  ok('Notification repassa notification_type e message', ntf && ntf.notification_type === 'permission_prompt' && ntf.message.includes('permissão'));
  const longStop = 'x'.repeat(5000); await call('POST', '/event', { headers: J, body: JSON.stringify({ hook_event_name: 'Stop', session_id: 's9', last_assistant_message: longStop }) }); await wait(250);
  ok('texto do Stop é limitado a 2000 caracteres', sse.filter((m) => m.hook_event_name === 'Stop').pop().last_assistant_message.length === 2000);
  // --- /event repassa preview e não vaza ---
  await call('POST', '/event', { headers: J, body: pay(mkq(['X', 'Y'], false, 'Preview?')) }); await wait(250);
  const pv = sse.filter((m) => m.tool_name === 'AskUserQuestion' && m.hook_event_name === 'PreToolUse').pop(); ok('/event repassa questions (preview)', pv && pv.questions[0].options[1].label === 'Y');
  // --- permissões (PermissionRequest) ---
  const permPay = (tool, input, sid = 's1') => JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: sid, tool_name: tool, tool_input: input, permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] });
  r = await call('POST', '/ask', { headers: J, body: permPay('Bash', { command: 'ls' }, 'nao-registrado') }); ok('permissão sem viewer: 204 imediato', r.status === 204);
  await view(true);
  hook = call('POST', '/ask', { headers: J, body: permPay('Bash', { command: 'rm -rf /tmp/x && echo pronto' }) }); await wait(250); ev = lastAsk();
  ok('SSE traz kind=permission, ferramenta e resumo do comando', ev && ev.kind === 'permission' && ev.tool.name === 'Bash' && ev.tool.summary.includes('rm -rf /tmp/x') && typeof ev.until === 'number');
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, decision: 'talvez' }) }); ok('decisão inválida => 400', r.status === 400);
  r = await call('POST', '/answer', { headers: J, body: JSON.stringify({ id: ev.id, decision: 'allow' }) }); ok('decisão sem token => 403', r.status === 403);
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, decision: 'allow' }) }); ok('permitir => 204', r.status === 204);
  h = await hook; out = JSON.parse(h.body || '{}').hookSpecificOutput || {};
  ok('hook recebe PermissionRequest + decision.behavior=allow', h.status === 200 && out.hookEventName === 'PermissionRequest' && out.decision.behavior === 'allow', h.body);
  await wait(250); ok('ask_end informa decision=allow', sse.some((m) => m.type === 'ask_end' && m.kind === 'permission' && m.decision === 'allow'));
  await view(true); hook = call('POST', '/ask', { headers: J, body: permPay('Write', { file_path: '/tmp/a.txt', content: 'SEGREDO-NO-CONTEUDO-DO-ARQUIVO' }) }); await wait(250); ev = lastAsk();
  ok('resumo de Write mostra o caminho e o tamanho, NUNCA o conteúdo', ev.tool.summary.includes('/tmp/a.txt') && ev.tool.summary.includes('caracteres') && !JSON.stringify(ev).includes('SEGREDO'));
  await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, decision: 'deny' }) }); out = JSON.parse((await hook).body).hookSpecificOutput;
  ok('negar => decision.behavior=deny com mensagem', out.decision.behavior === 'deny' && /Negado/.test(out.decision.message));
  await view(true); hook = call('POST', '/ask', { headers: J, body: permPay('AskUserQuestion', { questions: [] }) }); r = await hook; ok('PermissionRequest da própria AskUserQuestion é ignorado (204)', r.status === 204);
  await view(true); hook = call('POST', '/ask', { headers: J, body: permPay('Bash', { command: 'ls' }) }); await wait(250); ev = lastAsk();
  await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, cancel: true }) }); ok('cancelar permissão => hook 204 (volta pro terminal)', (await hook).status === 204);
  // --- texto livre ("Outra resposta") ---
  await view(true); hook = call('POST', '/ask', { headers: J, body: pay([{ question: 'Qual cor?', header: 'c', multiSelect: false, options: [{ label: 'Azul' }, { label: 'Verde' }] }, { question: 'Quais extras?', header: 'e', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }]) }); await wait(250); ev = lastAsk();
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, custom: ['', ''] }) }); ok('texto livre vazio e sem picks => 400', r.status === 400);
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, custom: ['só uma'] }) }); ok('texto livre com tamanho errado => 400', r.status === 400);
  r = await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, custom: ['Roxo, com listras', null], picks: [[], [0, 1]] }) }); ok('texto livre numa pergunta + opções na outra => 204', r.status === 204);
  out = JSON.parse((await hook).body).hookSpecificOutput; ok('...resposta = o texto digitado e as opções marcadas', out.updatedInput.answers['Qual cor?'] === 'Roxo, com listras' && out.updatedInput.answers['Quais extras?'] === 'A,B', JSON.stringify(out.updatedInput.answers));
  await view(true); hook = call('POST', '/ask', { headers: J, body: pay(mkq(['A', 'B'])) }); await wait(250); ev = lastAsk();
  await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, custom: ['x'.repeat(5000)] }) }); out = JSON.parse((await hook).body).hookSpecificOutput;
  ok('texto livre é limitado a 2000 caracteres', out.updatedInput.answers['Q?'].length === 2000);
  // --- vários viewers de uma vez e tempo de espera por sessão ---
  r = await call('POST', '/viewer', { headers: A, body: JSON.stringify({ session_ids: ['va', 'vb'], on: true, hold: 5 }) }); ok('/viewer aceita session_ids em lote => 204', r.status === 204);
  r = await call('POST', '/viewer', { headers: A, body: JSON.stringify({ session_ids: [], on: true }) }); ok('/viewer sem ids => 400', r.status === 400);
  const tp = Date.now(); hook = call('POST', '/ask', { headers: J, body: pay(mkq(['A', 'B']), 'vb') }); await wait(300); ok('viewer em lote segura a pergunta da sessão vb', !!lastAsk() && lastAsk().session_id === 'vb');
  r = await hook; const held = (Date.now() - tp) / 1000; ok('tempo de espera da sessão (hold=5s): hook liberado em ~5s com 204 -> ' + held.toFixed(1) + 's', r.status === 204 && held >= 4 && held <= 9, 'status ' + r.status + ' ' + held);
  // hook-ask.js com PermissionRequest
  await view(true); const pr2 = run(permPay('Bash', { command: 'echo oi' })); await wait(400); ev = lastAsk();
  await call('POST', '/answer', { headers: A, body: JSON.stringify({ id: ev.id, decision: 'allow' }) }); const hr2 = await pr2;
  ok('hook-ask.js trata PermissionRequest e imprime a decisão', hr2.code === 0 && JSON.parse(hr2.o).hookSpecificOutput.decision.behavior === 'allow', JSON.stringify(hr2));
  srv.kill(); await wait(200);
  ok('servidor desligado: hook-ask.js sai calado (exit 0)', (await run(pay(mkq(['A', 'B'])))).code === 0);
  console.log(fails ? `\n${fails} FALHA(S) de ${n}` : `\nTODOS OS ${n} TESTES PASSARAM`); process.exit(fails ? 1 : 0);
})();
