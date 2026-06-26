-- Pré-reserva de agenda: holds tentativos por horário proposto, por participante.
-- Guarda os ids dos eventos criados na agenda de cada participante (recrutador +
-- obrigatórios) para apagá-los no auto-confirm (sobra só o escolhido) ou no cron de
-- limpeza. Coluna ADITIVA e nullable.

-- AlterTable
ALTER TABLE "enquetes_horario" ADD COLUMN "holds" JSONB;
