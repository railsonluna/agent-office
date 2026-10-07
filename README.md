# Agent Office

Um escritório animado que mostra tuas sessões do Claude Code trabalhando em tempo real.
Zero dependências: só Node 18+ e `curl`.

## Instalar

> Quer que o teu Claude Code faça o setup? Peça: _"leia o CLAUDE.md e faça o setup do Agent Office"_.
> O `CLAUDE.md` (em inglês) tem o passo a passo e pede confirmação antes de mexer no `~/.claude/settings.json`.

```bash
cd agent-office
npm run hooks:on     # adiciona os hooks em ~/.claude/settings.json (faz backup antes)
npm start            # sobe o servidor em http://localhost:7777
```

Abre http://localhost:7777 no browser, clica uma vez na página (libera o som) e
inicia uma sessão **nova** do Claude Code em qualquer projeto. Cada sessão vira um personagem.

Sem Claude rodando? Clica em "Rodar demo".

## O que cada coisa significa

| No escritório | Evento do Claude Code |
|---|---|
| Entra pela porta | `SessionStart` (ou primeiro evento da sessão) |
| Cartão voando até a mesa | `UserPromptSubmit` |
| Vai na estante | `Read`, `Grep`, `Glob` |
| Digitando no monitor | `Edit`, `Write`, MCPs |
| Vai no rack de servidor | `Bash` |
| Fumaça | ferramenta falhou (`PostToolUse`) |
| Vai na janela | `WebFetch`, `WebSearch` |
| Vai no quadro | `TodoWrite` / lendo o pedido |
| Estagiário aparece | `Task` (subagente), sai no `SubagentStop` |
| Mão levantada + sininho | `Notification` (precisa de você) |
| Confete e café | `Stop` (terminou) |
| Sai pela porta | `SessionEnd` |

O nome do personagem é a pasta do projeto, então worktrees diferentes viram pessoas diferentes.
A janela mostra o céu de acordo com o teu horário.

## Cenários

O seletor **Cenário** no rodapé troca o visual na hora, mesmo com agentes no meio do trabalho.
A escolha fica salva no navegador; sem escolha salva, em outubro abre no Halloween.

| Cenário | Estante | Porta | Café | Quadro | Janela | Rack |
|---|---|---|---|---|---|---|
| Escritório | estante | porta | cafeteira | quadro branco | janela com céu no teu horário | rack de servidor |
| Halloween | livro de feitiços | portão do cemitério | mesa de doces | pergaminho | bola de cristal (brilha e gira com `WebFetch`/`WebSearch`) | caldeirão (bolhas aceleram com `Bash`) |

No Halloween cada agente ganha uma fantasia (bruxa, abóbora, gato, chifrinhos ou vampiro), e o
estagiário usa a mesma do agente que o chamou. A fumaça de falha fica verde e o confete, laranja/roxo/verde.

Pra criar outro cenário, adicione uma entrada em `SCENES` no `public/index.html` com
`room()`, `desk(slot)`, `costume(ci, bob)` (opcional), `ink`, `smoke` e `party`.
As estações (`ST`) ficam nas mesmas posições em todos os cenários. É isso que deixa trocar
no meio do trabalho sem os agentes se perderem, então desenhe cada estação em cima delas.

## Ver o que está acontecendo (v0.2)

- **Placar com estado:** cada agente tem um selo (trabalhando, esperando você, testes falhando, descansando, daily, pronto, ocioso),
  a ação atual, as tools e os testes (✔ passaram, ✖ falharam). Quem espera você sobe pro topo e pisca.
- **Alerta:** agente esperando aprovação ganha um anel laranja no chão, e a borda da tela pisca. Resumo em números no rodapé.
- **Ícone no balão:** livro (leitura), lápis (edição), terminal (Bash), globo (web), checklist (plano), pessoa (subagente).
- **Linha do tempo:** faixa embaixo com um ponto por evento de cada agente nos últimos 10 min (botão "Linha do tempo" liga/desliga).
  Clicar no nome do agente, no placar ou na linha abre o cartão dele.

## Só no Escritório

- **Fliperama jogável:** clique no PAC ou no SPACE. Setas/WASD movem, espaço atira, Esc fecha. O recorde fica salvo no navegador.
- **Daily:** clique na cafeteria (ou no botão "Daily"). Todo mundo faz uma rodinha na frente dela com um cafezinho na mão e cada um
  diz o que está fazendo de verdade; quem está sem demanda avisa que está ocioso. Dura uns 15 a 25 s e fecha com "um por todos e todos por um!".
