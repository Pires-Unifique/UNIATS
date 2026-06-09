# Extensão: Módulo de Admissão (UniATS)

> Status: **Fase 1 (MVP) implementada.** Fases 2 e 3 e a camada de acesso por
> grupo de AD estão planejadas (ver roadmap no fim).

## 1. Contexto e objetivo

Hoje o sistema cobre **recrutamento/triagem**, encerrando no status
`CONTRATADO` da candidatura. A Admissão é a frente **pós-contratação**
(Departamento Pessoal / DHO): coleta de documentos, exame admissional (ASO),
assinatura de contrato e envio ao eSocial/folha.

São **equipes diferentes** que cuidam de cada frente, e os dados de admissão
são **mais sensíveis sob a LGPD** (CPF, dependentes, **saúde** no ASO, salário).
Por isso a admissão é um módulo separado, com interface própria e (futuramente)
acesso restrito.

### Onde encaixa no fluxo

```
[Recrutamento]                                  [Admissão]
… ENTREVISTA_REALIZADA → APROVADO → CONTRATADO ──► AGUARDANDO_ACEITE → … → CONCLUIDA
```

Gatilho: ao contratar (`CONTRATADO`), cria-se uma `Admissao` (hoje via
`POST /api/admissoes`; futuramente botão "Iniciar admissão" no detalhe da
candidatura, ou automático). A `Candidatura` permanece `CONTRATADO`.

## 2. Etapas da admissão (`StatusAdmissao`)

| # | Etapa | O que acontece |
|---|---|---|
| 1 | `AGUARDANDO_ACEITE` | Carta-proposta enviada; aguardando aceite |
| 2 | `PROPOSTA_ACEITA` | Aceitou → grava `data_aceite`; inicia coleta |
| 3 | `COLETA_DOCUMENTOS` | Candidato/RH envia documentos |
| 4 | `DOCUMENTOS_EM_ANALISE` | RH confere e aprova/recusa cada documento |
| 5 | `EXAME_MEDICO` | ASO agendado → apto/inapto |
| 6 | `ASSINATURA_CONTRATO` | Assinatura eletrônica do contrato/anexos |
| 7 | `ENVIO_ESOCIAL` | Evento S-2200 + matrícula no ERP de folha |
| 8 | `INTEGRACAO` | Pré-onboarding / primeiro dia |
| 9 | `CONCLUIDA` | Admissão efetivada (grava `data_conclusao`) |
| — | `CANCELADA` | Desistência, reprovado no ASO, distrato |

**Máquina de estados:** avança/retrocede **uma etapa por vez** (evita pular
validações). `CANCELADA` é acessível de qualquer etapa (exceto `CONCLUIDA`).
Gate para `ENVIO_ESOCIAL`: todos os documentos **obrigatórios** precisam estar
`APROVADO` **e** o ASO precisa estar `APTO`/`APTO_COM_RESTRICOES`.

## 3. Modelo de dados (implementado)

`packages/db/prisma/schema.prisma` — migration `add_admissao`.

- **`Admissao`** (tabela `admissoes`): 1:1 com `Candidatura`. Campos de
  contratação (`cargo`, `salario` Decimal, `tipo_contratacao`, `jornada`,
  `data_admissao`, datas de aceite/conclusão), integração (`esocial_recibo`,
  `esocial_status`, `matricula`), `status`, `responsavel_id`, soft-delete.
- **`DocumentoAdmissional`** (`documentos_admissionais`): checklist por admissão
  (`@@unique([admissao_id, tipo])`), com `status`, `obrigatorio`, `arquivo_url`
  + `arquivo_sha256` (storage), `validade`, `motivo_recusa`.
- **`ExameAdmissional`** (`exames_admissionais`): 1:1, `resultado` (ASO),
  `clinica`, datas, `aso_url`.
- **`EventoAdmissao`** (`eventos_admissao`): timeline das transições
  (`de_status`, `para_status`, autor, observação).

Enums: `StatusAdmissao`, `TipoDocumentoAdmissional`,
`StatusDocumentoAdmissional`, `ResultadoExameAdmissional`. Relações reversas
adicionadas em `Candidatura.admissao`, `Candidato.admissoes`, `Vaga.admissoes`,
`Usuario` (`AdmissaoResponsavel`).

> Exportados como **valor** em `@uniats/db` (usados em runtime) e como tipos
> (DTOs) em `@uniats/shared`.

### Checklist de documentos padrão (seed na criação)

Obrigatórios: RG, CPF, CTPS, PIS/NIS, comprovante de residência, dados
bancários, foto 3x4. Opcionais: título de eleitor, comprovante de escolaridade,
certidão de nascimento/casamento, reservista, dependentes.

