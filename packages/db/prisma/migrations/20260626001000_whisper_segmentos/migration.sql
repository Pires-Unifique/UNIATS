-- Fase 2 da transcrição: 2º motor (Whisper local) para checagem cruzada
-- anti-alucinação contra o transcript oficial do Teams (VTT do Graph).
-- Coluna ADITIVA e nullable — guarda os segmentos crus do Whisper que o bot
-- Playwright devolve no callback, sem afetar o transcript principal.

-- AlterTable
ALTER TABLE "transcricoes" ADD COLUMN "whisper_segmentos" JSONB;
