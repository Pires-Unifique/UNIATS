#!/usr/bin/env bash
# =====================================================================
# Cria a entrevista que o simular.sh vai alimentar.  Rodar NA VM.
# ---------------------------------------------------------------------
# O `-e` do simular.sh exige uma entrevista que EXISTA no banco, e ela não vive
# sozinha: entrevista → candidatura → (vaga, candidato). Este script resolve a
# cadeia inteira e imprime o UUID final.
#
# Reaproveita o que já existe: procura a vaga pelo título e o candidato pelo
# nome; só cria o que faltar. Isso importa porque a análise de respostas roda
# sobre as perguntas cadastradas PARA AQUELA VAGA — pendurar a entrevista numa
# vaga sintética faz a análise sair vazia.
#
# Registros criados aqui usam gupy_id NEGATIVO, derivado por hash do texto de
# busca. A Gupy só emite ids positivos e o sync faz upsert por gupy_id, então o
# que nasce aqui nunca colide com o que vem de lá nem é sobrescrito por uma
# sincronização — e reexecutar com os mesmos argumentos reaproveita o registro.
#
# Uso (por padrão NÃO grava nada — mostra o que faria e desfaz):
#   scripts/simular-entrevista/criar-entrevista.sh -n "Wander Augusto Ferreira" -v "Líder"
#   scripts/simular-entrevista/criar-entrevista.sh -n "..." -v "..." -x    # grava de verdade
#
# Opções:
#   -n NOME    nome do candidato (obrigatório)
#   -v BUSCA   trecho do título da vaga, casado com ILIKE %BUSCA% (obrigatório)
#   -q DATA    data/hora da entrevista, ISO (default: 2026-08-04 10:58)
#   -x         EXECUTA de verdade (sem isso, roda em transação e dá ROLLBACK)
# =====================================================================
set -euo pipefail

NOME=""; BUSCA=""; QUANDO="2026-08-04 10:58"; EXECUTAR=0

while getopts ":n:v:q:xh" opt; do
  case "$opt" in
    n) NOME="$OPTARG" ;;
    v) BUSCA="$OPTARG" ;;
    q) QUANDO="$OPTARG" ;;
    x) EXECUTAR=1 ;;
    h) sed -n '3,28p' "$0"; exit 0 ;;
    *) echo "Opção inválida: -$OPTARG (use -h)" >&2; exit 2 ;;
  esac
done

erro() { echo "✗ $*" >&2; exit 1; }

[[ -n "$NOME" ]]  || erro "faltou -n \"Nome do Candidato\". Use -h."
[[ -n "$BUSCA" ]] || erro "faltou -v \"trecho do título da vaga\". Use -h."

RAIZ="${COLLAB_RAIZ:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
[[ -f "$RAIZ/infra/docker-compose.prod.yml" ]] \
  || erro "não achei o repositório em $RAIZ — rode de dentro dele ou defina COLLAB_RAIZ."

COMPOSE=(docker compose --env-file "$RAIZ/infra/.env.production"
         -f "$RAIZ/infra/docker-compose.prod.yml")

# Ids sintéticos estáveis: mesma entrada → mesmo id negativo, então reexecutar
# reaproveita em vez de duplicar. Calculados aqui (e não em SQL) porque o psql
# não interpola variável dentro do valor de um \set.
id_negativo() { printf '%s' "$1" | cksum | awk '{print -(1000000 + $1 % 8000000)}'; }
GID_VAGA="$(id_negativo "vaga:$BUSCA")"
GID_CAND="$(id_negativo "cand:$NOME")"
GID_CDT="$(id_negativo "cdt:$BUSCA|$NOME")"

# Ao chegar no fim do input, o psql faz COMMIT implícito da transação aberta —
# ou seja, "não mandar COMMIT" NÃO é um ensaio. O ROLLBACK tem que ser explícito.
if [[ "$EXECUTAR" -eq 1 ]]; then
  FECHO="COMMIT;"
  echo "▶ MODO GRAVAÇÃO — as alterações serão persistidas."
