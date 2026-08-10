-- Vaga "em aprovação" na Gupy (waiting_approval) ganha status próprio — antes
-- era gravada como RASCUNHO e não dava para filtrar separado na tela de Vagas.
ALTER TYPE "status_vaga" ADD VALUE IF NOT EXISTS 'EM_APROVACAO';
