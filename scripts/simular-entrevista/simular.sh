#!/usr/bin/env bash
# =====================================================================
# Simula uma entrevista no pipeline do Collab a partir de uma gravação do
# Google Meet.  Rodar NA VM, a partir da raiz do repositório.
# ---------------------------------------------------------------------
# Por que existe: a captura automática é Teams-only (o bot Playwright navega
# no Teams web; o Graph puxa o transcript oficial). Um Meet não é capturado por
# ninguém — mas tudo o que vem DEPOIS da captura (censura LGPD, ATA, fusão das
# duas fontes, análise das respostas, notificação) é agnóstico à origem. Este
# script entra exatamente nesse ponto de junção: o callback interno do bot.
#
# Faz três coisas, todas dentro do container playwright-bot (que já tem ffmpeg,
# python3 e faster-whisper — o host não precisa de nada):
#   1. extrai o áudio da gravação  → WAV 16 kHz mono (o vídeo é descartado)
#   2. roda o faster-whisper em pt → whisper.json  (2º motor, PT fiel)
#   3. injeta whisper + transcrição do Meet no POST /internal/playwright/transcript
#
# Uso:
#   scripts/simular-entrevista/simular.sh \
#     -e 3f7c1a90-... \
#     -m /home/svc/simulacao/gravacao.mp4 \
#     -t /home/svc/simulacao/transcricao.txt
#
# Opções:
#   -e UUID    entrevista JÁ agendada no Collab (obrigatório)
#   -t ARQ     transcrição do Meet baixada do Drive (.txt) (obrigatório)
#   -m ARQ     gravação (.mp4/.m4a/.wav/…): a VM extrai o áudio e transcreve
#   -w ARQ     whisper.json JÁ pronto (pula os passos 1 e 2) — excludente com -m
#   -M MODELO  modelo do Whisper (medium = igual à prod; small = ~3x mais rápido)
#   -n MIN     usa só os primeiros MIN minutos (teste rápido; 0 = tudo)
#   -k         mantém o diretório de trabalho (WAV + JSON) para inspeção
#   -d         dry-run: faz tudo, mostra o payload e NÃO posta
#
# -m ou -w? A VM só tem CPU, onde o Whisper roda a ~1,4x o tempo real (1h de
# entrevista ≈ 45 min de VM, disputando CPU com a stack de produção). Numa
# máquina com GPU o mesmo modelo roda a ~8x. Se você tem uma, transcreva lá e
# traga só o JSON (~200 KB) com -w: além de rápido, não sobe o áudio pra cá.
#
# Se o script foi copiado solto (scp para /tmp, sem commit), aponte a raiz do
# checkout — ele precisa do infra/.env.production e do compose de lá:
#   COLLAB_RAIZ=/caminho/do/repo bash /tmp/simular.sh -e … -t … -w …
# (o injetar.py tem que estar no MESMO diretório do simular.sh)
#
# Pré-requisitos na VM:
#   - stack de pé (api, redis) e PLAYWRIGHT_CALLBACK_SECRET em
#     infra/.env.production (sem ele a API responde 503 no callback);
#   - SÓ no modo -m, a imagem collab-playwright-bot:latest (~1,8 GB):
#       docker compose --env-file infra/.env.production \
#         -f infra/docker-compose.prod.yml --profile playwright build playwright-bot
#     No modo -w o script usa python:3-slim (~50 MB) e dispensa essa imagem.
# =====================================================================
set -euo pipefail

ENTREVISTA=""; MIDIA=""; TRANSCRICAO=""; WHISPER=""; MODELO="medium"; MINUTOS="0"
MANTER=0; DRYRUN=0

while getopts ":e:m:t:w:M:n:kdh" opt; do
  case "$opt" in
    e) ENTREVISTA="$OPTARG" ;;
    m) MIDIA="$OPTARG" ;;
    t) TRANSCRICAO="$OPTARG" ;;
    w) WHISPER="$OPTARG" ;;
    M) MODELO="$OPTARG" ;;
    n) MINUTOS="$OPTARG" ;;
    k) MANTER=1 ;;
    d) DRYRUN=1 ;;
    h) sed -n '3,50p' "$0"; exit 0 ;;
    *) echo "Opção inválida: -$OPTARG (use -h)" >&2; exit 2 ;;
  esac
done

erro() { echo "✗ $*" >&2; exit 1; }

