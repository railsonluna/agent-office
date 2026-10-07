# Changelog

## 0.8.0
- **Painel de respostas** na página: opções para marcar (uma ou várias), caixa de **texto livre** e, nos pedidos de permissão, o comando com **Permitir / Negar**.
  Contagem até voltar pro terminal, "Responder no terminal" e minimizar. Aparece no cenário do Diretor com "Responder no canvas: ligado" (a página só segura o hook das sessões que está vendo).
- Hook `PermissionRequest` (opt-in, `hooks:on -- --interactive`): verificado com o Claude Code real (permitir cria o arquivo, negar bloqueia).
- Servidor: `/ask` trata `PermissionRequest`; `/viewer` aceita `session_ids` em lote e `hold` por sessão (5-120 s); `/answer` aceita `decision` e texto livre (`custom`).
  O resumo da permissão mostra comando/caminho/URL e só o tamanho do conteúdo de arquivos.
- Testes do servidor: 51 casos (`npm test`).

## 0.7.0
- Novo cenário **Escritório do Diretor**: o Diretor fica no centro (olha em volta, toma café e aponta pra quem chega) e dois balcões, **DÚVIDAS (n)** e **ENTREGAS (n)**,
  recebem filas físicas de agentes. Mesas em fileiras, caminhada com desvio das mesas (pathfinding A*), ninguém teleporta.
- Máquina de estados do agente **independente do cenário** (`flowReduce`): trabalhando → dúvida (Notification de permissão/pergunta, Stop que termina em pergunta,
  ou a ferramenta AskUserQuestion) ou entrega (Stop normal) → volta pra mesa com um novo prompt/ferramenta. `idle_prompt` não tira ninguém da fila.
  A heurística "isso é uma pergunta?" é a função isolada `looksLikeQuestion`. Qualquer cenário pode ganhar filas declarando `queues` (+ `slots`, `nav`).
- Card do agente: pergunta destacada no topo (dúvida), **última resposta do assistente** com rolagem e botão "Marcar como lida" (entrega). Responder faz o card fechar sozinho
  e fechar uma entrega a marca como lida.
- Servidor: repassa `notification_type` e `last_assistant_message` (até 2000 caracteres, só do `Stop`) ao navegador local.
- Testes no repositório: `npm test` (máquina de estados com payloads reais + servidor/hook).

## 0.6.0
- RPG no Cave Mode: **nível, HP, XP e ouro**. Abater monstros dá XP e ouro; subir de nível restaura o HP e aumenta HP máximo, dano e cadência de tiro.
  Monstros que chegam até o agente tiram HP; com HP zerado ele desmaia por 3 s e perde 10% do ouro. O progresso fica no navegador, por nome de projeto.
  Minerar na Fase 1 também rende um pouco de XP e ouro. (O ouro está guardado pra a futura loja de equipamentos.)
- Correções de uma revisão de código:
  - Uma pergunta pendente é liberada sozinha quando a página some (aba fechada, recarregada ou sem batimento): antes o terminal ficava esperando até 2 min.
  - A resposta agora viaja como **índices das opções** (`picks`) e o servidor monta o texto a partir do original completo: rótulos com vírgula e textos longos
    (antes truncados) funcionam; perguntas com mais de 4 opções são limitadas a 4.
  - Falha ao enviar a resposta agora cancela a pergunta (volta pro terminal) e mostra o erro.
  - Corpo JSON `null`/inválido nas rotas do servidor não derruba mais o processo.
  - A linha do tempo não ganha mais uma marca "início" falsa a cada evento.
  - Ao sair do Cave Mode ou fechar a aba, o aviso "saí" é enviado sem corrida com o batimento.

## 0.5.0
- Cave Mode com fases: escolher uma porta leva a um bioma novo. Porta **verde** = Selva, **vermelha** = Inferno, **azul** = Gelo (iglu),
  **roxa** (4ª opção) = Catacumbas. Cada fase tem cenário, clima e monstros próprios.
- A partir da Fase 2 o agente **luta** quando está trabalhando, com uma arma por bioma: arco e flecha (selva), canhão de fogo com dano em área (inferno),
  lançador de gelo que congela (gelo) e laser (catacumbas). Os monstros saem do portal do fundo e vêm na direção dele.
- Botão "Responder no terminal" (tecla T) nas portas: devolve a pergunta pro terminal na hora. `POST /answer` aceita `{id, cancel:true}`.
- Modo de simulação no Cave Mode: "Simular pergunta" gera uma pergunta falsa com portas (nada vai pro servidor nem pro Claude Code) e
  "Auto" fica trocando de fase sozinho.

## 0.4.0
- Cave Mode: quando o agente faz uma pergunta com opções (`AskUserQuestion`), cada opção vira uma porta no estágio.
  Sem o hook interativo as portas só mostram a pergunta (preview). Com `npm run hooks:on -- --interactive` você clica numa porta
  (ou tecla 1-4), o agente atravessa e a resposta volta pro Claude Code. Suporta várias perguntas em sequência e múltipla escolha.
- Servidor: `POST /ask` (hook), `POST /answer` e `POST /viewer` (página, com token por execução + checagem de Origin/Host).
  O hook só espera se houver um navegador na caverna daquele agente; qualquer falha cai no terminal.
- `hook-ask.js` novo; `install.js` ganhou `--interactive`.

## 0.3.0
- Cave Mode: no card do agente, o botão "Cave Mode" leva só aquele agente pra uma dungeon em perspectiva (câmera na frente dele).
  Ele entra pela boca da caverna, anda pelo túnel e chega ao "Fase 1 · Catacumbas", com caveiras, tochas e morcegos.
  No estágio ele minera conforme o estado real: trabalhando (picareta), esperando você (mão levantada), testes falhando (tremor).
  Sair: botão "Sair da caverna" ou Esc.

## 0.2.0
- Placar com estado por agente, anel/borda de alerta, ícones nos balões e placar de testes (✔/✖).
- Linha do tempo dos últimos 10 min (liga/desliga) e clique no placar/linha abre o cartão do agente.
- Office: fliperama jogável (PAC e SPACE), cafeteria no lugar do bar, daily em roda na cafeteria, porta troca de cenário.
- Cenários novos: Vila ninja e Obra, com descompressão própria (lámen e dojo de shuriken; academia, suplementos e roda de conversa;
  poções e treino de feitiços no Halloween).
- Os recursos desta versão ficam num bloco `<script>` separado no fim do `public/index.html` (`extras:start`/`extras:end`).

## 0.1.0
- Escritório animado, cenário Halloween, pet, vitrola e área de descanso.
