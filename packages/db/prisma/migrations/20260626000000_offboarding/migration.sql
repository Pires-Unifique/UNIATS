-- Offboarding — módulo do DHO.
-- Solicitação de desligamento (pelo líder/empregador ou pelo próprio colaborador);
-- aprovações (gerente do CC + DHO) quando vem do empregador; documento assinado
-- no Autentique (colaborador + representante da empresa); etapas de encerramento
-- (remoção de acessos/TI, benefícios, ponto + checklist do líder) até CONCLUIDO.
-- Migration puramente ADITIVA. Reaproveita o enum "status_assinatura" existente.

-- CreateEnum
CREATE TYPE "origem_offboarding" AS ENUM ('COLABORADOR', 'EMPREGADOR');

-- CreateEnum
CREATE TYPE "tipo_desligamento" AS ENUM ('PEDIDO_COLABORADOR', 'SEM_JUSTA_CAUSA', 'TERMINO_EXPERIENCIA_DISTRATO', 'JUSTA_CAUSA');

-- CreateEnum
CREATE TYPE "forma_assinatura" AS ENUM ('DIGITAL', 'FISICA');

-- CreateEnum
CREATE TYPE "status_offboarding" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO_GESTOR', 'AGUARDANDO_APROVACAO_DHO', 'AGUARDANDO_ASSINATURAS', 'ASSINADO', 'EM_ENCERRAMENTO', 'CONCLUIDO', 'RECUSADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "papel_assinante_offboarding" AS ENUM ('COLABORADOR', 'REPRESENTANTE_EMPRESA');

-- CreateEnum
CREATE TYPE "categoria_item_encerramento" AS ENUM ('INTEGRACAO', 'CHECKLIST');

-- CreateEnum
CREATE TYPE "status_item_encerramento" AS ENUM ('PENDENTE', 'CONCLUIDO', 'NAO_APLICAVEL', 'FALHA');

-- CreateEnum
CREATE TYPE "tipo_resposta_item" AS ENUM ('AUTOMATICO', 'BOOLEANO', 'TEXTO');

-- CreateTable
CREATE TABLE "procuradores" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "documento" TEXT,
    "cargo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "procuradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_offboarding" (
    "id" UUID NOT NULL,
    "origem" "origem_offboarding" NOT NULL,
    "solicitante_id" UUID,
    "solicitante_nome" TEXT NOT NULL,
    "colaborador_id" UUID,
    "colaborador_matricula" TEXT NOT NULL,
    "colaborador_nome" TEXT NOT NULL,
    "tipo_desligamento" "tipo_desligamento" NOT NULL,
    "cumpre_aviso_previo" BOOLEAN NOT NULL DEFAULT false,
    "aviso_previo_dias" INTEGER,
    "motivo" TEXT NOT NULL,
    "email_pessoal" TEXT,
    "whatsapp_pessoal" TEXT,
    "contatos_verificados" BOOLEAN NOT NULL DEFAULT false,
    "forma_assinatura" "forma_assinatura" NOT NULL DEFAULT 'DIGITAL',
    "senior_snapshot" JSONB,
    "snapshot_capturado_em" TIMESTAMP(3),
    "unidade_atual" TEXT,
    "centro_custo_atual" TEXT,
    "cargo_atual" TEXT,
    "data_admissao" DATE,
    "status" "status_offboarding" NOT NULL DEFAULT 'RASCUNHO',
    "aprovado_gestor_por_id" UUID,
    "aprovado_gestor_por_nome" TEXT,
    "aprovado_gestor_em" TIMESTAMP(3),
    "aprovado_dho_por_id" UUID,
    "aprovado_dho_por_nome" TEXT,
    "aprovado_dho_em" TIMESTAMP(3),
    "recusado_por_nome" TEXT,
    "recusado_em" TIMESTAMP(3),
    "motivo_recusa" TEXT,
    "autentique_documento_id" TEXT,
    "documento_storage_key" TEXT,
    "documento_url" TEXT,
    "documento_gerado_em" TIMESTAMP(3),
    "enviado_assinatura_em" TIMESTAMP(3),
    "assinado_em" TIMESTAMP(3),
    "observacoes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "solicitacoes_offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinaturas_offboarding" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "papel" "papel_assinante_offboarding" NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 1,
    "status" "status_assinatura" NOT NULL DEFAULT 'PENDENTE',
    "representante_origem" TEXT,
    "procurador_id" UUID,
    "autentique_signatario_id" TEXT,
    "link_assinatura" TEXT,
    "assinado_em" TIMESTAMP(3),
    "recusado_em" TIMESTAMP(3),
    "motivo_recusa" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinaturas_offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_encerramento_offboarding" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "categoria" "categoria_item_encerramento" NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo_resposta" "tipo_resposta_item" NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "status" "status_item_encerramento" NOT NULL DEFAULT 'PENDENTE',
    "resposta_bool" BOOLEAN,
    "resposta_texto" TEXT,
    "payload" JSONB,
    "respondido_por_id" UUID,
    "respondido_por_nome" TEXT,
    "respondido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_encerramento_offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_offboarding" (
    "id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "de_status" "status_offboarding",
    "para_status" "status_offboarding" NOT NULL,
    "autor_id" UUID,
    "autor_nome" TEXT,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_offboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "procuradores_ativo_idx" ON "procuradores"("ativo");

-- CreateIndex
CREATE INDEX "procuradores_nome_idx" ON "procuradores" USING GIN ("nome" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "solicitacoes_offboarding_status_idx" ON "solicitacoes_offboarding"("status");

-- CreateIndex
CREATE INDEX "solicitacoes_offboarding_origem_idx" ON "solicitacoes_offboarding"("origem");

-- CreateIndex
CREATE INDEX "solicitacoes_offboarding_colaborador_matricula_idx" ON "solicitacoes_offboarding"("colaborador_matricula");

-- CreateIndex
CREATE INDEX "solicitacoes_offboarding_solicitante_id_idx" ON "solicitacoes_offboarding"("solicitante_id");

-- CreateIndex
CREATE INDEX "assinaturas_offboarding_solicitacao_id_idx" ON "assinaturas_offboarding"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_offboarding_solicitacao_id_papel_key" ON "assinaturas_offboarding"("solicitacao_id", "papel");

-- CreateIndex
CREATE INDEX "itens_encerramento_offboarding_solicitacao_id_idx" ON "itens_encerramento_offboarding"("solicitacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "itens_encerramento_offboarding_solicitacao_id_chave_key" ON "itens_encerramento_offboarding"("solicitacao_id", "chave");

-- CreateIndex
CREATE INDEX "eventos_offboarding_solicitacao_id_idx" ON "eventos_offboarding"("solicitacao_id");

-- AddForeignKey
ALTER TABLE "solicitacoes_offboarding" ADD CONSTRAINT "solicitacoes_offboarding_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_offboarding" ADD CONSTRAINT "assinaturas_offboarding_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_offboarding" ADD CONSTRAINT "assinaturas_offboarding_procurador_id_fkey" FOREIGN KEY ("procurador_id") REFERENCES "procuradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_encerramento_offboarding" ADD CONSTRAINT "itens_encerramento_offboarding_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_offboarding" ADD CONSTRAINT "eventos_offboarding_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacoes_offboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
