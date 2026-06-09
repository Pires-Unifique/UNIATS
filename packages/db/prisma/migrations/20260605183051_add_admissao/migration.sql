-- CreateEnum
CREATE TYPE "status_admissao" AS ENUM ('AGUARDANDO_ACEITE', 'PROPOSTA_ACEITA', 'COLETA_DOCUMENTOS', 'DOCUMENTOS_EM_ANALISE', 'EXAME_MEDICO', 'ASSINATURA_CONTRATO', 'ENVIO_ESOCIAL', 'INTEGRACAO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "tipo_documento_admissional" AS ENUM ('RG', 'CPF', 'CTPS', 'TITULO_ELEITOR', 'PIS_NIS', 'COMPROVANTE_RESIDENCIA', 'COMPROVANTE_ESCOLARIDADE', 'CERTIDAO_NASCIMENTO_CASAMENTO', 'RESERVISTA', 'DADOS_BANCARIOS', 'FOTO_3X4', 'DEPENDENTES', 'OUTRO');

-- CreateEnum
CREATE TYPE "status_documento_admissional" AS ENUM ('PENDENTE', 'ENVIADO', 'EM_ANALISE', 'APROVADO', 'REPROVADO');

-- CreateEnum
CREATE TYPE "resultado_exame_admissional" AS ENUM ('PENDENTE', 'APTO', 'APTO_COM_RESTRICOES', 'INAPTO');

-- CreateTable
CREATE TABLE "admissoes" (
    "id" UUID NOT NULL,
    "candidatura_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "vaga_id" UUID NOT NULL,
    "responsavel_id" UUID,
    "status" "status_admissao" NOT NULL DEFAULT 'AGUARDANDO_ACEITE',
    "cargo" TEXT,
    "salario" DECIMAL(12,2),
    "tipo_contratacao" TEXT,
    "jornada" TEXT,
    "data_admissao" TIMESTAMP(3),
    "data_aceite" TIMESTAMP(3),
    "data_conclusao" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,
    "esocial_recibo" TEXT,
    "esocial_status" TEXT,
    "matricula" TEXT,
    "observacoes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "admissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_admissionais" (
    "id" UUID NOT NULL,
    "admissao_id" UUID NOT NULL,
    "tipo" "tipo_documento_admissional" NOT NULL,
    "status" "status_documento_admissional" NOT NULL DEFAULT 'PENDENTE',
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "arquivo_url" TEXT,
    "arquivo_sha256" CHAR(64),
    "nome_arquivo" TEXT,
    "validade" TIMESTAMP(3),
    "motivo_recusa" TEXT,
    "enviado_em" TIMESTAMP(3),
    "analisado_por" UUID,
    "analisado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documentos_admissionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exames_admissionais" (
    "id" UUID NOT NULL,
    "admissao_id" UUID NOT NULL,
    "clinica" TEXT,
    "agendado_para" TIMESTAMP(3),
    "realizado_em" TIMESTAMP(3),
    "resultado" "resultado_exame_admissional" NOT NULL DEFAULT 'PENDENTE',
    "restricoes" TEXT,
    "aso_url" TEXT,
    "aso_sha256" CHAR(64),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exames_admissionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_admissao" (
    "id" UUID NOT NULL,
    "admissao_id" UUID NOT NULL,
    "de_status" "status_admissao",
    "para_status" "status_admissao" NOT NULL,
    "autor_id" UUID,
    "autor_nome" TEXT,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_admissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admissoes_candidatura_id_key" ON "admissoes"("candidatura_id");

-- CreateIndex
CREATE INDEX "admissoes_status_idx" ON "admissoes"("status");

-- CreateIndex
CREATE INDEX "documentos_admissionais_admissao_id_status_idx" ON "documentos_admissionais"("admissao_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "documentos_admissionais_admissao_id_tipo_key" ON "documentos_admissionais"("admissao_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "exames_admissionais_admissao_id_key" ON "exames_admissionais"("admissao_id");

-- CreateIndex
CREATE INDEX "eventos_admissao_admissao_id_idx" ON "eventos_admissao"("admissao_id");

-- AddForeignKey
ALTER TABLE "admissoes" ADD CONSTRAINT "admissoes_candidatura_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissoes" ADD CONSTRAINT "admissoes_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissoes" ADD CONSTRAINT "admissoes_vaga_id_fkey" FOREIGN KEY ("vaga_id") REFERENCES "vagas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissoes" ADD CONSTRAINT "admissoes_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_admissionais" ADD CONSTRAINT "documentos_admissionais_admissao_id_fkey" FOREIGN KEY ("admissao_id") REFERENCES "admissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exames_admissionais" ADD CONSTRAINT "exames_admissionais_admissao_id_fkey" FOREIGN KEY ("admissao_id") REFERENCES "admissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_admissao" ADD CONSTRAINT "eventos_admissao_admissao_id_fkey" FOREIGN KEY ("admissao_id") REFERENCES "admissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
