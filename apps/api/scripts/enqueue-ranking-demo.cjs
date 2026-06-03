/**
 * Demo: enfileira embedding da vaga + N currículos na fila real (BullMQ).
 * A API que está no ar consome: embedding (Voyage→pgvector) → cascata p/ matching
 * (similaridade pgvector + re-rank Claude) → grava em `scores`.
 */
const { Queue } = require('bullmq');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PREFIX = process.env.REDIS_QUEUE_PREFIX || 'triagem';
const connection = { url: REDIS_URL };

const VAGA_ID = '90a942c6-6de5-42d1-a394-049eb14c521b';
const CANDIDATURAS = [
  'd11d9b1f-8b83-4016-aabd-1c77573503bf', // Ivan Roberto Fontes
  'a55af9b0-d84e-43ca-92b9-1b8bddb858e0', // Sandro Serrano Rodrigues
  '08b4d504-0e15-4fa3-a6de-c389a0e5d0a3', // Francisco Assunção
  'fdfe6068-dd32-4f7d-be04-49d15594c373', // Joseane Iesbick Rodrigues
  '4cba538c-3113-4a44-a921-b4ec7f685ef2', // Diego Chaves Santos
  '93a35323-7614-46c9-a44c-bb6a2ac84e84', // Marcio Ferreira
];

(async () => {
  const fila = new Queue('embedding', { prefix: PREFIX, connection });
  const stamp = Date.now();

  // 1. Embedding da vaga primeiro (o matching depende dele).
  await fila.add(
    'embedding-vaga',
    { alvo: 'vaga', vagaId: VAGA_ID },
    { jobId: `emb-vaga-${VAGA_ID}-${stamp}` },
  );
  console.log(`[enqueue] embedding-vaga ${VAGA_ID}`);

  // Espera a vaga ser embedada antes de soltar os currículos.
  await new Promise((r) => setTimeout(r, 9000));

  // 2. Embedding de cada currículo (cada um cascateia p/ matching).
  for (const candidaturaId of CANDIDATURAS) {
    await fila.add(
      'embedding-curriculo',
      { alvo: 'curriculo', candidaturaId },
      { jobId: `emb-cv-${candidaturaId}-${stamp}` },
    );
    console.log(`[enqueue] embedding-curriculo ${candidaturaId}`);
  }

  await fila.close();
  console.log('[enqueue] concluído — workers processando em background.');
})().catch((e) => {
  console.error('[enqueue] erro:', e.message);
  process.exit(1);
});
