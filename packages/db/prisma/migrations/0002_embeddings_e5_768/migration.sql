-- Embeddings locais (Xenova/multilingual-e5-base → 768 dimensões).
-- Os vetores antigos (Voyage-3, 1024 dims) são incompatíveis com a nova dimensão,
-- então são removidos; o cron de reconciliação re-embeda tudo com o provider local.
--
-- Para voltar ao Voyage (1024), reverta a dimensão e re-embede.

DROP INDEX IF EXISTS embeddings_vetor_hnsw_idx;

-- Limpa vetores 1024 antes de alterar o tipo da coluna (cast 1024→768 não existe).
DELETE FROM embeddings;

ALTER TABLE embeddings ALTER COLUMN vetor TYPE vector(768);

-- Recria o índice HNSW (cosine) na nova dimensão.
CREATE INDEX IF NOT EXISTS embeddings_vetor_hnsw_idx
  ON embeddings USING hnsw (vetor vector_cosine_ops);
