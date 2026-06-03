#!/usr/bin/env node
/**
 * Replica o caminho EXATO do VoyageClient (axios + axios-retry + Bottleneck)
 * para capturar o erro real por trás de "Falha ao chamar Voyage." no app.
 */
import axios, { isAxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';

const KEY = process.env.VOYAGE_API_KEY;
const MODEL = process.env.VOYAGE_MODEL || 'voyage-3';
const BASE = process.env.VOYAGE_API_BASE_URL || 'https://api.voyageai.com';

const http = axios.create({
  baseURL: BASE,
  timeout: Number(process.env.VOYAGE_TIMEOUT_MS || 20000),
  headers: {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': 'triagem-api/1.0 (+voyage-client)',
  },
});

console.log('axios-retry typeof:', typeof axiosRetry, '| keys:', Object.keys(axiosRetry || {}));
try {
  axiosRetry(http, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (e) => {
      const s = e.response?.status;
      return axiosRetry.isNetworkOrIdempotentRequestError(e) || s === 429 || (s !== undefined && s >= 500);
    },
  });
  console.log('axiosRetry aplicado OK');
} catch (e) {
  console.log('ERRO ao aplicar axiosRetry:', e.message);
}

const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 22000 });

(async () => {
  try {
    const resp = await limiter.schedule(() =>
      http.post('/v1/embeddings', { input: ['replica do voyage client'], model: MODEL, input_type: 'document' }),
    );
    console.log('OK — status', resp.status, '| dims', resp.data?.data?.[0]?.embedding?.length);
  } catch (err) {
    console.log('--- FALHOU ---');
    console.log('isAxiosError:', isAxiosError(err));
    console.log('name:', err?.name);
    console.log('code:', err?.code);
    console.log('message:', err?.message);
    console.log('response.status:', err?.response?.status);
    console.log('response.data:', JSON.stringify(err?.response?.data)?.slice(0, 300));
    console.log('stack[0]:', String(err?.stack || '').split('\n').slice(0, 3).join(' | '));
  }
})();
