-- =====================================================================
-- ⚠️ TABELA TEMPORÁRIA — REMOVER ANTES DE IR PARA PRODUÇÃO ⚠️
-- Bake-off de transcrição (assemblyai x meetstream). Quando a equipe
-- decidir o provedor, criar uma migração de DROP TABLE "transcricoes_bench".
-- Marcador de busca: BAKE-OFF / TranscricaoBench.
-- =====================================================================

-- CreateTable
CREATE TABLE "transcricoes_bench" (
    "id" UUID NOT NULL,
    "entrevista_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "idioma" TEXT NOT NULL DEFAULT 'pt-BR',
    "texto_completo" TEXT NOT NULL DEFAULT '',
    "segmentos" JSONB NOT NULL DEFAULT '[]',
    "resumo" TEXT,
    "topicos" TEXT[],
    "palavras" INTEGER,
    "segmentos_count" INTEGER,
    "latencia_ms" INTEGER,
    "tokens_entrada" INTEGER,
    "tokens_saida" INTEGER,
    "provider_ref" TEXT,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcricoes_bench_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transcricoes_bench_entrevista_id_idx" ON "transcricoes_bench"("entrevista_id");

-- CreateIndex
CREATE UNIQUE INDEX "transcricoes_bench_entrevista_id_provider_key" ON "transcricoes_bench"("entrevista_id", "provider");

-- AddForeignKey
ALTER TABLE "transcricoes_bench" ADD CONSTRAINT "transcricoes_bench_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
