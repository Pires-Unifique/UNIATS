# Design — Agendamento de entrevista com disponibilidade do Teams

> **Status:** a **leitura de disponibilidade (delegada, popup)** já está implementada
> no frontend, porém **inativa** até existir um *app registration* no Entra ID
> (`NEXT_PUBLIC_AZURE_AD_CLIENT_ID`). O **bloqueio de agenda** (escrita) segue projetado
> (§3/§4). Enquanto o app registration não chega, o botão "Escolher horários da minha
> agenda" aparece desabilitado com instrução, e o fluxo manual funciona (ver §6).

---

## 0. ✅ Implementado agora — seleção de horários (delegado, sob demanda)

O recrutador **não digita** as opções de horário: ele clica em **"📅 Escolher horários
da minha agenda"** no modal de envio, autoriza num **popup Microsoft** (consentimento
`Calendars.Read`, sob demanda — o resto do app segue sem login), e o sistema lê a
agenda dele via Graph `getSchedule` e mostra os **slots livres** (07h–19h, janelas de
**30 min** ou **1 h**, dias úteis) para ele **só clicar e selecionar**. Os escolhidos
preenchem automaticamente as variáveis `opcao_1`, `opcao_2`, … do template.

Arquivos: `apps/web/src/lib/graph.ts` (token delegado + `getSchedule` + `gerarSlotsLivres`
+ `combinarViews`), `apps/web/src/components/DisponibilidadePicker.tsx` (UI de seleção),
integração em `apps/web/src/components/EnviarMensagemModal.tsx` e
`apps/web/src/components/AgendarEntrevistaModal.tsx`.

**Disponibilidade conjunta (líderes técnicos):** no agendamento (`AgendarEntrevistaModal`),
o recrutador pode incluir **participantes** — o **gestor da vaga** vem pré-sugerido
(`candidaturas/:id` → `vaga.gestor.email`) e é possível adicionar outros e-mails. O
`getSchedule` passa a consultar **todas as agendas** (`schedules: [recrutador, ...participantes]`)
e `combinarViews` faz o **AND** dos `availabilityView`: só sobram os horários em que
**todos** estão livres. Os participantes são usados apenas para a checagem de
disponibilidade (e o convite manual) — **não** são persistidos na `Entrevista`.

### ⚙️ O que pedir para a INFRA (app registration no Entra ID)

Para ativar, um administrador precisa criar **um** app registration e devolver o
**Client ID** e o **Tenant ID** (para colar em `apps/web/.env.local`):

| Item | Valor |
|---|---|
| Tipo de plataforma | **SPA (Single-page application)** |
| Redirect URI (dev) | `http://localhost:3000` |
| Redirect URI (prod) | URL pública do frontend (quando houver) |
| Permissão (Microsoft Graph, **delegada**) | `User.Read`, `Calendars.Read` |
| Consentimento | de usuário (cada recrutador consente no popup) — se o tenant exigir, admin consent uma vez |
| Conta suportada | apenas a organização (single tenant) |

Depois, preencher no `.env.local` do web:
```
NEXT_PUBLIC_AZURE_AD_CLIENT_ID=<client id do app>
NEXT_PUBLIC_AZURE_AD_TENANT_ID=<tenant id da Unifique>
```
Sem isso, `graphEnabled()` é `false` e a UI mostra a instrução. **Nenhuma** mudança de
código é necessária para ligar — só as duas variáveis.

> Observação: este é o mesmo modelo delegado escolhido por **não exigir SSO no resto do
> app** nem client secret no backend. O **bloqueio de agenda** (escrever evento) abaixo é
> a etapa seguinte e exigirá `Calendars.ReadWrite`.

## 1. Premissa central

Há **dois conceitos independentes** que costumam ser confundidos:

| Conceito | Onde vive | Provedor |
|---|---|---|
| **(i) Link de vídeo** da entrevista | `entrevistas.meet_url` | **Google Meet** (o bot MeetStream usa hoje) **ou** Teams |
| **(ii) Disponibilidade + bloqueio** da agenda do recrutador | Calendário **Teams/Outlook** | **sempre** Microsoft Graph |

A decisão de produto: **qualquer que seja o provedor do link de vídeo, a agenda do
recrutador no Teams precisa ser bloqueada** (evento "ocupado") no horário escolhido,
para evitar duplo agendamento. Logo, o Graph é usado em todo agendamento; o link de
vídeo pode ou não ser do Teams.

## 2. Autenticação no Microsoft Graph (app-only)

Recomenda-se **client credentials (app-only)**, porque **não depende do SSO de
usuário** — que ainda não está ligado nesta plataforma. O backend age como a aplicação
e acessa o calendário dos recrutadores por `userPrincipalName`/`id`.

**App registration (Entra ID):**
- Permissões de **aplicação** (Application), com **admin consent**:
  - `Calendars.ReadWrite` — ler free/busy (`getSchedule`) **e** escrever o evento de bloqueio.
  - `OnlineMeetings.ReadWrite.All` — **apenas** se o link de vídeo for gerado no Teams.
- Um **client secret** (ou certificado) guardado no cofre.

> Alternativa (delegated): usaria o token do recrutador logado (`Calendars.ReadWrite`,
> `OnlineMeetings.ReadWrite`). Mais simples de consentir, porém **exige o recrutador
> logado** e foi descartada por ora (sem SSO).

**Variáveis de ambiente novas** (adicionar em `env.validation.ts` quando implementar):

