-- CreateTable
CREATE TABLE "enquetes_horario" (
    "id" UUID NOT NULL,
    "candidatura_id" UUID NOT NULL,
    "candidato_id" UUID NOT NULL,
    "canal" "canal_mensagem" NOT NULL DEFAULT 'WHATSAPP',
    "provider" TEXT NOT NULL DEFAULT 'waha',
    "provider_msg_id" TEXT,
    "pergunta" TEXT NOT NULL,
    "opcoes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "opcao_escolhida" TEXT,
    "inicio_escolhido" TIMESTAMP(3),
    "fim_escolhido" TIMESTAMP(3),
    "respondido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enquetes_horario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enquetes_horario_provider_msg_id_idx" ON "enquetes_horario"("provider_msg_id");

-- CreateIndex
CREATE INDEX "enquetes_horario_candidatura_id_idx" ON "enquetes_horario"("candidatura_id");

-- AddForeignKey
ALTER TABLE "enquetes_horario" ADD CONSTRAINT "enquetes_horario_candidatura_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquetes_horario" ADD CONSTRAINT "enquetes_horario_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