## 4. API — módulo `admissao`

`apps/api/src/modules/admissao/` (controller + service + module).

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/admissoes?status=` | listar (board) |
| `GET` | `/api/admissoes/:id` | detalhe agregado (docs + exame + eventos) |
| `POST` | `/api/admissoes` `{candidaturaId}` | criar de candidatura CONTRATADO (idempotente) |
| `PATCH` | `/api/admissoes/:id/status` `{para, observacao?}` | transicionar etapa |
| `POST` | `/api/admissoes/:id/cancelar` `{motivo}` | cancelar |
| `PATCH` | `/api/admissoes/:id/dados` | atualizar dados da contratação |
| `PATCH` | `/api/admissoes/:id/documentos/:docId` `{status, motivo_recusa?}` | aprovar/recusar/marcar enviado |
| `PATCH` | `/api/admissoes/:id/exame` | agendar/registrar ASO |

`Decimal` (salário) e demais campos são serializados com segurança (sem BigInt).

## 5. Front — interfaces separadas

A navegação (`Sidebar`) foi dividida em duas seções: **Recrutamento** e
**Admissão**. Isso prepara o terreno para o permissionamento por grupo de AD
(basta gatear a seção depois).

- `/admissao` — **board (kanban)** por etapa; cada card = candidato.
- `/admissao/[id]` — **detalhe**: stepper das etapas, ações de avançar/voltar/
  cancelar, checklist de documentos (aprovar/recusar), bloco do ASO, dados da
  contratação e timeline.

> Constantes de apresentação ficam em `apps/web/src/lib/admissao.ts`. A web
> importa **apenas tipos** de `@uniats/shared` (`import type`) — importar
> valores do pacote quebra o bundling do Next (o source usa extensões `.js`).

## 6. Camada de acesso (planejada — NÃO implementada)

Hoje **não há autorização** no backend (só login SSO; `PapelUsuario` existe mas
não é checado). A separação entre admissão e recrutamento está **só na
interface**. O permissionamento será feito depois, por **grupo de Azure AD**.

Recomendação (quando for implementar): acesso por **área**, em duas dimensões.

| Dimensão | Valores | Responde a |
|---|---|---|
| **Área** (o que vê) | `RECRUTAMENTO`, `ADMISSAO` | "de qual time é" |
| **Papel** (o que faz) | `ADMIN`, `GESTOR`, `ANALISTA`, `VISUALIZADOR` | "nível dentro da área" |

- `Usuario.areas AreaSistema[]` (um usuário pode ter uma ou ambas).
- Módulo `auth`: `AzureAdAuthGuard` (valida JWT do Entra) + `RolesGuard` lendo
  um decorator `@Requer({ area, papelMinimo })`.
- Mapear áreas a **grupos do Entra** (ex.: `UNIATS-Recrutamento`,
  `UNIATS-DP-Admissao`) — TI gerencia o time no AD; o guard lê o claim de grupos.
- Endpoint `/api/me` devolve `{ papel, areas }`; o Sidebar filtra as seções.
- Dados sensíveis (`Admissao.salario`, `ExameAdmissional`) restritos à área
  `ADMISSAO`; toda leitura → `RegistroAuditoria` (já existe).

## 7. Roadmap

**Fase 1 — MVP (implementado):** modelo + API + board/stepper + transições +
checklist de documentos (gestão pelo RH) + exame manual + timeline.

**Fase 2:**
- Upload real de documentos via `StorageService` (MinIO/S3) — campo
  `arquivo_url` já existe.
- Portal self-service do candidato (link enviado por WhatsApp/e-mail via
  `Mensagem`/`TemplateMensagem`) para enviar documentos.
- Assinatura eletrônica do contrato (Clicksign / D4Sign / DocuSign).
- Notificações automáticas de pendências.

**Fase 3:**
- Transmissão automática do evento eSocial (S-2200).
- Integração com ERP de folha / RH (ou **Gupy Admissão**).
- Integração com clínica/SST para o ASO.
- Política de retenção/expurgo automática (LGPD) para documentos sensíveis.

## 8. Integrações (resumo)

| Frente | MVP (Fase 1) | Futuro |
|---|---|---|
| Coleta de documentos | Gestão pelo RH (campos no painel) | Upload real + portal do candidato |
| Exame admissional (ASO) | Status/datas manuais | Integração com clínica/SST |
| Assinatura de contrato | — | Assinatura eletrônica |
| eSocial / folha | Campos manuais (`esocial_recibo`, `matricula`) | Connector ERP / Gupy Admissão |
| LGPD | Auditoria + acesso restrito (planejado) | Expurgo automático |