[[ -n "$ENTREVISTA" ]] || erro "faltou -e <uuid da entrevista>. Use -h."
[[ "$ENTREVISTA" =~ ^[0-9a-fA-F-]{36}$ ]] || erro "-e não parece um UUID: $ENTREVISTA"
[[ -f "$TRANSCRICAO" ]] || erro "transcrição não encontrada: ${TRANSCRICAO:-(vazio, use -t)}"

# Dois modos: ou a VM transcreve (-m, precisa da mídia) ou você já transcreveu
# em outra máquina e traz o JSON pronto (-w). O segundo é MUITO mais rápido se
# a outra máquina tiver GPU — a VM só tem CPU.
if [[ -n "$WHISPER" && -n "$MIDIA" ]]; then
  erro "-m e -w são excludentes: ou a VM transcreve a mídia, ou você traz o JSON pronto."
fi
if [[ -n "$WHISPER" ]]; then
  [[ -f "$WHISPER" ]] || erro "whisper.json não encontrado: $WHISPER"
elif [[ -n "$MIDIA" ]]; then
  [[ -f "$MIDIA" ]] || erro "gravação não encontrada: $MIDIA"
else
  erro "faltou -m <gravação> ou -w <whisper.json>. Use -h."
fi

# Normalmente o script vive em <repo>/scripts/simular-entrevista/ e a raiz sai de
# dois níveis acima. COLLAB_RAIZ existe para quando ele foi copiado solto (ex.:
# via scp para /tmp, sem passar por commit) e precisa apontar para o checkout.
RAIZ="${COLLAB_RAIZ:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
[[ -f "$RAIZ/infra/docker-compose.prod.yml" ]] \
  || erro "não achei o repositório em $RAIZ — rode de dentro dele ou defina COLLAB_RAIZ."
[[ -f "$RAIZ/infra/.env.production" ]] || erro "infra/.env.production não existe nesta máquina."

# O callback é recusado com 503 se a API não tiver o segredo — melhor descobrir
# agora do que depois de 40 min de Whisper.
grep -qE '^\s*PLAYWRIGHT_CALLBACK_SECRET=.+' "$RAIZ/infra/.env.production" \
  || erro "PLAYWRIGHT_CALLBACK_SECRET ausente/vazio em infra/.env.production (a API devolveria 503)."

if [[ -n "$MIDIA" ]]; then
  docker image inspect collab-playwright-bot:latest >/dev/null 2>&1 \
    || erro "imagem collab-playwright-bot:latest não existe (só o modo -m precisa dela). Ver -h."
fi

COMPOSE=(docker compose --env-file "$RAIZ/infra/.env.production"
         -f "$RAIZ/infra/docker-compose.prod.yml" --profile playwright)

# Pré-voos que custam segundos e evitam descobrir o problema DEPOIS do Whisper
# (que pode levar dezenas de minutos): a API precisa estar de pé para receber o
# callback, e a entrevista precisa existir — o processor lança se não existir.
"${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx api \
  || erro "o container api não está rodando — o callback não teria pra quem ir."
if ! "${COMPOSE[@]}" exec -T postgres \
      psql -U collab -d collab -tAc \
      "select 1 from entrevistas where id = '$ENTREVISTA'" 2>/dev/null | grep -q 1; then
  erro "entrevista $ENTREVISTA não existe no banco. Agende-a no Collab primeiro e use o UUID dela."
fi

TRABALHO="$(mktemp -d /tmp/simular-entrevista.XXXXXX)"
limpar() {
  if [[ "$MANTER" -eq 1 ]]; then
    echo "Arquivos mantidos em $TRABALHO — podem conter ÁUDIO da entrevista e o"
    echo "segredo do callback; apague quando terminar."
    return 0
  fi
  # O container escreve como root; se o usuário do host não puder apagar, avisa
  # em vez de morrer no trap (o WAV é dado pessoal, não pode ficar esquecido).
  rm -rf "$TRABALHO" 2>/dev/null \
    || echo "⚠ apague à mão (criado como root pelo container): $TRABALHO" >&2
  return 0
}
trap limpar EXIT

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_TXT="$(cd "$(dirname "$TRANSCRICAO")" && pwd)"

# Runtime pesado (ffmpeg + faster-whisper): só existe no modo -m.
# --no-deps: usa a api/redis que JÁ estão de pé, sem recriar nada da stack viva.
# -T: sem TTY, senão o stdout do transcribe.py vem com \r e o JSON não parseia.
bot() {
  "${COMPOSE[@]}" run --rm --no-deps -T \
    -v "$(cd "$(dirname "$MIDIA")" && pwd):/entrada/midia:ro" \
    -v "$TRABALHO:/trabalho" \
    playwright-bot "$@"
}