| Variável | Exemplo | Para quê |
|---|---|---|
| `AZURE_AD_TENANT_ID` | (já existe) | Tenant. |
| `AZURE_AD_CLIENT_ID` | (já existe) | App. |
| `AZURE_AD_CLIENT_SECRET` | `***` | Client credentials (cofre). |
| `GRAPH_BASE_URL` | `https://graph.microsoft.com/v1.0` | Base da API. |
| `GRAPH_SCOPE` | `https://graph.microsoft.com/.default` | Escopo client-credentials. |
| `AGENDA_JANELA_DIAS` | `7` | Janela padrão de busca de disponibilidade. |
| `AGENDA_HORARIO_COMERCIAL` | `09:00-18:00` | Restringe sugestões ao expediente. |

Token: `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
(`grant_type=client_credentials`, `scope=GRAPH_SCOPE`). Cachear em memória até `expires_in`.

## 3. Serviço futuro `GraphCalendarService`

Módulo novo `apps/api/src/modules/graph/` (espelha o padrão de client HTTP de
`waha.client.ts` / `meetstream.client.ts`: axios + retry + normalização de erro).

```ts
interface SlotLivre { inicio: string; fim: string } // ISO-8601

class GraphCalendarService {
  // (ii) Lê free/busy do recrutador e devolve janelas livres no horário comercial.
  obterDisponibilidade(
    recrutadorEmail: string,
    janela: { de: string; ate: string; duracaoMin: number },
  ): Promise<SlotLivre[]>;
  // → POST /users/{email}/calendar/getSchedule  (ou findMeetingTimes)

  // (i, opcional) Cria reunião Teams e devolve o joinUrl — só se provedor = TEAMS.
  criarReuniaoTeams(args: {
    recrutadorEmail: string; inicio: string; fim: string; assunto: string;
  }): Promise<{ joinUrl: string }>;
  // → POST /users/{email}/onlineMeetings

  // (ii) SEMPRE: cria o evento de bloqueio "ocupado" na agenda do recrutador.
  bloquearAgenda(args: {
    recrutadorEmail: string; inicio: string; fim: string;
    assunto: string; linkVideo: string; convidadoEmail?: string;
  }): Promise<{ eventId: string }>;
  // → POST /users/{email}/events  com showAs:"busy", body contendo linkVideo,
  //    isOnlineMeeting:true + onlineMeetingProvider:"teamsForBusiness" quando Teams.

  // Ao cancelar a entrevista, remover o bloqueio.
  removerBloqueio(recrutadorEmail: string, eventId: string): Promise<void>;
  // → DELETE /users/{email}/events/{eventId}
}
```

## 4. Mudanças de schema (quando implementar)

`Entrevista` já tem `google_event_id` (lado Google). Adicionar:

```prisma
graph_event_id  String?   // id do evento de bloqueio no Outlook/Teams (p/ cancelar)
teams_join_url  String?   // joinUrl quando o provedor de vídeo for Teams
provedor_video  String?   // "google_meet" | "teams"
```

E ligar o cancelamento (`InterviewService.cancelar`) para chamar `removerBloqueio`
quando `graph_event_id` existir.

## 5. Fluxo escolhido — "opções na mensagem + confirmação manual"

```
1. Recrutador abre "Propor horários" na candidatura.
     → GraphCalendarService.obterDisponibilidade(recrutador, janela)
     → backend sugere N slots livres (respeitando horário comercial).
2. Recrutador seleciona 2–3 slots e escolhe um template (editável na UI) que use
   variáveis livres {{opcao_1}}, {{opcao_2}}, {{opcao_3}}.
     → o renderer JÁ aceita placeholders arbitrários — nenhuma mudança de engine.
     → envia via POST /api/mensagens/enviar (WhatsApp/e-mail).
3. Candidato responde (WhatsApp) qual horário prefere.
4. Recrutador clica o slot escolhido + provedor (Meet/Teams) na UI:
     a. obtém/gera linkVideo (Meet do fluxo atual, ou criarReuniaoTeams).
     b. bloquearAgenda(recrutador, inicio, fim, assunto, linkVideo)  ← SEMPRE.
     c. POST /api/entrevistas (InterviewService.agendar) com meet_url = linkVideo,
        graph_event_id = eventId, provedor_video.
     d. (opcional) envia template "agendamento_entrevista"/"lembrete_entrevista"
        com {{data_hora}} e {{link_meet}} já preenchidos.
```

Esse desenho mantém a confirmação humana (o candidato escolhe; o recrutador confirma),
exatamente o fluxo aprovado, e só automatiza disponibilidade + bloqueio + (opcional) link Teams.

## 6. O que já funciona hoje (sem Graph)

A metade manual do fluxo está operacional na UI atual:

- **Templates editáveis** (banco) aceitam placeholders arbitrários — o recrutador já
  pode criar um template "proposta_horarios" com `{{opcao_1}}`, `{{opcao_2}}`, etc. em
  `/configuracoes/templates`, e enviá-lo pelo botão **Contatar** na candidatura.
- **Agendar entrevista** na candidatura já cria a `Entrevista` colando o link de vídeo
  (Meet **ou** Teams) manualmente (`POST /api/entrevistas`).

Quando o Graph entrar, os passos 1 (sugerir slots) e 4a/4b (gerar link Teams + bloquear
agenda) passam de manuais para automáticos — sem reescrever o resto.

## 7. Pontos de atenção

- **Fuso horário:** `getSchedule` aceita `Prefer: outlook.timezone="E. South America Standard Time"`.
  Padronizar o fuso para evitar slots deslocados.
- **Múltiplos recrutadores:** a vaga tem `recrutador_id` (e `gestor_id`); decidir de quem
  é a agenda consultada (default: recrutador da vaga).
- **LGPD/segredos:** `AZURE_AD_CLIENT_SECRET` no cofre, nunca no git. Log estruturado já
  redige headers de Authorization.
- **Idempotência:** ao reenviar a confirmação, não recriar o evento de bloqueio se já há
  `graph_event_id` na entrevista.
