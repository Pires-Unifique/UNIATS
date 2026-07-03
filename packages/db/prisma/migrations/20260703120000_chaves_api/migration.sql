-- Chaves de API — acesso de máquina à API do Collab, com escopos por área.
-- Aditiva: só cria a tabela nova; nada existente muda.

-- CreateTable
CREATE TABLE "chaves_api" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "escopos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criado_por_id" UUID,
    "criado_por_nome" TEXT,
    "expira_em" TIMESTAMP(3),
    "ultimo_uso_em" TIMESTAMP(3),
    "revogado_em" TIMESTAMP(3),
    "revogado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chaves_api_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chaves_api_hash_key" ON "chaves_api"("hash");

-- CreateIndex
CREATE INDEX "chaves_api_revogado_em_idx" ON "chaves_api"("revogado_em");
