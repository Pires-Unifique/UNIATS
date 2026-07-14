# WAHA — sessão "WORKING zumbi": detecção e mitigação

## O problema

A sessão do WhatsApp (WAHA, engine WEBJS/Chromium) às vezes entra num estado que
apelidamos de **"WORKING zumbi"**: a API do WAHA reporta `status: WORKING`, mas a
engine congelou e **parou de emitir QUALQUER evento** — nenhum webhook chega
(`message`, `message.ack`, `poll.vote`…). Como o `status` continua `WORKING`,
ninguém percebe até faltar algo (ex.: o voto de uma enquete de horário) horas
depois.

**Lição central:** `WORKING` **não é** sinal de saúde. O sinal real é _evento
fluindo_.

## Causa raiz (correção de um diagnóstico anterior)

Um handoff anterior atribuiu a falha ao endereçamento novo do WhatsApp (`@lid`) +
limitação do engine em decodificar voto de enquete. Isso era **red herring**: a
evidência (voto "silencioso") foi coletada _durante_ o zumbi, quando **tudo**
estava mudo — inclusive mensagens de texto. Depois de reiniciar o **container** e
enviar uma enquete **nova**, o `poll.vote` voltou a chegar normalmente.

Dois fatos somados criavam a confusão:

1. **Sessão muda mas WORKING:** o Chromium travou e parou de repassar eventos,
   sem mudar o status.
2. **Enquete antiga morre após reset:** no WEBJS o voto vem cifrado e só decodifica
   se a mensagem original da enquete estiver no _store_ da sessão atual. Depois de
   qualquer reset, enquetes antigas ficam incoletáveis (recrie a enquete).

> Um fallback por texto (ler "responda 1, 2 ou 3") **não** teria evitado o
> incidente: durante o zumbi o evento `message` de texto também não chega.

## O que foi implementado

1. **`shm_size: 1gb`** no serviço `waha` (`infra/docker-compose.prod.yml`).
   O Chromium usa `/dev/shm`; o default do Docker (64 MB) estoura e derruba/pendura
   o renderer — um dos gatilhos do travamento. `1gb` é **teto**, não reserva: o
   tmpfs só consome o que é escrito (na prática dezenas a ~150 MB). **Reduz a
   frequência** do travamento; não é cura do stall.

2. **Watchdog** (`apps/api/src/modules/sistema/waha-watchdog.service.ts`): cron a
   cada 10 min que **detecta** o zumbi e **alerta os administradores** no sino.

3. **Badge honesto na tela** Sistema > WhatsApp: quando `saude === 'INSTAVEL'`, o
   estado NÃO fica verde ("Conectado") — vira vermelho "Conectado, mas travado" +
   um banner explicando que é preciso reiniciar o **container**.

Recuperação **automática** (autoheal / botão de restart de container) ficou de
fora desta entrega — a API não reinicia o container irmão sem acesso ao Docker
socket, o que é uma decisão de segurança à parte. Por ora, **detecção + alerta**;
o restart é manual (ver runbook).

## Como a detecção funciona

Impacto ~zero no dia a dia: o watchdog só faz leituras baratas; só toca o WhatsApp
(o _probe_) quando há motivo real de suspeita.

```
cron 10 min:
  1. status da sessão + idade do último webhook recebido   (barato, sem WhatsApp)
  2. suspeita?  status == WORKING
                E último webhook > 20 min atrás (WAHA_WATCHDOG_MUDEZ_MIN)
                E houve ENVIO de WhatsApp recente (era pra ter vindo ack e não veio)
        NÃO → saudável / ocioso — não sonda, não alarma
        SIM → 3. PROBE ativo: bate um endpoint que força round-trip na engine,
                 com timeout curto e sem retry
                 respondeu → falso alarme, segue
                 PENDUROU  → 🧟 zumbi confirmado
                             → alerta ADMINS no sino (1× por incidente)
```

- **Só admins** recebem: `where: { ativo: true, areas: { has: 'admin' } }`. É aviso
  de operação, não de processo de recrutamento.
