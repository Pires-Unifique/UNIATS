-- Agendamento via Microsoft Graph (reunião Teams + bloqueio de agenda + convite nativo).

-- AlterTable: campos do Graph na entrevista
ALTER TABLE "entrevistas" ADD COLUMN     "graph_event_id" TEXT;
ALTER TABLE "entrevistas" ADD COLUMN     "teams_join_url" TEXT;
ALTER TABLE "entrevistas" ADD COLUMN     "provedor_video" TEXT;

-- AlterTable: vínculo enquete → entrevista (idempotência ao confirmar)
ALTER TABLE "enquetes_horario" ADD COLUMN     "entrevista_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "enquetes_horario_entrevista_id_key" ON "enquetes_horario"("entrevista_id");

-- AddForeignKey
ALTER TABLE "enquetes_horario" ADD CONSTRAINT "enquetes_horario_entrevista_id_fkey" FOREIGN KEY ("entrevista_id") REFERENCES "entrevistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
