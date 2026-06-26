-- Offboarding — convites de AUTODESLIGAMENTO (link com token).
-- O DHO gera um link para o colaborador pedir o próprio desligamento sem login
-- interno. Uso único, com validade e cancelável. Migration puramente ADITIVA.

-- CreateTable
CREATE TABLE "convites_offboarding" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "colaborador_id" UUID,
    "colaborador_matricula" TEXT NOT NULL,
    "colaborador_nome" TEXT NOT NULL,
    "criado_por_id" UUID,
    "criado_por_nome" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "cancelado_em" TIMESTAMP(3),
    "solicitacao_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "convites_offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "convites_offboarding_token_key" ON "convites_offboarding"("token");

-- CreateIndex
CREATE INDEX "convites_offboarding_colaborador_matricula_idx" ON "convites_offboarding"("colaborador_matricula");
