#!/usr/bin/env node
/**
 * Comparativo de provedores de embedding em DADOS REAIS.
 * Lê scripts/cmp-data.json ({vaga:{nome,texto}, candidatos:[{nome,texto,llm?}]}),
 * embeda os MESMOS textos com Voyage + modelos locais (e5-base, MiniLM),
 * calcula similaridade cosseno vaga×candidato e compara os rankings.
 *
 * Uso: node --env-file=../../.env scripts/compare-embeddings.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axios from 'axios';

const data = JSON.parse(readFileSync(resolve(import.meta.dirname, 'cmp-data.json'), 'utf8'));
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = process.env.VOYAGE_MODEL || 'voyage-3';

function cosseno(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// --- Voyage (1 batch) ---
async function embedVoyage(textos) {
  const r = await axios.post('https://api.voyageai.com/v1/embeddings',
    { input: textos, model: VOYAGE_MODEL, input_type: 'document' },
    { headers: { Authorization: `Bearer ${VOYAGE_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 });
  return r.data.data.sort((a,b)=>a.index-b.index).map(e=>e.embedding);
}

// --- local (transformers.js) ---
async function embedLocal(modelId, vagaTexto, candTextos) {
  const { pipeline } = await import('@xenova/transformers');
  const ext = await pipeline('feature-extraction', modelId);
  const ehE5 = /e5/i.test(modelId);
  const q = ehE5 ? 'query: ' : '';
  const p = ehE5 ? 'passage: ' : '';
  const oVaga = await ext([q + vagaTexto], { pooling: 'mean', normalize: true });
  const oCand = await ext(candTextos.map(t => p + t), { pooling: 'mean', normalize: true });
  return { vaga: oVaga.tolist()[0], cands: oCand.tolist() };
}

function ranquear(vagaVec, candVecs, nomes) {
  return nomes.map((nome, i) => ({ nome, sim: cosseno(vagaVec, candVecs[i]) }))
    .sort((a,b)=>b.sim-a.sim)
    .map((r,pos)=>({ ...r, rank: pos+1 }));
}

// correlação de Spearman entre dois rankings (por nome)
function spearman(rkA, rkB) {
  const posA = new Map(rkA.map(r=>[r.nome, r.rank]));
  const posB = new Map(rkB.map(r=>[r.nome, r.rank]));
  const n = rkA.length;
  let d2 = 0;
  for (const nome of posA.keys()) { const d = posA.get(nome)-posB.get(nome); d2 += d*d; }
  return 1 - (6*d2)/(n*(n*n-1));
}

(async () => {
  const nomes = data.candidatos.map(c => c.nome);
  const candTextos = data.candidatos.map(c => c.texto);
  console.log(`\n=== Comparativo de embeddings ===`);
  console.log(`vaga: ${data.vaga.nome}`);
  console.log(`candidatos: ${nomes.length}\n`);

  // Voyage
  let rkVoyage = null;
  if (VOYAGE_KEY) {
    process.stdout.write('[voyage] embedando (1 batch)… ');
    const v = await embedVoyage([data.vaga.texto, ...candTextos]);
    rkVoyage = ranquear(v[0], v.slice(1), nomes);
    console.log('ok');
  } else { console.log('[voyage] sem chave — pulando'); }

  // Locais
  const modelos = [
    ['e5-base', 'Xenova/multilingual-e5-base'],
    ['MiniLM-L12', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'],
  ];
  const rkLocal = {};
  for (const [label, id] of modelos) {
    process.stdout.write(`[${label}] carregando + embedando… `);
    const t0 = Date.now();
    const { vaga, cands } = await embedLocal(id, data.vaga.texto, candTextos);
    rkLocal[label] = ranquear(vaga, cands, nomes);
    console.log(`ok (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  }

  // Tabela comparativa (ordenada pelo ranking do Voyage, se houver, senão e5)
  const base = rkVoyage ?? rkLocal['e5-base'];
  const posOf = (rk, nome) => rk.find(r=>r.nome===nome);
  console.log('\n=== ranking (sim | #pos) por método ===');
  const head = ['candidato'.padEnd(32), 'voyage', 'e5-base', 'MiniLM', 'LLM(Claude)'];
  console.log(head.join(' | '));
  for (const { nome } of base) {
    const cand = data.candidatos.find(c=>c.nome===nome);
    const cells = [nome.slice(0,32).padEnd(32)];
    cells.push(rkVoyage ? `${posOf(rkVoyage,nome).sim.toFixed(3)} #${posOf(rkVoyage,nome).rank}` : '-');
    cells.push(`${posOf(rkLocal['e5-base'],nome).sim.toFixed(3)} #${posOf(rkLocal['e5-base'],nome).rank}`);
    cells.push(`${posOf(rkLocal['MiniLM-L12'],nome).sim.toFixed(3)} #${posOf(rkLocal['MiniLM-L12'],nome).rank}`);
    cells.push(cand.llm != null ? `${cand.llm}` : '-');
    console.log(cells.join(' | '));
  }

  // Correlações de ranking
  console.log('\n=== correlação de Spearman dos rankings ===');
  if (rkVoyage) {
    console.log(`voyage × e5-base : ${spearman(rkVoyage, rkLocal['e5-base']).toFixed(3)}`);
    console.log(`voyage × MiniLM  : ${spearman(rkVoyage, rkLocal['MiniLM-L12']).toFixed(3)}`);
  }
  // contra o LLM (Claude), se houver scores
  if (data.candidatos.every(c => c.llm != null)) {
    const rkLLM = data.candidatos.map(c=>({nome:c.nome, sim:c.llm}))
      .sort((a,b)=>b.sim-a.sim).map((r,p)=>({...r,rank:p+1}));
    console.log('--- vs ranking do Claude (alvo de qualidade) ---');
    if (rkVoyage) console.log(`voyage  × LLM : ${spearman(rkVoyage, rkLLM).toFixed(3)}`);
    console.log(`e5-base × LLM : ${spearman(rkLocal['e5-base'], rkLLM).toFixed(3)}`);
    console.log(`MiniLM  × LLM : ${spearman(rkLocal['MiniLM-L12'], rkLLM).toFixed(3)}`);
  }
  console.log('\n=== fim ===');
})().catch(e => { console.error('ERRO:', e?.response?.data || e.message); process.exit(1); });
