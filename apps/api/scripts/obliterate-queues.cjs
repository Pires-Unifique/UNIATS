/**
 * Limpa (obliterate) as filas de embedding e matching — remove jobs travados.
 * Use só com o worker parado, para começar do zero.
 */
const { Queue } = require('bullmq');
const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };
const PREFIX = process.env.REDIS_QUEUE_PREFIX || 'triagem';

(async () => {
  for (const nome of ['embedding', 'matching']) {
    const q = new Queue(nome, { prefix: PREFIX, connection });
    const antes = await q.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed');
    await q.obliterate({ force: true });
    console.log(`[${nome}] obliterada. antes: ${JSON.stringify(antes)}`);
    await q.close();
  }
  console.log('OK — filas limpas.');
})().catch((e) => { console.error('erro:', e.message); process.exit(1); });
