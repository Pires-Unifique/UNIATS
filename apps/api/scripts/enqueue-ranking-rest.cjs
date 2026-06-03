/**
 * Re-enfileira os 4 currículos restantes com DELAY crescente, para respeitar
 * o rate limit da chave Voyage (~3 req/min no trial).
 */
const { Queue } = require('bullmq');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PREFIX = process.env.REDIS_QUEUE_PREFIX || 'triagem';
const connection = { url: REDIS_URL };

const RESTANTES = [
  '08b4d504-0e15-4fa3-a6de-c389a0e5d0a3', // Francisco Assunção
  'fdfe6068-dd32-4f7d-be04-49d15594c373', // Joseane Iesbick Rodrigues
  '4cba538c-3113-4a44-a921-b4ec7f685ef2', // Diego Chaves Santos
  '93a35323-7614-46c9-a44c-bb6a2ac84e84', // Marcio Ferreira
];

(async () => {
  const fila = new Queue('embedding', { prefix: PREFIX, connection });
  const stamp = Date.now();
  let delay = 2000;
  for (const candidaturaId of RESTANTES) {
    await fila.add(
      'embedding-curriculo',
      { alvo: 'curriculo', candidaturaId },
      { jobId: `emb-cv-${candidaturaId}-${stamp}`, delay },
    );
    console.log(`[enqueue] ${candidaturaId} delay=${delay / 1000}s`);
    delay += 25000; // 25s entre cada → ~2.4 req/min, abaixo do limite
  }
  await fila.close();
  console.log('[enqueue] 4 jobs agendados com espaçamento.');
})().catch((e) => {
  console.error('[enqueue] erro:', e.message);
  process.exit(1);
});