- **Perguntas viram portas (Cave Mode):** quando o Claude faz uma pergunta com opções, cada opção vira uma porta no estágio.
  Por padrão só aparece (você responde no terminal). Pra responder pela interface, ative o modo interativo (opt-in):
  `npm run hooks:on -- --interactive`, abra o Cave Mode no agente e clique numa porta (ou tecle 1-4; múltipla escolha tem "Confirmar").
  O agente atravessa a porta e a resposta volta pro Claude Code. Enquanto as portas estão na tela o terminal fica esperando; Esc (ou 2 min)
  cancela e a pergunta aparece no terminal normalmente. Testado numa sessão real do Claude Code 2.1.x: a resposta pela porta chegou certinho.
- **Responder dúvidas e permissões pela página (opt-in):** com `npm run hooks:on -- --interactive` o terminal passa a **esperar** a página por até ~25 s (e depois a pergunta
  volta pro terminal). No cenário do Diretor, com **Responder no canvas: ligado**, aparece um painel com as opções para marcar (uma ou várias), uma caixa de **texto livre** ("outra resposta") e,
  quando o Claude pede permissão, o comando com **Permitir / Negar**. Também há **Responder no terminal**, **minimizar** e a contagem até voltar pro terminal. Isso inclui aprovar comandos pela tela:
  só ative se quiser. Uma pergunta que o assistente fez em texto, no meio da conversa (sem a ferramenta de perguntas), ainda não tem como voltar pra sessão por aqui.
- **Fases e armas (Cave Mode):** ao escolher uma porta o agente vai pra outro bioma: **verde = Selva** (arco e flecha), **vermelha = Inferno**
  (canhão de fogo, dano em área), **azul = Gelo** (lançador de gelo que congela), **roxa = Catacumbas** (laser). Do 2º estágio em diante ele luta
  contra monstros enquanto trabalha. Pra ver tudo sem depender do Claude: no Cave Mode use **Simular pergunta** (uma pergunta falsa com portas)
  ou **Auto** (troca de fase sozinho). A pergunta simulada não vai pro servidor nem pro Claude Code.
- **RPG:** no Cave Mode o agente tem **nível, HP, XP e ouro** (painel no canto). Abater monstros dá XP e ouro; subir de nível restaura o HP e deixa ele mais
  forte (mais HP, dano e cadência). Se o HP zerar ele desmaia 3 s e perde 10% do ouro. O progresso fica salvo no navegador, por nome de projeto. A loja de
  equipamentos (gastar o ouro) ainda não existe.
- **Porta (qualquer cenário):** clique nela pra pular pro próximo cenário.
- **Cave Mode:** clique num agente, depois em "Cave Mode" no card. A tela vira uma dungeon em perspectiva só com aquele agente
  (entrada, túnel e "Fase 1 · Catacumbas"). Ele trabalha de verdade lá: picareta quando está trabalhando, mão levantada quando espera você.
  Esc ou "Sair da caverna" volta pro escritório.

## Escritório do Diretor

Cenário "Escritório do Diretor" no seletor. O Diretor fica no centro da sala; à esquerda o balcão **DÚVIDAS**, à direita o **ENTREGAS** (com contador na placa).

| Estado | Quando | O que o agente faz |
|---|---|---|
| trabalhando | `PreToolUse`, `PostToolUse`, `UserPromptSubmit` | digita na mesa |
| dúvida | `Notification` (permissão / pergunta do assistente), `Stop` cuja última resposta termina em pergunta, ou a ferramenta de perguntas | anda até DÚVIDAS, mão levantada, "?" |
| entrega | `Stop` normal | anda até ENTREGAS carregando uma pasta |
| voltando | novo prompt ou ferramenta | sai da fila, caminha de volta e senta |

- **Clicar** num agente da fila DÚVIDAS mostra a pergunta destacada no topo do card; numa ENTREGA, a última resposta do assistente (com rolagem) e **Marcar como lida**.
  Fechar o card de uma entrega também marca como lida. Quando você responde e o prompt chega, o card fecha sozinho e o agente volta.
- `idle_prompt` (Claude parado há ~1 min) **não** tira ninguém da fila. Se um agente em ENTREGAS fizer uma pergunta nova, ele muda pra DÚVIDAS.
- A detecção de pergunta é a função `looksLikeQuestion` no `public/index.html` (bloco entre `flow:start` e `flow:end`); ajuste ali e rode `npm test`.
- O estado vale em **todos** os cenários (o placar mostra "entrega"); só este cenário tem as filas físicas. Outros cenários podem ganhar filas declarando `queues`.
- Não há aba de terminal: o card mostra a pergunta e a resposta, e você responde no seu terminal. Privacidade: o servidor passa a repassar ao navegador local o texto
  final da resposta do `Stop` (até 2000 caracteres); nada sai da sua máquina.

## Desinstalar

```bash
npm run hooks:off
```

## Notas

- Se o servidor estiver desligado, o hook falha em silêncio (`--max-time 1 ... || true`),
  então não atrapalha o Claude Code.
- Porta diferente: `PORT=8888 npm run hooks:on && PORT=8888 npm start`.
- Os hooks só mandam pro servidor local: nome da ferramenta, caminho do arquivo e um trecho do comando.
