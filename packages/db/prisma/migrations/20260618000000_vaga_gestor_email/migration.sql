-- Materializa o e-mail do gestor/recrutador vindos do payload da Gupy (lower/trim),
-- para o AUTO-VÍNCULO gestor↔vaga por e-mail (escopo de acesso por papel).

-- AlterTable
ALTER TABLE "vagas" ADD COLUMN     "gestor_email" TEXT;
ALTER TABLE "vagas" ADD COLUMN     "recrutador_email" TEXT;

-- CreateIndex
CREATE INDEX "vagas_gestor_email_idx" ON "vagas"("gestor_email");
CREATE INDEX "vagas_recrutador_email_idx" ON "vagas"("recrutador_email");

-- Backfill a partir do último payload sincronizado (mesma normalização do mapper).
UPDATE "vagas"
SET
  "gestor_email"     = NULLIF(lower(trim("gupy_payload"->>'managerEmail')), ''),
  "recrutador_email" = NULLIF(lower(trim("gupy_payload"->>'recruiterEmail')), '')
WHERE "gupy_payload" IS NOT NULL;
