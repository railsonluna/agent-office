// Unit tests for the pure agent-flow state machine and the "is it a question?" heuristic (extracted from public/index.html between the flow:start / flow:end markers).
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8'); const a = src.indexOf('// flow:start'), b = src.indexOf('// flow:end');
if (a < 0 || b < 0) { console.log('marcadores flow:start/end não encontrados'); process.exit(1); }
const ctx = {}; vm.createContext(ctx); vm.runInContext(src.slice(a, b) + '\nthis.api = { looksLikeQuestion, lastParagraph, flowNew, flowReduce, FLOW_ASK_TYPES };', ctx);
const { looksLikeQuestion, flowNew, flowReduce } = ctx.api;
let n = 0, fails = 0; const ok = (name, c, x = '') => { n++; if (!c) { fails++; console.log('FAIL ' + name + ' ' + x); } else console.log('PASS ' + name); };
const run = (evs, t0 = 1000) => evs.reduce((f, e, i) => flowReduce(f, e, t0 + i), flowNew());
const E = (n, x = {}) => ({ hook_event_name: n, ...x });
// --- transições ---
ok('PreToolUse mantém trabalhando', run([E('SessionStart'), E('PreToolUse', { tool_name: 'Read' })]).st === 'work');
let f = run([E('Notification', { notification_type: 'permission_prompt', message: 'Claude precisa da sua permissão para usar Bash' })]);
ok('Notification permission_prompt => ask com o texto da mensagem', f.st === 'ask' && f.text.includes('permissão') && f.full === f.text);
ok('Notification sem notification_type (versão antiga) => ask', run([E('Notification', { message: 'x' })]).st === 'ask');
ok('Notification idle_prompt NÃO vira dúvida', run([E('Notification', { notification_type: 'idle_prompt', message: 'esperando' })]).st === 'work');
ok('Notification auth_success é ignorada', run([E('Notification', { notification_type: 'auth_success' })]).st === 'work');
ok('idle_prompt não tira agente da ENTREGA', run([E('Stop', { last_assistant_message: 'Pronto.' }), E('Notification', { notification_type: 'idle_prompt' })]).st === 'deliver');
f = run([E('Stop', { last_assistant_message: 'Terminei a refatoração.\n\nQuer que eu abra o PR agora?' })]);
ok('Stop pergunta => ask; texto = último parágrafo, completo guardado', f.st === 'ask' && f.text === 'Quer que eu abra o PR agora?' && f.full.includes('Terminei') && f.last === f.full);
f = run([E('Stop', { last_assistant_message: 'Pronto, tudo aplicado e testado.' })]);
ok('Stop afirmação => deliver', f.st === 'deliver' && f.last.includes('aplicado'));
ok('Stop sem last_assistant_message (versão antiga) => deliver', run([E('Stop')]).st === 'deliver');
ok('deliver + UserPromptSubmit => work', run([E('Stop', { last_assistant_message: 'ok.' }), E('UserPromptSubmit')]).st === 'work');
ok('ask + PreToolUse => work', run([E('Notification', { message: 'p' }), E('PreToolUse', { tool_name: 'Edit' })]).st === 'work');
ok('ask + PostToolUse => work', run([E('Notification', { message: 'p' }), E('PostToolUse', { tool_name: 'Bash' })]).st === 'work');
ok('ask + Stop afirmação => deliver', run([E('Notification', { message: 'p' }), E('Stop', { last_assistant_message: 'ok.' })]).st === 'deliver');
ok('deliver + Notification => ask', run([E('Stop', { last_assistant_message: 'ok.' }), E('Notification', { message: 'p' })]).st === 'ask');
const f1 = flowReduce(flowNew(), E('Notification', { message: 'a' }), 5000), f2 = flowReduce(f1, E('Notification', { message: 'b' }), 9000);
ok('2ª pergunta seguida mantém a posição na fila (at) e atualiza o texto', f2.at === 5000 && f2.text === 'b');
ok('estado antigo não é mutado', f1.text === 'a');
f = run([E('PreToolUse', { tool_name: 'AskUserQuestion', questions: [{ question: 'Qual cor?', options: [{}, {}] }] })]);
ok('ferramenta AskUserQuestion => ask com a pergunta', f.st === 'ask' && f.text === 'Qual cor?');
ok('...e PostToolUse dela => work', run([E('PreToolUse', { tool_name: 'AskUserQuestion', questions: [{ question: 'x' }] }), E('PostToolUse', { tool_name: 'AskUserQuestion' })]).st === 'work');
ok('SessionEnd => gone e fica gone', run([E('SessionEnd'), E('UserPromptSubmit'), E('Stop', { last_assistant_message: 'x?' })]).st === 'gone');
ok('SubagentStop não muda nada', run([E('Stop', { last_assistant_message: 'ok.' }), E('SubagentStop', { last_assistant_message: 'sub?' })]).st === 'deliver');
// --- payloads REAIS capturados (Claude Code 2.1.x) ---
ok('REAL Stop: "Que cor você prefere para o botão?" => ask', run([E('Stop', { stop_hook_active: false, last_assistant_message: 'Que cor você prefere para o botão?', background_tasks: [], session_crons: [] })]).st === 'ask');
ok('REAL Stop: "Instrução entendida — responder com frase única quando tarefa terminar." => deliver', run([E('Stop', { last_assistant_message: 'Instrução entendida — responder com frase única quando tarefa terminar.' })]).st === 'deliver');
ok('REAL Stop: "Comando executado. Output: `ola`." => deliver', run([E('Stop', { last_assistant_message: 'Comando executado. Output: `ola`.' })]).st === 'deliver');
// --- heurística ---
const H = [
  ['Terminei e os testes passam.\n\nQuer que eu abra o PR agora?', true], ['Quer que eu explique melhor?\n\nPronto, tudo aplicado e testado.', false],
  ['Rodei:\n\n```js\nconst x = a ? b : c;\n```\n\nTudo certo, finalizado.', false], ['Tenho duas opções. Você prefere manter o formato atual ou migrar para o novo', true],
  ['Eu posso confirmar que o build está verde e o deploy foi feito.', false], ['All green. Should I merge it into main?', true], ['Posso seguir com a opção **B**?**', true],
  ['Eu devo ressaltar que a migração é irreversível.', false], ['- Item 1\n- Item 2\n\nResumo: mudei 3 arquivos.', false], ['', false], [null, false], ['Quer que eu continue ou paro por aqui', true],
  ['Funciona assim: primeiro (a?) depois (b?) e fim.', false], ['Isso resolve?\n\n```\nlog\n```', true],
];
for (const [t, want] of H) ok('heurística ' + JSON.stringify(String(t).slice(0, 38)) + ' => ' + (want ? 'dúvida' : 'entrega'), looksLikeQuestion(t) === want);
console.log(fails ? `\n${fails} FALHA(S) de ${n}` : `\nTODOS OS ${n} TESTES PASSARAM`); process.exit(fails ? 1 : 0);
