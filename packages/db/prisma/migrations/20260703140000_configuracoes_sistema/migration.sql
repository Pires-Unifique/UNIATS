-- Configurações do sistema (chave/valor Json) — editáveis pela seção Sistema.
-- O env continua sendo o padrão; a linha aqui, quando existe, sobrepõe.
-- Aditiva: só cria a tabela nova.

-- CreateTable
CREATE TABLE "configuracoes_sistema" (
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "atualizado_por_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_sistema_pkey" PRIMARY KEY ("chave")
);
