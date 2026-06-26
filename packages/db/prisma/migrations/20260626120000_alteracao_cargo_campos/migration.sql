-- Alteração contratual: campos do termo DHO-301 ligados à troca de CARGO.
-- Aditiva (colunas nullable) — sem impacto em dados existentes.
ALTER TABLE "solicitacoes_alteracao_contratual"
  ADD COLUMN "cargo_descricao" TEXT,
  ADD COLUMN "diretriz_comercial" BOOLEAN,
  ADD COLUMN "periculosidade" BOOLEAN,
  ADD COLUMN "aluguel_frota" BOOLEAN;
