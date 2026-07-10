-- Perguntas do DHO + análise de respostas pós-reunião.
-- Aditiva: novas tabelas/enums e colunas novas em perguntas_entrevista.
-- O único ALTER em coluna existente é relaxar NOT NULL de "modelo" (perguntas
-- manuais não têm modelo de IA) — não quebra dados existentes.

-- CreateEnum
CREATE TYPE "origem_pergunta" AS ENUM ('IA', 'HUMANO');

-- CreateEnum
CREATE TYPE "status_resposta" AS ENUM ('ABORDADA', 'PARCIAL', 'NAO_ABORDADA');

-- AlterTable: perguntas_entrevista ganha origem/criado_por; modelo vira opcional
ALTER TABLE "perguntas_entrevista"
  ADD COLUMN "origem" "origem_pergunta" NOT NULL DEFAULT 'IA',
  ADD COLUMN "criado_por" TEXT,
  ALTER COLUMN "modelo" DROP NOT NULL;

-- CreateTable
CREATE TABLE "perguntas_padrao" (
    "id" UUID NOT NULL,
    "pergunta" TEXT NOT NULL,
    "objetivo" TEXT,
    "competencia" TEXT,
    "categoria" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_por" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perguntas_padrao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respostas_entrevista" (
    "id" UUID NOT NULL,
    "entrevista_id" UUID NOT NULL,
    "pergunta_id" UUID,
    "pergunta_padrao_id" UUID,
    "pergunta_texto" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "status" "status_resposta" NOT NULL,
    "sintese" TEXT,
    "citacao" TEXT,
    "modelo" TEXT NOT NULL,
    "prompt_versao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respostas_entrevista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "respostas_entrevista_entrevista_id_idx" ON "respostas_entrevista"("entrevista_id");

-- AddForeignKey
ALTER TABLE "respostas_entrevista" ADD CONSTRAINT "respostas_entrevista_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_entrevista" ADD CONSTRAINT "respostas_entrevista_pergunta_id_fkey" FOREIGN KEY ("pergunta_id") REFERENCES "perguntas_entrevista"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "respostas_entrevista" ADD CONSTRAINT "respostas_entrevista_pergunta_padrao_id_fkey" FOREIGN KEY ("pergunta_padrao_id") REFERENCES "perguntas_padrao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
