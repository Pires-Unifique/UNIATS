-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "papel_usuario" AS ENUM ('ADMIN', 'RECRUTADOR', 'GESTOR', 'VISUALIZADOR');

-- CreateEnum
CREATE TYPE "status_vaga" AS ENUM ('RASCUNHO', 'PUBLICADA', 'PAUSADA', 'ENCERRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "status_candidatura" AS ENUM ('EM_ANALISE', 'TRIAGEM_IA', 'APROVADO_TRIAGEM', 'ENTREVISTA_AGENDADA', 'ENTREVISTA_REALIZADA', 'APROVADO', 'REPROVADO', 'CONTRATADO', 'DESISTENTE');

-- CreateEnum
CREATE TYPE "tipo_score" AS ENUM ('SIMILARIDADE_VETORIAL', 'RANKING_CV', 'ENTREVISTA', 'TOM_DE_VOZ', 'CONSOLIDADO');

-- CreateEnum
CREATE TYPE "canal_mensagem" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "direcao_mensagem" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "status_mensagem" AS ENUM ('PENDENTE', 'ENVIADO', 'ENTREGUE', 'LIDO', 'RESPONDIDO', 'FALHADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "status_entrevista" AS ENUM ('AGENDADA', 'EM_ANDAMENTO', 'FINALIZADA', 'CANCELADA', 'NAO_COMPARECEU');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "azure_oid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "papel" "papel_usuario" NOT NULL DEFAULT 'RECRUTADOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vagas" (
    "id" UUID NOT NULL,
    "gupy_id" BIGINT NOT NULL,
    "codigo" TEXT,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "departamento" TEXT,
    "unidade" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "tipo_contrato" TEXT,
    "remoto" BOOLEAN NOT NULL DEFAULT false,
    "status" "status_vaga" NOT NULL DEFAULT 'PUBLICADA',
    "data_publicacao" TIMESTAMP(3),
    "data_fechamento" TIMESTAMP(3),
    "recrutador_id" UUID,
    "gestor_id" UUID,
    "requisitos_json" JSONB,
    "requisitos_texto" TEXT,
    "gupy_sincronizado_em" TIMESTAMP(3),
    "gupy_payload" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "vagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidatos" (
    "id" UUID NOT NULL,
    "gupy_id" BIGINT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "nome_completo" TEXT NOT NULL,
    "cpf_hash" CHAR(64),
    "linkedin_url" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "consentimento_lgpd_em" TIMESTAMP(3),
    "consentimento_lgpd_versao" TEXT,
    "consentimento_gravacao_em" TIMESTAMP(3),
    "gupy_payload" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "candidatos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidaturas" (
    "id" UUID NOT NULL,
    "gupy_id" BIGINT NOT NULL,
    "vaga_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "etapa_gupy" TEXT,
    "status" "status_candidatura" NOT NULL DEFAULT 'EM_ANALISE',
    "motivo_desclassif" TEXT,
    "inscrito_em" TIMESTAMP(3),
    "movido_em" TIMESTAMP(3),
    "gupy_payload" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculos_processados" (
    "id" UUID NOT NULL,
    "candidatura_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "arquivo_url" TEXT,
    "arquivo_sha256" CHAR(64),
    "texto_bruto" TEXT NOT NULL,
    "texto_normalizado" TEXT NOT NULL,
    "resumo" TEXT,
    "experiencias" JSONB,
    "formacoes" JSONB,
    "competencias" TEXT[],
    "idiomas" JSONB,
    "certificacoes" JSONB,
    "anos_experiencia" DOUBLE PRECISION,
    "parser_versao" TEXT NOT NULL,
    "processado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculos_processados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" UUID NOT NULL,
    "vaga_id" UUID,
    "curriculo_id" UUID,
    "trecho" TEXT NOT NULL,
    "vetor" vector(1024) NOT NULL,
    "modelo" TEXT NOT NULL,
    "modelo_versao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" UUID NOT NULL,
    "candidatura_id" UUID NOT NULL,
    "tipo" "tipo_score" NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "justificativa" TEXT NOT NULL,
    "evidencias" JSONB,
    "modelo" TEXT NOT NULL,
    "prompt_versao" TEXT,
    "revisado_por" UUID,
    "revisado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" UUID NOT NULL,
    "candidatura_id" UUID,
    "candidato_id" UUID NOT NULL,
    "canal" "canal_mensagem" NOT NULL,
    "direcao" "direcao_mensagem" NOT NULL DEFAULT 'SAIDA',
    "template_codigo" TEXT,
    "assunto" TEXT,
    "corpo" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_msg_id" TEXT,
    "status" "status_mensagem" NOT NULL DEFAULT 'PENDENTE',
    "erro" TEXT,
    "agendado_para" TIMESTAMP(3),
    "enviado_em" TIMESTAMP(3),
    "entregue_em" TIMESTAMP(3),
    "lido_em" TIMESTAMP(3),
    "respondido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrevistas" (
    "id" UUID NOT NULL,
    "candidatura_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "entrevistador_id" UUID,
    "agendada_para" TIMESTAMP(3) NOT NULL,
    "duracao_estimada_min" INTEGER NOT NULL DEFAULT 30,
    "meet_url" TEXT,
    "google_event_id" TEXT,
    "status" "status_entrevista" NOT NULL DEFAULT 'AGENDADA',
    "bot_provider" TEXT,
    "bot_session_id" TEXT,
    "bot_status" TEXT,
    "iniciada_em" TIMESTAMP(3),
    "finalizada_em" TIMESTAMP(3),
    "audio_url" TEXT,
    "audio_sha256" CHAR(64),
    "audio_expira_em" TIMESTAMP(3),
    "parecer_final" TEXT,
    "parecer_aprovado_em" TIMESTAMP(3),
    "parecer_aprovado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entrevistas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perguntas_entrevista" (
    "id" UUID NOT NULL,
    "entrevista_id" UUID,
    "vaga_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "pergunta" TEXT NOT NULL,
    "objetivo" TEXT,
    "competencia" TEXT,
    "dificuldade" TEXT,
    "resposta_esperada" TEXT,
    "modelo" TEXT NOT NULL,
    "prompt_versao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perguntas_entrevista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcricoes" (
    "id" UUID NOT NULL,
    "entrevista_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT,
    "idioma" TEXT NOT NULL DEFAULT 'pt-BR',
    "texto_completo" TEXT NOT NULL,
    "segmentos" JSONB NOT NULL,
    "resumo" TEXT,
    "topicos" TEXT[],
    "expira_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transcricoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analises_voz" (
    "id" UUID NOT NULL,
    "entrevista_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "sentimento_global" TEXT,
    "confianca_media" DOUBLE PRECISION,
    "nervosismo_medio" DOUBLE PRECISION,
    "entusiasmo_medio" DOUBLE PRECISION,
    "hesitacao_count" INTEGER,
    "segmentos" JSONB NOT NULL,
    "observacoes_llm" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analises_voz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks_recebidos" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "external_id" TEXT,
    "payload" JSONB NOT NULL,
    "assinatura_ok" BOOLEAN NOT NULL DEFAULT false,
    "processado" BOOLEAN NOT NULL DEFAULT false,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMP(3),

    CONSTRAINT "webhooks_recebidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" UUID,
    "diff" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_azure_oid_key" ON "usuarios"("azure_oid");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vagas_gupy_id_key" ON "vagas"("gupy_id");

-- CreateIndex
CREATE INDEX "vagas_status_idx" ON "vagas"("status");

-- CreateIndex
CREATE INDEX "vagas_data_publicacao_idx" ON "vagas"("data_publicacao");

-- CreateIndex
CREATE INDEX "vagas_titulo_idx" ON "vagas" USING GIN ("titulo" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "candidatos_gupy_id_key" ON "candidatos"("gupy_id");

-- CreateIndex
CREATE INDEX "candidatos_email_idx" ON "candidatos"("email");

-- CreateIndex
CREATE INDEX "candidatos_nome_completo_idx" ON "candidatos" USING GIN ("nome_completo" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "candidaturas_gupy_id_key" ON "candidaturas"("gupy_id");

-- CreateIndex
CREATE INDEX "candidaturas_status_idx" ON "candidaturas"("status");

-- CreateIndex
CREATE INDEX "candidaturas_etapa_gupy_idx" ON "candidaturas"("etapa_gupy");

-- CreateIndex
CREATE UNIQUE INDEX "candidaturas_vaga_id_candidato_id_key" ON "candidaturas"("vaga_id", "candidato_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculos_processados_candidatura_id_key" ON "curriculos_processados"("candidatura_id");

-- CreateIndex
CREATE INDEX "embeddings_vaga_id_idx" ON "embeddings"("vaga_id");

-- CreateIndex
CREATE INDEX "embeddings_curriculo_id_idx" ON "embeddings"("curriculo_id");

-- CreateIndex
CREATE INDEX "scores_candidatura_id_tipo_idx" ON "scores"("candidatura_id", "tipo");

-- CreateIndex
CREATE INDEX "mensagens_status_idx" ON "mensagens"("status");

-- CreateIndex
CREATE INDEX "mensagens_candidatura_id_idx" ON "mensagens"("candidatura_id");

-- CreateIndex
CREATE INDEX "entrevistas_status_idx" ON "entrevistas"("status");

-- CreateIndex
CREATE INDEX "entrevistas_agendada_para_idx" ON "entrevistas"("agendada_para");

-- CreateIndex
CREATE INDEX "perguntas_entrevista_entrevista_id_idx" ON "perguntas_entrevista"("entrevista_id");

-- CreateIndex
CREATE UNIQUE INDEX "transcricoes_entrevista_id_key" ON "transcricoes"("entrevista_id");

-- CreateIndex
CREATE UNIQUE INDEX "analises_voz_entrevista_id_key" ON "analises_voz"("entrevista_id");

-- CreateIndex
CREATE INDEX "webhooks_recebidos_provider_evento_processado_idx" ON "webhooks_recebidos"("provider", "evento", "processado");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_recebidos_provider_external_id_key" ON "webhooks_recebidos"("provider", "external_id");

-- CreateIndex
CREATE INDEX "registro_auditoria_entidade_entidade_id_idx" ON "registro_auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "registro_auditoria_usuario_id_idx" ON "registro_auditoria"("usuario_id");

-- CreateIndex
CREATE INDEX "registro_auditoria_criado_em_idx" ON "registro_auditoria"("criado_em");

-- AddForeignKey
ALTER TABLE "vagas" ADD CONSTRAINT "vagas_recrutador_id_fkey" FOREIGN KEY ("recrutador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vagas" ADD CONSTRAINT "vagas_gestor_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_vaga_id_fkey" FOREIGN KEY ("vaga_id") REFERENCES "vagas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculos_processados" ADD CONSTRAINT "curriculos_processados_candidatura_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculos_processados" ADD CONSTRAINT "curriculos_processados_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_vaga_id_fkey" FOREIGN KEY ("vaga_id") REFERENCES "vagas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_curriculo_id_fkey" FOREIGN KEY ("curriculo_id") REFERENCES "curriculos_processados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_candidatura_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_candidatura_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrevistas" ADD CONSTRAINT "entrevistas_candidatura_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrevistas" ADD CONSTRAINT "entrevistas_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrevistas" ADD CONSTRAINT "entrevistas_entrevistador_id_fkey" FOREIGN KEY ("entrevistador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perguntas_entrevista" ADD CONSTRAINT "perguntas_entrevista_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perguntas_entrevista" ADD CONSTRAINT "perguntas_entrevista_vaga_id_fkey" FOREIGN KEY ("vaga_id") REFERENCES "vagas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcricoes" ADD CONSTRAINT "transcricoes_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analises_voz" ADD CONSTRAINT "analises_voz_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_auditoria" ADD CONSTRAINT "registro_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- Objetos especiais que o Prisma não gera nativamente
-- =====================================================================

-- Índice HNSW para busca vetorial (cosine) — Voyage-3 (1024 dims)
CREATE INDEX IF NOT EXISTS embeddings_vetor_hnsw_idx
  ON embeddings USING hnsw (vetor vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Soft-delete coerente com LGPD (anonimização ao invés de DELETE físico)
CREATE OR REPLACE FUNCTION anonimizar_candidato(p_candidato_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE candidatos
     SET nome_completo = 'ANONIMIZADO',
         email         = NULL,
         telefone      = NULL,
         cpf_hash      = NULL,
         linkedin_url  = NULL,
         gupy_payload  = NULL,
         excluido_em   = NOW()
   WHERE id = p_candidato_id;
END;
$$ LANGUAGE plpgsql;

-- Impede DELETE de registros de auditoria (LGPD/SOX)
CREATE OR REPLACE FUNCTION impedir_delete_auditoria()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria não podem ser excluídos (LGPD/SOX)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_impedir_delete_auditoria ON registro_auditoria;
CREATE TRIGGER trg_impedir_delete_auditoria
  BEFORE DELETE ON registro_auditoria
  FOR EACH ROW EXECUTE FUNCTION impedir_delete_auditoria();
