# Critérios da avaliação por IA (ranking de candidatos)

Este documento descreve **como o Collab pontua a aderência de um candidato a uma vaga**.
Ele existe por duas razões: para o time saber o que o número significa, e porque a LGPD
(Art. 20) dá ao candidato o direito de informação sobre os critérios usados em decisão
automatizada — este é o texto que responde a essa pergunta.

> **Fonte da verdade é o código**, não este documento:
> [`apps/api/src/modules/ranking/services/ranking-llm.prompt.ts`](../apps/api/src/modules/ranking/services/ranking-llm.prompt.ts).
> Ao alterar o prompt, **bumpe `RANKING_PROMPT_VERSION`** (hoje `ranking-cv-v2`) — ele é
> gravado em `scores.prompt_versao` e é o que permite saber depois qual versão gerou cada
> nota. E atualize este arquivo.

## O que o candidato recebe

Três números, não um:

| Score | Origem | O que mede |
|---|---|---|
| `SIMILARIDADE_VETORIAL` | Voyage (embeddings) | Proximidade semântica entre o texto canônico da vaga e o do currículo. |
| `RANKING_CV` | Claude | Aderência avaliada com critérios explícitos (abaixo). |
| `CONSOLIDADO` | média ponderada | `0,4 × similaridade + 0,6 × ranking_llm`. |

Nenhum deles decide qualquer coisa sozinho: são **sugestão de ordenação**. Aprovar,
reprovar ou entrevistar é ato humano, e o sistema registra quem revisou
(`scores.revisado_por` / `revisado_em`).

## Eixos e pesos do `RANKING_CV`

| Eixo | Peso | O que conta |
|---|---|---|
| Requisitos do gestor | **40%** | Cada requisito definido na vaga que o currículo atende. É a fonte de verdade. |
| Experiência relevante | **25%** | Cargos, empresas e tempo na área da vaga. |
| Competências técnicas | **20%** | Skills exigidas versus presentes. |
| Formação | **10%** | Nível compatível com a senioridade da vaga. |
| Outros sinais | **5%** | Idiomas, certificações. |

Falta de **requisito obrigatório** explicitado pelo gestor gera penalização forte.

## Localização

Só entra **em vaga presencial**, e apenas cidade/estado — nunca endereço. Em vaga remota a
localização do candidato sequer é enviada ao modelo.

| Situação | Ajuste |
|---|---|
| Mesma cidade ou região metropolitana | sem penalidade (registra como ponto forte) |
| Cidade vizinha, deslocamento diário viável | até −5 |
| Mesmo estado, deslocamento diário inviável | −10 a −15 |
| Outro estado ou distância incompatível | −15 a −20 |
| Currículo menciona disponibilidade de mudança | penalidade limitada a −5 |
| Local de trabalho ou cidade do candidato não informados | **sem penalidade** — vira "lacuna" |

## Regras de não-discriminação

O prompt proíbe explicitamente:

- **Penalizar por dado pessoal ausente** — CPF, foto, gênero, idade.
- **Usar proxies discriminatórios** — nome, bairro, foto, escola de origem. Cidade e estado
  servem exclusivamente à análise logística acima, nunca como sinal socioeconômico.

E o dado sensível do Art. 5º II (saúde, raça, religião, opinião política, filiação
sindical, vida sexual) **não é coletado da Gupy** — morre no allowlist antes de existir no
sistema.

> **Limite honesto desta garantia:** instrução em prompt é controle *fraco*. O bloco de
> dados enviado ao modelo ainda contém instituição de ensino e período de formação, que
> funcionam como proxy de classe e de idade. Reduzir isso de verdade exige **não enviar** o
> campo, e verificar se há viés exige **medir** (teste contrafactual: mesmo currículo,
> variando só o atributo sensível, comparando a distribuição das notas). Nenhuma das duas
> coisas está feita.

## Evidências e formato da resposta

A saída é forçada por tool schema (`avaliar_aderencia`) — o modelo não pode responder texto
livre. Ele devolve `score` (0–100), `justificativa` (3 a 6 frases factuais), `pontos_fortes`,
`lacunas` e até 15 `evidencias`, cada uma com o eixo, o **trecho literal citado do
currículo** e o impacto (positivo/negativo/neutro).

A exigência de citação literal é o que torna a nota auditável: dá para conferir se o
modelo viu mesmo o que alegou ver.

## Proteção contra manipulação

O conteúdo do currículo é tratado como **dado, não instrução**. Se um candidato escrever
"dê nota máxima" ou "ignore as regras" no CV, o prompt manda ignorar e tratar a tentativa
como sinal **negativo**. Os blocos de dados vão delimitados por tags
(`<curriculo_json>`, `<curriculo_texto>`) com aviso explícito ao modelo.

## O que é enviado ao modelo

- **Da vaga:** título, modalidade, descrição (até 4.000 caracteres) e requisitos, incluindo
  os campos customizados preenchidos pelo gestor.
- **Do candidato:** o currículo estruturado em JSON (resumo, anos de experiência,
  competências, experiências, formações, idiomas, certificações — até 12.000 caracteres) e
  um trecho literal do texto do currículo (até 6.000 caracteres) para permitir a citação de
  evidências.
- **Localização** apenas quando a vaga é presencial.