# Runtime leve, só para o injetor. Compartilha a pilha de rede do container da
# api (--network container:), então a API responde em 127.0.0.1:13001 — sem
# depender do nome da rede do compose nem da imagem de 1,8 GB do bot.
API_CID="$("${COMPOSE[@]}" ps -q api)"
[[ -n "$API_CID" ]] || erro "não consegui identificar o container da api."

# O segredo vai por --env-file (arquivo 600 dentro do $TRABALHO) em vez de -e:
# argumento de linha de comando aparece no `ps` de qualquer usuário da máquina.
ENVFILE="$TRABALHO/injetor.env"
umask 077
{
  echo "API_INTERNAL_URL=http://127.0.0.1:13001"
  grep -E '^\s*PLAYWRIGHT_CALLBACK_SECRET=' "$RAIZ/infra/.env.production" \
    | head -1 | sed -E 's/^\s*//; s/\r$//; s/=["'"'"']?(.*[^"'"'"'])["'"'"']?$/=\1/'
} > "$ENVFILE"

WHISPER_MONTAGEM=()
if [[ -n "$WHISPER" ]]; then
  WHISPER_MONTAGEM=(-v "$(cd "$(dirname "$WHISPER")" && pwd):/entrada/whisper:ro")
  WHISPER_NO_CONTAINER="/entrada/whisper/$(basename "$WHISPER")"
else
  WHISPER_NO_CONTAINER="/trabalho/whisper.json"
fi

injetor() {
  docker run --rm -i --network "container:$API_CID" --env-file "$ENVFILE" \
    -v "$DIR_TXT:/entrada/txt:ro" \
    -v "$DIR_SCRIPT:/script:ro" \
    -v "$TRABALHO:/trabalho" \
    ${WHISPER_MONTAGEM[@]+"${WHISPER_MONTAGEM[@]}"} \
    python:3-slim "$@"
}

# Pré-voo final: o injetor só roda no passo 3, então um erro de sintaxe nele
# custaria a espera inteira do Whisper para aparecer. Compilar custa segundos.
# (ast.parse em vez de py_compile: /script é read-only e o py_compile tentaria
# gravar o __pycache__ ali.)
injetor python3 -c "import ast;ast.parse(open('/script/injetar.py').read())" \
  || erro "injetar.py não compila — corrija antes de gastar o tempo do Whisper."

# `[[ ... ]] && x=1` no topo de um script com `set -e` ENCERRA o script quando o
# teste é falso (a lista inteira sai com 1). Por isso tudo aqui é `if`.
[[ "$MINUTOS" =~ ^[0-9]+$ ]] || erro "-n espera minutos inteiros, recebi: $MINUTOS"
CORTE=(); RECORTE=""
if [[ "$MINUTOS" != "0" ]]; then
  CORTE=(-t "$((MINUTOS * 60))")
  RECORTE=" (primeiros $MINUTOS min)"
fi

if [[ -n "$WHISPER" ]]; then
  echo "▶ 1/1  usando o whisper.json pronto ($(basename "$WHISPER")) — pulando extração e Whisper."
else
  echo "▶ 1/3  extraindo áudio de $(basename "$MIDIA")${RECORTE}…"
  # -vn descarta o vídeo; 16 kHz mono s16le é o formato que o bot dá ao Whisper.
  bot ffmpeg -hide_banner -loglevel error -y \
    -i "/entrada/midia/$(basename "$MIDIA")" \
    "${CORTE[@]}" -vn -ac 1 -ar 16000 -c:a pcm_s16le /trabalho/audio.wav
  echo "   WAV: $(du -h "$TRABALHO/audio.wav" | cut -f1)"

  echo "▶ 2/3  transcrevendo com faster-whisper (modelo=$MODELO, pt)…"
  echo "   CPU/int8: conte com algo próximo do tempo real. Ctrl-C aqui não corrompe nada."
  bot python3 /app/transcribe.py --wav /trabalho/audio.wav --model "$MODELO" --lang pt \
    > "$TRABALHO/whisper.json"
  echo "   segmentos: $(grep -o '"start":' "$TRABALHO/whisper.json" | wc -l)"
fi

echo "▶ injetando no callback interno da API…"
INJETAR=(python3 /script/injetar.py
         --entrevista "$ENTREVISTA"
         --transcricao "/entrada/txt/$(basename "$TRANSCRICAO")"
         --whisper "$WHISPER_NO_CONTAINER")
if [[ "$DRYRUN" -eq 1 ]]; then
  INJETAR+=(--dry-run)
fi
injetor "${INJETAR[@]}"
