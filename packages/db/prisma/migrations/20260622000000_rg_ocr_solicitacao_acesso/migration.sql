-- Campos de OCR por IA no documento admissional (ex.: leitura do RG via Claude visão)
-- e gatilho de saída (SolicitacaoAcesso) para criação do usuário de AD em ferramenta externa.

-- AlterTable
ALTER TABLE "documentos_admissionais"
  ADD COLUMN "dados_extraidos_json" JSONB,
  ADD COLUMN "ocr_versao" TEXT,
  ADD COLUMN "ocr_processado_em" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "status_solicitacao_acesso" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHADA');

-- CreateTable
CREATE TABLE "solicitacoes_acesso" (
    "id" UUID NOT NULL,
    "admissao_id" UUID NOT NULL,
    "documento_id" UUID,
    "provider" TEXT NOT NULL,
    "status" "status_solicitacao_acesso" NOT NULL DEFAULT 'PENDENTE',
    "nome_enviado" TEXT,
    "ref_externa" TEXT,
    "url_externa" TEXT,
    "payload_enviado" JSONB,
    "resposta" JSONB,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitacoes_acesso_admissao_id_key" ON "solicitacoes_acesso"("admissao_id");

-- CreateIndex
CREATE INDEX "solicitacoes_acesso_status_idx" ON "solicitacoes_acesso"("status");

-- AddForeignKey
ALTER TABLE "solicitacoes_acesso" ADD CONSTRAINT "solicitacoes_acesso_admissao_id_fkey" FOREIGN KEY ("admissao_id") REFERENCES "admissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
