-- Fusão das duas transcrições (Teams diarizado × Whisper PT) numa "melhor versão"
-- reconciliada pelo Claude — é o que passa a ser exibido ao usuário. Colunas
-- ADITIVAS e nullable; os campos crus (segmentos, whisper_segmentos) permanecem.

-- AlterTable
ALTER TABLE "transcricoes" ADD COLUMN "texto_fundido" TEXT;
ALTER TABLE "transcricoes" ADD COLUMN "segmentos_fundidos" JSONB;
ALTER TABLE "transcricoes" ADD COLUMN "fusao_em" TIMESTAMP(3);
