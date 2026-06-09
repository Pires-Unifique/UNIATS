-- CreateEnum
CREATE TYPE "recomendacao_painel" AS ENUM ('CONTRATAR', 'CONTRATAR_COM_RESSALVAS', 'NAO_CONTRATAR', 'INCONCLUSIVO');

-- CreateEnum
CREATE TYPE "origem_avaliacao" AS ENUM ('HUMANO', 'IA_SUGERIDO');

-- AlterTable
ALTER TABLE "entrevistas" ADD COLUMN     "recomendacao_painel" "recomendacao_painel";

-- CreateTable
CREATE TABLE "avaliacoes_entrevista" (
    "id" UUID NOT NULL,
    "entrevista_id" UUID NOT NULL,
    "avaliador_id" UUID,
    "avaliador_nome" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "peso" INTEGER NOT NULL DEFAULT 1,
    "evidencia" TEXT,
    "origem" "origem_avaliacao" NOT NULL DEFAULT 'HUMANO',
    "pergunta_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avaliacoes_entrevista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avaliacoes_entrevista_entrevista_id_idx" ON "avaliacoes_entrevista"("entrevista_id");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacoes_entrevista_entrevista_id_avaliador_id_competenci_key" ON "avaliacoes_entrevista"("entrevista_id", "avaliador_id", "competencia");

-- AddForeignKey
ALTER TABLE "avaliacoes_entrevista" ADD CONSTRAINT "avaliacoes_entrevista_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_entrevista" ADD CONSTRAINT "avaliacoes_entrevista_pergunta_id_fkey" FOREIGN KEY ("pergunta_id") REFERENCES "perguntas_entrevista"("id") ON DELETE SET NULL ON UPDATE CASCADE;