else
  FECHO="ROLLBACK;"
  echo "▶ MODO ENSAIO — nada será gravado (use -x para valer)."
fi

# O heredoc é aspado ('SQL') para o bash não tocar nos :'vars' — quem os expande
# é o psql, via -v. Por isso o fecho vai num echo separado, fora do heredoc.
{
  cat <<'SQL'
BEGIN;

WITH existente AS (
  SELECT id, titulo FROM vagas WHERE titulo ILIKE '%' || :'busca' || '%'
  ORDER BY criado_em DESC LIMIT 1
), nova AS (
  INSERT INTO vagas (id, gupy_id, titulo, status, criado_em, atualizado_em)
  SELECT gen_random_uuid(), :gid_vaga, :'busca', 'PUBLICADA', now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM existente)
  ON CONFLICT (gupy_id) DO UPDATE SET atualizado_em = now()
  RETURNING id, titulo
)
SELECT 'reaproveitada' AS origem, id, titulo FROM existente
UNION ALL SELECT 'CRIADA', id, titulo FROM nova
\gset vaga_
\echo '  vaga        :' :vaga_origem :'vaga_titulo'

WITH existente AS (
  SELECT id, nome_completo FROM candidatos
  WHERE nome_completo ILIKE '%' || :'nome' || '%' AND excluido_em IS NULL
  ORDER BY criado_em DESC LIMIT 1
), novo AS (
  INSERT INTO candidatos (id, gupy_id, nome_completo, criado_em, atualizado_em)
  SELECT gen_random_uuid(), :gid_cand, :'nome', now(), now()
  WHERE NOT EXISTS (SELECT 1 FROM existente)
  ON CONFLICT (gupy_id) DO UPDATE SET atualizado_em = now()
  RETURNING id, nome_completo
)
SELECT 'reaproveitado' AS origem, id, nome_completo FROM existente
UNION ALL SELECT 'CRIADO', id, nome_completo FROM novo
\gset cand_
\echo '  candidato   :' :cand_origem :'cand_nome_completo'

-- A unicidade que importa é (vaga_id, candidato_id); o gupy_id só existe para
-- satisfazer a coluna NOT NULL UNIQUE sem invadir a numeração da Gupy.
INSERT INTO candidaturas (id, gupy_id, vaga_id, candidato_id, status, criado_em, atualizado_em)
VALUES (gen_random_uuid(), :gid_cdt, :'vaga_id', :'cand_id', 'EM_ANALISE', now(), now())
ON CONFLICT (vaga_id, candidato_id) DO UPDATE SET atualizado_em = now()
RETURNING id AS candidatura_id
\gset
\echo '  candidatura :' :candidatura_id

INSERT INTO entrevistas (
  id, candidatura_id, candidato_id, agendada_para, duracao_estimada_min,
  status, provedor_video, criado_em, atualizado_em
) VALUES (
  gen_random_uuid(), :'candidatura_id', :'cand_id', :'quando'::timestamp, 60,
  'AGENDADA', 'google_meet', now(), now()
) RETURNING id AS entrevista_id
\gset
\echo ''
\echo '  ENTREVISTA_ID (use no -e):' :entrevista_id
\echo ''
SQL
  echo "$FECHO"
} | "${COMPOSE[@]}" exec -T postgres psql -U collab -d collab --quiet \
      -v ON_ERROR_STOP=1 -v nome="$NOME" -v busca="$BUSCA" -v quando="$QUANDO" \
      -v gid_vaga="$GID_VAGA" -v gid_cand="$GID_CAND" -v gid_cdt="$GID_CDT" \
      | sed 's/^/   /'

echo
if [[ "$EXECUTAR" -eq 1 ]]; then
  echo "Guarde o ENTREVISTA_ID acima — é o valor do -e no simular.sh."
else
  echo "Nada foi gravado. Confira se a vaga que casou é a certa e repita com -x."
fi
