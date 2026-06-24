#!/usr/bin/env bash
# Sobe um PulseAudio com um sink virtual (o Chromium toca a reunião nele; o bot
# grava o monitor) e então inicia o bot sob xvfb (display virtual p/ headful).
set -e

SINK="${MEETBOT_AUDIO_SINK:-meetbot}"

# PulseAudio em modo usuário (root precisa de --system=false + dirs próprios).
export PULSE_RUNTIME_PATH="${PULSE_RUNTIME_PATH:-/tmp/pulse}"
mkdir -p "$PULSE_RUNTIME_PATH"
pulseaudio --start --exit-idle-time=-1 --disallow-exit --log-target=stderr 2>/dev/null || true
sleep 1

# Sink nulo (saída de áudio) — o Chromium toca aqui; gravamos "${SINK}.monitor".
pactl load-module module-null-sink sink_name="$SINK" \
  sink_properties=device.description="$SINK" 2>/dev/null || true
pactl set-default-sink "$SINK" 2>/dev/null || true

exec xvfb-run --auto-servernum -- node dist/index.js
