-- Alteração Contratual — módulo do DHO.
-- Solicitações do líder p/ mudar cargo, salário, centro de custo, unidade (filial)
-- e/ou líder de um colaborador; aprovação do DHO; assinatura no Autentique;
-- execução no Senior na data exata com log completo.
-- Migration puramente ADITIVA (só cria tabelas/enums/índices novos).

-- CreateEnum
CREATE TYPE "tipo_alteracao_contratual" AS ENUM ('CARGO', 'SALARIO', 'CENTRO_CUSTO', 'UNIDADE', 'LIDER');

-- CreateEnum
CREATE TYPE "status_alteracao_contratual" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO_DHO', 'AGUARDANDO_ASSINATURAS', 'ASSINADO', 'AGENDADA', 'EXECUTADA', 'FALHA_EXECUCAO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "papel_assinante" AS ENUM ('GESTOR', 'DHO');

-- CreateEnum
CREATE TYPE "status_assinatura" AS ENUM ('PENDENTE', 'ENVIADA', 'ASSINADA', 'RECUSADA');

-- CreateTable
CREATE TABLE "cargos" (
    "id" UUID NOT NULL,
    "codigo" TEXT,
    "titulo" TEXT NOT NULL,
    "senioridade" TEXT,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL DEFAULT 'csv',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos_lotacoes" (
    "id" UUID NOT NULL,
    "cargo_id" UUID NOT NULL,
    "unidade_id" UUID,
    "centro_custo_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cargos_lotacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades" (
    "id" UUID NOT NULL,
    "externo_id" TEXT NOT NULL,
    "codigo" TEXT,
    "nome" TEXT NOT NULL,
    "cidade" TEXT,
    "estado" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "externo_payload" JSONB,
    "sincronizado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centros_custo" (
    "id" UUID NOT NULL,
    "senior_id" TEXT NOT NULL,
    "codigo" TEXT,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "senior_payload" JSONB,
    "sincronizado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "centros_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colaboradores" (
    "id" UUID NOT NULL,
    "matricula" TEXT NOT NULL,
    "senior_id" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "cpf_hash" CHAR(64),
    "unidade_id" UUID,
    "centro_custo_id" UUID,
    "cargo_atual" TEXT,
    "lider_matricula" TEXT,
    "lider_nome" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "senior_payload" JSONB,
    "sincronizado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colaboradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_alteracao_contratual" (
    "id" UUID NOT NULL,
    "solicitante_id" UUID,
    "solicitante_nome" TEXT NOT NULL,
    "colaborador_id" UUID,
    "colaborador_matricula" TEXT NOT NULL,
    "colaborador_nome" TEXT NOT NULL,
    "unidade_atual" TEXT,
    "centro_custo_atual" TEXT,
    "cargo_atual" TEXT,
    "lider_atual" TEXT,
    "razoes" TEXT NOT NULL,
    "data_aplicacao" DATE NOT NULL,
    "status" "status_alteracao_contratual" NOT NULL DEFAULT 'RASCUNHO',
    "autentique_documento_id" TEXT,
    "documento_url" TEXT,
    "enviado_assinatura_em" TIMESTAMP(3),
    "assinado_em" TIMESTAMP(3),
    "aprovado_por_id" UUID,
    "aprovado_por_nome" TEXT,
    "aprovado_em" TIMESTAMP(3),
    "motivo_recusa" TEXT,
    "observacoes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "solicitacoes_alteracao_contratual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_alteracao_contratual" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "tipo" "tipo_alteracao_contratual" NOT NULL,
    "valor_anterior" TEXT,
    "valor_novo" TEXT NOT NULL,
    "cargo_novo_id" UUID,
    "unidade_nova_id" UUID,
    "centro_custo_novo_id" UUID,
    "salario_anterior" DECIMAL(12,2),
    "salario_novo" DECIMAL(12,2),
    "novo_lider_matricula" TEXT,
    "novo_lider_nome" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_alteracao_contratual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinaturas_alteracao_contratual" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "papel" "papel_assinante" NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 1,
    "status" "status_assinatura" NOT NULL DEFAULT 'PENDENTE',
    "autentique_signatario_id" TEXT,
    "link_assinatura" TEXT,
    "assinado_em" TIMESTAMP(3),
    "recusado_em" TIMESTAMP(3),
    "motivo_recusa" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinaturas_alteracao_contratual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_alteracao_contratual" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "de_status" "status_alteracao_contratual",
    "para_status" "status_alteracao_contratual" NOT NULL,
    "autor_id" UUID,
    "autor_nome" TEXT,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_alteracao_contratual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execucoes_alteracao_contratual" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "agendada_para" TIMESTAMP(3) NOT NULL,
    "executada_em" TIMESTAMP(3),
    "sucesso" BOOLEAN,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "payload_enviado" JSONB,
    "resposta" JSONB,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execucoes_alteracao_contratual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cargos_codigo_key" ON "cargos"("codigo");

-- CreateIndex
CREATE INDEX "cargos_ativo_idx" ON "cargos"("ativo");

-- CreateIndex
CREATE INDEX "cargos_titulo_idx" ON "cargos" USING GIN ("titulo" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "cargos_lotacoes_cargo_id_idx" ON "cargos_lotacoes"("cargo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cargos_lotacoes_cargo_id_unidade_id_centro_custo_id_key" ON "cargos_lotacoes"("cargo_id", "unidade_id", "centro_custo_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_externo_id_key" ON "unidades"("externo_id");

-- CreateIndex
CREATE INDEX "unidades_nome_idx" ON "unidades" USING GIN ("nome" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "centros_custo_senior_id_key" ON "centros_custo"("senior_id");

-- CreateIndex
CREATE INDEX "centros_custo_nome_idx" ON "centros_custo" USING GIN ("nome" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_matricula_key" ON "colaboradores"("matricula");

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_senior_id_key" ON "colaboradores"("senior_id");

-- CreateIndex
CREATE INDEX "colaboradores_nome_idx" ON "colaboradores" USING GIN ("nome" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "colaboradores_lider_matricula_idx" ON "colaboradores"("lider_matricula");

-- CreateIndex
CREATE INDEX "solicitacoes_alteracao_contratual_status_idx" ON "solicitacoes_alteracao_contratual"("status");

-- CreateIndex
CREATE INDEX "solicitacoes_alteracao_contratual_data_aplicacao_idx" ON "solicitacoes_alteracao_contratual"("data_aplicacao");

-- CreateIndex
CREATE INDEX "solicitacoes_alteracao_contratual_solicitante_id_idx" ON "solicitacoes_alteracao_contratual"("solicitante_id");

-- CreateIndex
CREATE INDEX "solicitacoes_alteracao_contratual_colaborador_matricula_idx" ON "solicitacoes_alteracao_contratual"("colaborador_matricula");

-- CreateIndex
CREATE INDEX "itens_alteracao_contratual_solicitacao_id_idx" ON "itens_alteracao_contratual"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "itens_alteracao_contratual_solicitacao_id_tipo_key" ON "itens_alteracao_contratual"("solicitacao_id", "tipo");

-- CreateIndex
CREATE INDEX "assinaturas_alteracao_contratual_solicitacao_id_idx" ON "assinaturas_alteracao_contratual"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_alteracao_contratual_solicitacao_id_papel_key" ON "assinaturas_alteracao_contratual"("solicitacao_id", "papel");

-- CreateIndex
CREATE INDEX "eventos_alteracao_contratual_solicitacao_id_idx" ON "eventos_alteracao_contratual"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "execucoes_alteracao_contratual_solicitacao_id_key" ON "execucoes_alteracao_contratual"("solicitacao_id");

-- CreateIndex
CREATE INDEX "execucoes_alteracao_contratual_agendada_para_sucesso_idx" ON "execucoes_alteracao_contratual"("agendada_para", "sucesso");

-- AddForeignKey
ALTER TABLE "cargos_lotacoes" ADD CONSTRAINT "cargos_lotacoes_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos_lotacoes" ADD CONSTRAINT "cargos_lotacoes_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos_lotacoes" ADD CONSTRAINT "cargos_lotacoes_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_centro_custo_id_fkey" FOREIGN KEY ("centro_custo_id") REFERENCES "centros_custo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_alteracao_contratual" ADD CONSTRAINT "solicitacoes_alteracao_contratual_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_alteracao_contratual" ADD CONSTRAINT "itens_alteracao_contratual_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_alteracao_contratual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_alteracao_contratual" ADD CONSTRAINT "itens_alteracao_contratual_cargo_novo_id_fkey" FOREIGN KEY ("cargo_novo_id") REFERENCES "cargos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_alteracao_contratual" ADD CONSTRAINT "assinaturas_alteracao_contratual_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_alteracao_contratual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_alteracao_contratual" ADD CONSTRAINT "eventos_alteracao_contratual_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_alteracao_contratual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execucoes_alteracao_contratual" ADD CONSTRAINT "execucoes_alteracao_contratual_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_alteracao_contratual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

