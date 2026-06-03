-- DropIndex
DROP INDEX "embeddings_vetor_hnsw_idx";

-- CreateTable
CREATE TABLE "templates_mensagem" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "versao" TEXT NOT NULL DEFAULT 'v1',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_corpo" TEXT,
    "email_assunto" TEXT,
    "email_texto" TEXT,
    "email_html" TEXT,
    "criado_por" UUID,
    "atualizado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_mensagem_codigo_key" ON "templates_mensagem"("codigo");

-- CreateIndex
CREATE INDEX "templates_mensagem_ativo_idx" ON "templates_mensagem"("ativo");

-- AddForeignKey
ALTER TABLE "templates_mensagem" ADD CONSTRAINT "templates_mensagem_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates_mensagem" ADD CONSTRAINT "templates_mensagem_atualizado_por_fkey" FOREIGN KEY ("atualizado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
