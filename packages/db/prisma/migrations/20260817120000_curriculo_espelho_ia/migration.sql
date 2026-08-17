-- Espelho do currículo para saída a IA externa (SBD-0037 / LGPD art. 11).
--
-- As colunas originais seguem ÍNTEGRAS: o recrutador vê o currículo completo, e
-- foi decisão da área de segurança mantê-lo assim. O que não pode atravessar a
-- fronteira para Voyage/Claude é o dado sensível que aparece no texto livre do
-- candidato (`experiencias[].descricao`). O espelho guarda a versão censurada,
-- calculada uma vez.
--
-- Aditiva: só adiciona colunas nulas. Não altera nem migra dado existente.
-- Currículos antigos ficam com `ia_redacao_versao` NULL e são preenchidos pelo
-- cron de reconciliação; enquanto isso, a fronteira omite os campos de risco.

ALTER TABLE "curriculos_processados"
  ADD COLUMN "ia_experiencias"   JSONB,
  ADD COLUMN "ia_resumo"         TEXT,
  ADD COLUMN "ia_texto"          TEXT,
  ADD COLUMN "ia_redacao_versao" TEXT,
  ADD COLUMN "ia_categorias"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Fila do backfill: o cron busca quem ainda não tem a versão atual do espelho.
-- Parcial, para o índice não carregar as linhas já processadas.
CREATE INDEX "curriculos_processados_ia_pendente_idx"
  ON "curriculos_processados" ("ia_redacao_versao")
  WHERE "ia_redacao_versao" IS NULL;
