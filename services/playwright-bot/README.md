# UniATS — Bot Playwright (fallback de transcrição)

Serviço **standalone** (fora do workspace pnpm) que entra na reunião do Teams pelo
navegador, liga as **legendas ao vivo** e captura `falante + texto`. No fim devolve
a transcrição à API por callback HTTP interno. Não grava áudio/vídeo — só raspa o
texto que o próprio Teams já transcreve (Azure Speech).

É o **fallback** do método principal (transcript oficial via Microsoft Graph).
Vantagem: **não depende da Application Access Policy** nem de ser o organizador —
entra como convidado. Roda 100% na rede interna (self-hosted + callback interno).

## Como conversa com a API
- **Entrada:** consome jobs `playwright-join` na fila BullMQ (mesmo Redis/prefixo da API).
  Payload: `{ entrevistaId, joinUrl, displayName?, maxDuracaoMin? }`.
- **Saída:** `POST {API_INTERNAL_URL}/internal/playwright/transcript` com o header
  `x-playwright-secret`, body `{ entrevistaId, texto, segmentos[], entrou, legendasLigadas }`.

## Variáveis de ambiente
Ver [`src/config.ts`](src/config.ts). Essenciais: `REDIS_URL`, `REDIS_QUEUE_PREFIX`
(igual à API), `API_INTERNAL_URL`, `PLAYWRIGHT_CALLBACK_SECRET`. Ajustáveis:
`PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_DISPLAY_NAME`, `PLAYWRIGHT_LOBBY_TIMEOUT_MS`,
`PLAYWRIGHT_MAX_DURACAO_MIN`, `PLAYWRIGHT_OCIOSIDADE_MIN`.

## ⚠️ Manutenção dos seletores
O DOM do Teams web muda com frequência. Quando a captura parar de funcionar, o ajuste
quase sempre é em **`SEL`** no topo de [`src/teams-meeting.ts`](src/teams-meeting.ts):
abra a reunião no tenant, inspecione o container de legendas e atualize os candidatos.

## Pré-requisitos no tenant
- Permitir **entrada anônima/convidado** nas reuniões.
- O bot pode cair no **lobby** — admita manualmente ou configure bypass na criação
  da reunião (`lobbyBypassSettings`). Não exige Teams Admin/policy.
