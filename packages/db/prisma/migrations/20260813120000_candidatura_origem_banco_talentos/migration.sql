-- Candidato PUXADO do banco de talentos para uma vaga.
--
-- Até aqui toda candidatura era espelho de uma inscrição na Gupy, então
-- `gupy_id` era obrigatório. Agora o recrutador pode trazer para a vaga alguém
-- que se inscreveu no banco de talentos (vaga `talent_pool`) e nunca se
-- candidatou a ESTA vaga — essa candidatura nasce local e não tem id na Gupy.
--
-- Duas mudanças:
--   1. `gupy_id` passa a aceitar NULL (o índice UNIQUE do Postgres permite
--      múltiplos NULLs, então nada colide).
--   2. `origem` marca de onde a candidatura veio, para a tela sinalizar que
--      aquela pessoa não se inscreveu na vaga — ela foi indicada.

CREATE TYPE "origem_candidatura" AS ENUM ('GUPY', 'BANCO_TALENTOS');

ALTER TABLE "candidaturas" ALTER COLUMN "gupy_id" DROP NOT NULL;

ALTER TABLE "candidaturas"
  ADD COLUMN "origem" "origem_candidatura" NOT NULL DEFAULT 'GUPY',
  -- Quem puxou e quando (auditoria: é uma decisão humana, não automática).
  ADD COLUMN "puxado_por" UUID,
  ADD COLUMN "puxado_em" TIMESTAMP(3);

-- A listagem por vaga filtra/destaca os indicados; o índice evita varrer a
-- vaga inteira para achar os poucos que vieram do banco.
CREATE INDEX "candidaturas_vaga_origem_idx" ON "candidaturas"("vaga_id", "origem");
