-- Notificações internas (sino no header) para usuários do sistema.
-- Aditiva: novo enum + nova tabela + FK para usuarios. Não altera dados existentes.

-- CreateEnum
CREATE TYPE "tipo_notificacao" AS ENUM ('HORARIO_CONFIRMADO', 'ANALISE_PRONTA');

-- CreateTable
CREATE TABLE "notificacoes" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" "tipo_notificacao" NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "link" TEXT,
    "referencia_id" UUID,
    "lida_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notificacoes_usuario_id_tipo_referencia_id_key" ON "notificacoes"("usuario_id", "tipo", "referencia_id");

-- CreateIndex
CREATE INDEX "notificacoes_usuario_id_lida_em_idx" ON "notificacoes"("usuario_id", "lida_em");

-- CreateIndex
CREATE INDEX "notificacoes_usuario_id_criado_em_idx" ON "notificacoes"("usuario_id", "criado_em");

-- AddForeignKey
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
