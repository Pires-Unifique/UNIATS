#!/usr/bin/env node
/**
 * Smoke test isolado da integração com o Voyage AI (embeddings).
 *
 *   1. Lê a config do .env (VOYAGE_API_KEY / MODEL / DIMENSIONS / BASE_URL)
 *   2. Embeda 1 "vaga" + N "currículos" de exemplo via /v1/embeddings
 *   3. Valida que a dimensão bate com VOYAGE_DIMENSIONS
 *   4. Calcula a similaridade cosseno vaga × currículo (mesma fórmula do pgvector)
 *   5. Ordena os candidatos pela aderência — exatamente o que o ranking faz em prod
 *
 * Uso:
 *   cd apps/api
 *   node --env-file=../../.env scripts/test-voyage.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import axios from 'axios';

// --- fallback de .env (caso não rode com --env-file) ------------------------
function loadEnvFallback() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
    resolve(import.meta.dirname, '..', '..', '..', '.env'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && !(k in process.env)) process.env[k] = v;
    }
    console.log(`[env] carregado: ${path}`);
    return;
  }
}
if (!process.env.VOYAGE_API_KEY) loadEnvFallback();

const API_KEY = process.env.VOYAGE_API_KEY;
const MODEL = process.env.VOYAGE_MODEL || 'voyage-3';
const DIMS = Number(process.env.VOYAGE_DIMENSIONS || 1024);
const BASE = process.env.VOYAGE_API_BASE_URL || 'https://api.voyageai.com';

if (!API_KEY) {
  console.error('VOYAGE_API_KEY não definida.');
  process.exit(1);
}

// --- dados de exemplo -------------------------------------------------------
const vaga = {
  titulo: 'Pessoa Desenvolvedora Back-end Pleno',
  texto:
    'Vaga: Desenvolvedor(a) Back-end Pleno. Responsável por APIs em Node.js e ' +
    'NestJS, integração com PostgreSQL, filas com Redis/BullMQ e deploy em ' +
    'containers Docker. Requisitos: TypeScript, testes automatizados, ' +
    'experiência com mensageria e bancos relacionais. Desejável: AWS/S3, CI/CD.',
};

const curriculos = [
  {
    nome: 'Ana — back-end Node',
    texto:
      'Desenvolvedora back-end com 5 anos em Node.js e NestJS. Construí APIs ' +
      'REST em TypeScript, modelagem em PostgreSQL, filas com BullMQ/Redis e ' +
      'pipelines de CI/CD. Experiência com Docker e storage S3.',
  },
  {
    nome: 'Bruno — front-end React',
    texto:
      'Desenvolvedor front-end com 4 anos em React, Next.js e CSS. Foco em UI, ' +
      'acessibilidade e design systems. Pouca experiência com back-end.',
  },
  {
    nome: 'Carla — analista financeiro',
    texto:
      'Analista financeira com 8 anos em controladoria, fluxo de caixa, Excel ' +
      'avançado e conciliação bancária. Sem experiência com programação.',
  },
];

// --- cliente Voyage (mesma chamada do voyage.client.ts) ---------------------
const http = axios.create({
  baseURL: BASE,
  timeout: Number(process.env.VOYAGE_TIMEOUT_MS || 20000),
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
});

async function embed(textos, inputType) {
  const resp = await http.post('/v1/embeddings', {
    input: textos,
    model: MODEL,
    input_type: inputType,
  });
  const ordenados = [...resp.data.data].sort((a, b) => a.index - b.index);
  return {
    vetores: ordenados.map((e) => e.embedding),
    usage: resp.data.usage,
    modelo: resp.data.model,
  };
}

function cosseno(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

(async () => {
  const t0 = Date.now();
  console.log(`\n=== test-voyage ===`);
  console.log(`modelo=${MODEL} dimensoes_esperadas=${DIMS} base=${BASE}\n`);

  try {
    const todos = [vaga.texto, ...curriculos.map((c) => c.texto)];
    const out = await embed(todos, 'document');

    const dim = out.vetores[0].length;
    console.log(`[voyage] ok — modelo=${out.modelo} tokens=${out.usage.total_tokens}`);
    console.log(`[voyage] dimensão retornada=${dim} ${dim === DIMS ? '✓ bate com .env' : '✗ DIVERGE de ' + DIMS}\n`);

    const vetorVaga = out.vetores[0];
    const ranking = curriculos.map((c, i) => {
      const sim = cosseno(vetorVaga, out.vetores[i + 1]);
      // mesma conversão usada no matching.service.ts (distância cosseno → 0..100)
      const distancia = 1 - sim;
      const similaridadeVetorial = Math.max(0, Math.min(100, (1 - distancia / 2) * 100));
      return { nome: c.nome, sim, similaridadeVetorial };
    });

    ranking.sort((a, b) => b.sim - a.sim);

    console.log(`=== ranking por aderência à vaga "${vaga.titulo}" ===`);
    ranking.forEach((r, pos) => {
      console.log(
        `  ${pos + 1}. ${r.nome.padEnd(28)} ` +
        `cosseno=${r.sim.toFixed(4)}  score_vetorial=${r.similaridadeVetorial.toFixed(1)}/100`,
      );
    });

    console.log(`\n=== concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
  } catch (err) {
    const status = err?.response?.status;
    console.error('\n[ERRO]', status ? `status=${status}` : '', err?.response?.data || err?.message || err);
    process.exit(1);
  }
})();
