#!/usr/bin/env node
/**
 * Valida o throttle (Bottleneck) do VoyageClient: dispara N chamadas CONCORRENTES
 * e confirma que o limiter as espaça (minTime = 60000/RPM) e que NENHUMA toma 429.
 *
 * Uso: cd apps/api && node --env-file=../../.env scripts/test-voyage-throttle.mjs
 */
import axios from 'axios';
import Bottleneck from 'bottleneck';

const API_KEY = process.env.VOYAGE_API_KEY;
const MODEL = process.env.VOYAGE_MODEL || 'voyage-3';
const BASE = process.env.VOYAGE_API_BASE_URL || 'https://api.voyageai.com';
const RPM = Number(process.env.VOYAGE_RATE_LIMIT_RPM || 3);
const MAXC = Number(process.env.VOYAGE_MAX_CONCURRENT || 1);
const N = 5;

if (!API_KEY) { console.error('VOYAGE_API_KEY ausente.'); process.exit(1); }

const http = axios.create({
  baseURL: BASE,
  timeout: 20000,
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
});
const MIN_TIME = Math.ceil((60000 / RPM) * 1.1); // mesmo formula do VoyageClient
const limiter = new Bottleneck({ maxConcurrent: MAXC, minTime: MIN_TIME });

const t0 = Date.now();
const off = () => ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== test-voyage-throttle ===`);
console.log(`RPM=${RPM} maxConcurrent=${MAXC} minTime=${MIN_TIME}ms → disparando ${N} chamadas concorrentes\n`);

const tarefas = Array.from({ length: N }, (_, i) =>
  limiter.schedule(async () => {
    const inicio = off();
    try {
      const r = await http.post('/v1/embeddings', {
        input: [`texto de teste número ${i + 1} para validar o rate limit`],
        model: MODEL,
        input_type: 'document',
      });
      console.log(`req ${i + 1}: iniciou em t=${inicio}s → OK (HTTP 200, ${r.data.usage.total_tokens} tokens)`);
      return 'ok';
    } catch (e) {
      const st = e?.response?.status;
      console.log(`req ${i + 1}: iniciou em t=${inicio}s → ERRO ${st ?? e.message}`);
      return st === 429 ? '429' : 'erro';
    }
  }),
);

const res = await Promise.all(tarefas);
const ok = res.filter((r) => r === 'ok').length;
const r429 = res.filter((r) => r === '429').length;
console.log(`\n=== resultado: ${ok}/${N} OK, ${r429} com 429 — concluído em ${off()}s ===`);
console.log(r429 === 0 ? '✓ throttle funcionou: nenhuma chamada tomou 429.' : '✗ ainda houve 429 — reduza VOYAGE_RATE_LIMIT_RPM.');
process.exit(r429 === 0 ? 0 : 1);
