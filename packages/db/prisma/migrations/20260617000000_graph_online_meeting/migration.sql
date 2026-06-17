-- Plano B: persiste o onlineMeetingId (e o organizador) resolvidos na CRIAÇÃO da
-- reunião, para o pull do transcript usar o id direto, sem redescobrir por
-- `$filter=JoinWebUrl eq` (match exato de URL, frágil quanto a encoding/contexto).

-- AlterTable
ALTER TABLE "entrevistas" ADD COLUMN     "graph_online_meeting_id" TEXT;
ALTER TABLE "entrevistas" ADD COLUMN     "graph_organizador_email" TEXT;
