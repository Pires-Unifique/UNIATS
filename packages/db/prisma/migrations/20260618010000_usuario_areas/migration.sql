-- Áreas de acesso (módulos) do usuário — fonte de verdade da autorização.
-- Conjunto de strings: 'admin' | 'recrutamento' | 'admissao' | 'offboarding'.

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "areas" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill a partir do papel legado (continuidade):
--  ADMIN      → ['admin']        (acesso a tudo)
--  RECRUTADOR → ['recrutamento'] (vê todas as vagas + ações de recrutamento)
--  GESTOR/VISUALIZADOR → '{}'     (acesso por posse de vaga, ou nenhum)
UPDATE "usuarios" SET "areas" = ARRAY['admin']        WHERE "papel" = 'ADMIN';
UPDATE "usuarios" SET "areas" = ARRAY['recrutamento'] WHERE "papel" = 'RECRUTADOR';
