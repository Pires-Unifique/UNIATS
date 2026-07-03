-- Vaga aprovada na Gupy (aprovação interna concluída) mas ainda não publicada.
-- Aditiva: só acrescenta o valor ao enum; nenhuma linha existente muda.
ALTER TYPE "status_vaga" ADD VALUE IF NOT EXISTS 'APROVADA';
