-- Offboarding — documento ASSINADO (upload manual) + validação das assinaturas.
-- Na via física, o DHO sobe o termo assinado e valida as assinaturas antes de
-- liberar o encerramento. Migration puramente ADITIVA (só novas colunas).

ALTER TABLE "solicitacoes_offboarding"
  ADD COLUMN "documento_assinado_storage_key" TEXT,
  ADD COLUMN "documento_assinado_url" TEXT,
  ADD COLUMN "documento_assinado_nome" TEXT,
  ADD COLUMN "documento_assinado_em" TIMESTAMP(3),
  ADD COLUMN "assinaturas_validadas_por_id" UUID,
  ADD COLUMN "assinaturas_validadas_por_nome" TEXT,
  ADD COLUMN "assinaturas_validadas_em" TIMESTAMP(3);
