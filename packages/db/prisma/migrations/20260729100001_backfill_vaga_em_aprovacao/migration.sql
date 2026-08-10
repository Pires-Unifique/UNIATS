-- Corrige as vagas já sincronizadas: quem veio da Gupy como waiting_approval
-- estava gravado como RASCUNHO. O payload bruto preserva o status original.
-- (Migration separada da anterior: o Postgres não deixa USAR um valor novo de
-- enum na mesma transação em que ele foi adicionado.)
UPDATE "vagas"
SET "status" = 'EM_APROVACAO'
WHERE "status" = 'RASCUNHO'
  AND "gupy_payload"->>'status' = 'waiting_approval';