- **Edge-triggered:** um alerta por incidente (não repete a cada ciclo). Reabre
  quando a saúde volta e cai de novo.
- **Probe fail-safe** (`WahaClient.engineTravada`): só acusa `travada` quando a
  chamada **estoura o timeout**. Qualquer resposta HTTP (inclusive 4xx/5xx) ou
  conexão recusada = engine não pendurada → `false`. Assim, se o path do endpoint
  mudar numa versão do WAHA, o pior caso é **não detectar** (falso-negativo) —
  nunca um falso-positivo que dispararia alerta à toa.

### Campo `saude` no status

`GET /api/sistema/waha/status` passou a devolver `saude`:
`'SAUDAVEL' | 'INSTAVEL' | 'DESCONHECIDA' | null`. É preenchido pelo veredito do
último ciclo do watchdog (a tela dá poll a cada 10 s e reflete isso).

## Recuperação (runbook)

Quando o alerta disparar (ou ao suspeitar do zumbi):

1. Confirme que é a sessão, não a app:
   ```bash
   docker logs -f --tail 0 uniats-waha-1 2>&1 | grep -E '"event":|status code'
   ```
   Mande uma mensagem de texto normal. Se **nada** sai apesar de `WORKING` → zumbi.

2. **Reinicie o CONTAINER (não a sessão):**
   ```bash
   docker restart uniats-waha-1 -t 15
   ```
   Restart de sessão (`POST /sessions/default/restart`) **não** resolve — reaproveita
   o Chromium travado. O login persiste no volume `wahasessions` (não pede QR).

3. A sessão pode não subir sozinha (WAHA Core):
   ```bash
   curl -s -X POST -H "X-Api-Key: $WAHA_API_KEY" http://localhost:4000/api/sessions/default/start
   ```

4. Valide: mensagem normal + **enquete nova** → votar → `poll.vote` com 202 no log.
   Enquetes **antigas** não coletam voto após o reset (recrie).

## Validar o probe (repro)

O probe assume que `GET /api/{session}/chats` **pendura** quando a engine congela.
Isso é plausível, mas não foi testado contra o congelamento real. Validar após o
deploy:

- **Simulado (rápido, caminho end-to-end):** `docker pause uniats-waha-1` → toda
  chamada pendura → `engineTravada()` estoura o timeout → alerta dispara pros
  admins. Testa o _caminho_ (timeout → detecta → notifica), mas no `pause` até o
  HTTP congela (no zumbi real o HTTP responde e só a engine trava).
- **Oportunista (fiel):** com o watchdog no ar, no próximo zumbi real conferir nos
  logs se ele pendurou no probe e alertou.

Se o probe não pegar o zumbi real, trocar o endpoint por um que force round-trip na
engine com certeza (ex.: `POST /api/checkNumberStatus`).

## Parâmetros

| Env | Default | O quê |
|-----|---------|-------|
| `WAHA_WATCHDOG_MUDEZ_MIN` | `20` | Minutos sem webhook (com `WORKING`) para suspeitar. |

Cron fixo em `EVERY_10_MINUTES` — checar mais fino não anteciparia nada (o gatilho
de mudez é 20 min).

## Limitações conhecidas / próximos passos

- **Sem auto-cura:** só alerta; o restart de container é manual. Evolução possível:
  sidecar `autoheal` (auto-restart em `unhealthy`) ou botão na tela via
  `docker-socket-proxy` (decisão de segurança à parte).
- **Freeze após longa ociosidade** só é confirmado quando o uso volta (o gate de
  "envio recente" evita falso-positivo, mas atrasa esse caso de borda). Fora de
  horário o impacto é baixo.
- **Enquetes pendentes** morrem no reset — qualquer recuperação deveria reenviar as
  `AGUARDANDO`. Não implementado aqui.
- **Decodificar voto independente do store** (persistir o `messageSecret` da
  enquete) resolveria o caso "enquete velha após reset", mas **não** o zumbi (no
  stall não há evento pra decodificar). Não é falha de segurança — a conta é
  participante legítimo da enquete —, só exige tratar a chave como segredo.
