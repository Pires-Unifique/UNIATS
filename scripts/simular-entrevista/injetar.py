#!/usr/bin/env python3
"""Injeta uma entrevista gravada no Google Meet no pipeline de transcrição.

Roda DENTRO do container `playwright-bot` (ver simular.sh): lá já existe python3,
a rede do compose resolve `api:13001` e o env_file do .env.production já entrega
`API_INTERNAL_URL` + `PLAYWRIGHT_CALLBACK_SECRET`. Nada precisa ser instalado no
host — só stdlib aqui.

A saída é um POST em `{API_INTERNAL_URL}/internal/playwright/transcript`, o MESMO
callback que o bot usa ao sair de uma reunião do Teams. Daí pra frente o fluxo é
idêntico ao real: censura LGPD → persistência da Transcricao → ATA via Claude →
fusão das duas fontes → análise das respostas do roteiro → notificação no sino.

O pipeline consome duas fontes e só funde quando as DUAS existem:
  - `segmentos`        → diarizado (quem falou). No Teams vem da legenda; aqui,
                         da transcrição que o Meet salva no Drive.
  - `whisperSegmentos` → faster-whisper sobre o áudio (PT mais fiel, sem falante).

Uso (dentro do container):
  python3 injetar.py --entrevista <uuid> \
                     --transcricao /entrada/txt/transcricao.txt \
                     --whisper /trabalho/whisper.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

# Cabeçalhos que o Meet escreve antes das falas. Servem de âncora: tudo antes de
# "Transcrição" é metadado (título da reunião, data, participantes) e não é fala.
SECAO_TRANSCRICAO = re.compile(r"^\s*(transcri[çc][ãa]o|transcript)\s*:?\s*$", re.I)
SECAO_PARTICIPANTES = re.compile(
    r"^\s*(participantes|participants|attendees|convidados)\s*:?\s*$", re.I
)

# "Fulano: bom dia" — com timestamp opcional na frente ("00:12:03 Fulano: ...").
# O `\s+` depois dos dois-pontos é o que evita casar horário no meio do texto
# ("chego 14:30") como se fosse falante.
LINHA_FALA = re.compile(
    r"^\s*(?:(?P<ts>\d{1,2}:\d{2}(?::\d{2})?)\s+)?(?P<falante>[^:]{1,60}?):\s+(?P<texto>\S.*)$"
)

# O Meet real põe o timestamp SOZINHO numa linha, a cada ~1 min, e não colado no
# falante. Sem tratar isso, a linha "00:01:11" era colada como se fosse fala.
LINHA_TIMESTAMP = re.compile(r"^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$")

# Rodapé que o Meet carimba no fim ("A transcrição foi encerrada após 00:54:31" +
# aviso de que o texto é gerado por computador). Não é fala: a partir daí, para.
RODAPE = re.compile(
    r"^\s*(a\s+transcri[çc][ãa]o\s+foi\s+encerrada|esta\s+transcri[çc][ãa]o\s+edit[áa]vel)",
    re.I,
)


def ts_para_ms(ts: str) -> int:
    partes = [int(p) for p in ts.split(":")]
    if len(partes) == 2:
        h, m, s = 0, partes[0], partes[1]
    else:
        h, m, s = partes[0], partes[1], partes[2]
    return ((h * 3600) + (m * 60) + s) * 1000


def parece_nome(candidato: str) -> bool:
    """Heurística anti-falso-positivo quando não sabemos a lista de participantes.

    Nome de gente é curto, sem pontuação final e sem cara de frase — assim
    "Guilherme Viana:" casa e "Resumindo:" ou "Aí eu falei:" não.
    """
    c = candidato.strip()
    if not c or len(c) > 60:
        return False
    if len(c.split()) > 6:
        return False
    if c.endswith((".", "?", "!", ",", ";")):
        return False
    return True


def ler_participantes(linhas: list[str]) -> set[str]:
    """Nomes listados na seção 'Participantes' (uma linha ou separados por vírgula).

    Quando existem, viram a allowlist de falantes — bem mais confiável que a
    heurística. O Meet nem sempre exporta essa seção, daí o fallback.
    """
    nomes: set[str] = set()
    dentro = False
    for linha in linhas:
        if SECAO_PARTICIPANTES.match(linha):
            dentro = True
            continue
        if not dentro:
            continue
        if SECAO_TRANSCRICAO.match(linha) or not linha.strip():
            if nomes:
                break
            continue
        for nome in linha.split(","):
            nome = nome.strip()
            if parece_nome(nome):
                nomes.add(nome.casefold())
    return nomes


# "da Silva", "dos Santos": minúsculas legítimas no meio de um nome próprio.
PARTICULAS = {"de", "da", "do", "das", "dos", "e", "di", "du", "del", "van", "von"}


def parece_nome_proprio(candidato: str) -> bool:
    """Nome próprio inequívoco: 2+ palavras, todas capitalizadas.

    Existe para salvar quem falou UMA única vez na reunião. Num caso real, o
    corte por repetição descartava 'Guilherme Pires' (uma fala) junto com o
    lixo 'conversamos, falei' e 'técnico falava' — esta regra separa os três.
    """
    if "," in candidato:
        return False
    palavras = candidato.split()
    if not 2 <= len(palavras) <= 5:
        return False
    return all(p.casefold() in PARTICULAS or p[:1].isupper() for p in palavras)


def inferir_falantes(linhas: list[str]) -> set[str]:
    """Fallback quando o arquivo não traz a seção 'Participantes'.

    Duas passadas: vira falante o prefixo que aparece em pelo menos DUAS linhas
    — gente fala mais de uma vez, enquanto "Resumindo:" ou "Aí eu falei:" são
    eventos isolados — OU que tenha cara inequívoca de nome próprio, para não
    perder quem só deu um "oi". Se nada passar, devolve vazio e o chamador cai
    na heurística linha a linha.
    """
    contagem: dict[str, int] = {}
    original: dict[str, str] = {}
    for linha in linhas:
        m = LINHA_FALA.match(linha)
        if not m:
            continue
        candidato = m.group("falante").strip()
        if not parece_nome(candidato):
            continue
        chave = candidato.casefold()
        contagem[chave] = contagem.get(chave, 0) + 1
        original.setdefault(chave, candidato)
    return {
        nome
        for nome, n in contagem.items()
        if n >= 2 or parece_nome_proprio(original[nome])
    }


def parsear_meet(caminho: str) -> list[dict]:
    """Transcrição do Meet (.txt do Doc, ou texto extraído do PDF) → turnos.

    NFKC na leitura porque texto vindo de PDF traz ligaturas tipográficas: o
    "fi" de "Unifique" vem como o caractere único U+FB01, o que quebraria tanto
    a comparação de nomes quanto o texto entregue ao Claude.
    """
    with open(caminho, encoding="utf-8-sig") as fh:
        linhas = [unicodedata.normalize("NFKC", l) for l in fh.read().splitlines()]

    participantes = ler_participantes(linhas) or inferir_falantes(linhas)

    # Se o arquivo tem a âncora "Transcrição", começa depois dela; senão, do topo.
    inicio = 0
    for i, linha in enumerate(linhas):
        if SECAO_TRANSCRICAO.match(linha):
            inicio = i + 1
            break

    turnos: list[dict] = []
    relogio_ms: int | None = None
    for linha in linhas[inicio:]:
        if not linha.strip():
            continue
        if RODAPE.match(linha):
            break  # daqui pra baixo é só o aviso automático do Meet
        marca = LINHA_TIMESTAMP.match(linha)
        if marca:
            # Marca de tempo isolada: passa a valer para os próximos turnos.
            relogio_ms = ts_para_ms(marca.group(1))
            continue
        m = LINHA_FALA.match(linha)
        falante = m.group("falante").strip() if m else ""
        # Com a lista de participantes conhecida, exige que o prefixo seja um
        # deles; sem ela, cai na heurística de "parece nome".
        eh_fala = bool(m) and (
            falante.casefold() in participantes if participantes else parece_nome(falante)
        )
        if eh_fala:
            ts = m.group("ts")
            if ts:
                inicio_ms = ts_para_ms(ts)
            elif relogio_ms is not None:
                # Vários turnos caem sob a mesma marca; o passo de 100 ms só
                # preserva a ordem entre eles sem invadir a marca seguinte.
                inicio_ms = relogio_ms
                relogio_ms += 100
            else:
                inicio_ms = len(turnos) * 1000
            turnos.append(
                {
                    "inicio_ms": inicio_ms,
                    "falante": falante,
                    "texto": m.group("texto").strip(),
                }
            )
        elif turnos:
            # Quebra de linha no meio da fala — continua o turno anterior.
            turnos[-1]["texto"] = f"{turnos[-1]['texto']} {linha.strip()}".strip()
    return turnos


def parsear_whisper(caminho: str) -> list[dict]:
    """Saída do transcribe.py ({"segments":[{start,end,text}]}) → segmentos.

    Mesma conversão que o bot faz em whisper.ts: o Whisper não diariza, então o
    falante fica "Desconhecido" — quem dá os nomes é a outra fonte, na fusão.
    """
    with open(caminho, encoding="utf-8") as fh:
        dados = json.load(fh)
    segmentos = []
    for s in dados.get("segments", []):
        texto = (s.get("text") or "").strip()
        if not texto:
            continue
        segmentos.append(
            {
                "inicio_ms": max(0, round(float(s.get("start") or 0) * 1000)),
                "falante": "Desconhecido",
                "texto": texto,
            }
        )
    return segmentos


def postar(url: str, secret: str, payload: dict) -> None:
    req = urllib.request.Request(
        url.rstrip("/") + "/internal/playwright/transcript",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json", "x-playwright-secret": secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"→ API respondeu {resp.status}: {resp.read().decode('utf-8', 'replace')}")
    except urllib.error.HTTPError as e:
        corpo = e.read().decode("utf-8", "replace")
        dica = {
            401: "segredo errado — confira PLAYWRIGHT_CALLBACK_SECRET no infra/.env.production.",
            503: "a API subiu SEM PLAYWRIGHT_CALLBACK_SECRET — defina e reinicie o container api.",
            404: "rota não encontrada — a API é antiga demais ou a URL está errada.",
        }.get(e.code, "")
        print(f"✗ HTTP {e.code}: {corpo}\n  {dica}", file=sys.stderr)
        raise SystemExit(1)
    except urllib.error.URLError as e:
        print(
            f"✗ Não consegui falar com {url}: {e.reason}\n"
            "  O container api está de pé? (docker compose ps api)",
            file=sys.stderr,
        )
        raise SystemExit(1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entrevista", required=True, help="UUID da entrevista já agendada")
    ap.add_argument("--transcricao", required=True, help=".txt da transcrição do Meet")
    ap.add_argument("--whisper", required=True, help="JSON do transcribe.py")
    ap.add_argument("--api-url", default=os.environ.get("API_INTERNAL_URL", "http://api:13001"))
    ap.add_argument("--secret", default=os.environ.get("PLAYWRIGHT_CALLBACK_SECRET", ""))
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="mostra o que seria enviado (e as 5 primeiras falas) sem postar",
    )
    args = ap.parse_args()

    if not args.secret and not args.dry_run:
        print(
            "✗ PLAYWRIGHT_CALLBACK_SECRET vazio — sem ele a API recusa o callback.",
            file=sys.stderr,
        )
        return 1

    meet = parsear_meet(args.transcricao)
    whisper = parsear_whisper(args.whisper)

    if not meet and not whisper:
        print("✗ Nada extraído das duas fontes — a API descartaria o envio.", file=sys.stderr)
        return 1

    falantes = sorted({t["falante"] for t in meet})
    print(f"Meet    : {len(meet)} turnos, falantes: {', '.join(falantes) or '(nenhum)'}")
    print(f"Whisper : {len(whisper)} segmentos")
    if not meet:
        print("⚠ Sem diarização — vai persistir só o Whisper e a FUSÃO NÃO RODA.")
    if not whisper:
        print("⚠ Sem Whisper — vai persistir só a legenda e a FUSÃO NÃO RODA.")
    if len(falantes) == 1:
        print("⚠ Um único falante detectado — confira o parse antes de confiar na análise.")

    payload = {
        "entrevistaId": args.entrevista,
        "texto": "\n".join(f"{t['falante']}: {t['texto']}" for t in meet),
        "segmentos": meet,
        "whisperSegmentos": whisper,
        "entrou": True,
        "legendasLigadas": bool(meet),
    }

    if args.dry_run:
        for t in meet[:5]:
            print(f"  [{t['inicio_ms']:>7} ms] {t['falante']}: {t['texto'][:90]}")
        print(f"(dry-run) {len(json.dumps(payload).encode())} bytes NÃO enviados.")
        return 0

    postar(args.api_url, args.secret, payload)
    print(
        "Enfileirado. Acompanhe: docker compose -f infra/docker-compose.prod.yml logs -f api\n"
        "A fusão entra ~15s depois da persistência; a ATA e a análise vêm em seguida."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
