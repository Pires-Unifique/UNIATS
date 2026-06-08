-- Reverte para Voyage-3 (1024 dimensões). O provider local (transformers.js/onnx)
-- trava no carregamento do modelo dentro do worker NestJS — fica para investigação
-- dedicada. Até lá, embeddings via Voyage (1024) + cron de reconciliação.

DROP INDEX IF EXISTS embeddings_vetor_hnsw_idx;

-- Limpa vetores 768 (local) antes de alterar o tipo da coluna de volta.
DELETE FROM embeddings;

ALTER TABLE embeddings ALTER COLUMN vetor TYPE vector(1024);

CREATE INDEX IF NOT EXISTS embeddings_vetor_hnsw_idx
  ON embeddings USING hnsw (vetor vector_cosine_ops);
