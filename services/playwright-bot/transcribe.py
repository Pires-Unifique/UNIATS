#!/usr/bin/env python3
"""Transcreve um WAV com faster-whisper e imprime JSON {segments:[{start,end,text}]}.

Uso: python3 transcribe.py --wav out.wav --model medium --lang pt
O modelo já vem baixado na imagem (cache do HF). CPU, int8 (leve na VM).
"""
import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--model", default="medium")
    ap.add_argument("--lang", default="pt")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # noqa: BLE001
        print(f"faster-whisper indisponível: {e}", file=sys.stderr)
        return 1

    # CPU + int8: menor uso de RAM (cabe na VM de 8 GB). download_root usa o cache
    # populado no build da imagem, então não baixa nada em runtime.
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        args.wav,
        language=args.lang,
        vad_filter=True,  # pula silêncio → menos alucinação e mais rápido
        beam_size=5,
    )
    out = [
        {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
        for s in segments
        if s.text and s.text.strip()
    ]
    print(json.dumps({"segments": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
