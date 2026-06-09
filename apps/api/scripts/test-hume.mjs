#!/usr/bin/env node
/**
 * Teste isolado da Hume AI pra análise prosódica (tom de voz REAL — acústica).
 *
 * Diferente do AssemblyAI+Claude:
 *   - Hume analisa o ÁUDIO direto (pitch, energia, cadência, etc.)
 *   - Detecta 48 emoções por janela de fala, incluindo Anxiety, Confidence,
 *     Doubt, Calmness, Awkwardness, Confusion — exatamente o que importa
 *     pra avaliar nervosismo em entrevista
 *   - Funciona em qualquer idioma (a análise é prosódica, não linguística)
 *
 * Pipeline:
 *   1. Upload do áudio em multipart pro batch endpoint
 *   2. Polling do status até COMPLETED
 *   3. Download das predictions
 *   4. Salva JSON cru + resumo focado em nervosismo
 *
 * Uso:
 *   pnpm --filter @uniats/api test:hume ./caminho/do/arquivo.mp4
 *
 * Ou direto:
 *   cd apps/api
 *   node --env-file=../../.env scripts/test-hume.mjs ./caminho/do/arquivo.mp4
 *
 * Env vars:
 *   HUME_API_KEY   — obrigatória, pegar em https://platform.hume.ai/settings/keys
 *
 * Formatos: áudio (mp3, wav, m4a, ogg, webm, flac) ou vídeo (mp4, mov, mkv).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import axios from 'axios';

// ============================================================================
// 1. Carrega .env (fallback se o usuário não usar --env-file)
// ============================================================================
function loadEnvFallback() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
    resolve(import.meta.dirname, '..', '..', '..', '.env'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = value;
    }
    console.log(`[env] carregado: ${path}`);
    return;
  }
}
if (!process.env.HUME_API_KEY) loadEnvFallback();

// ============================================================================
// 2. Validação de args + env
// ============================================================================
const args = process.argv.slice(2);
if (!args.length) {
  console.error('Uso: node scripts/test-hume.mjs <caminho-do-audio>');
  process.exit(1);
}
const audioPath = args.join(' ');
const audioAbsPath = resolve(audioPath);
if (!existsSync(audioAbsPath)) {
  console.error(`Arquivo não encontrado: ${audioAbsPath}`);
  process.exit(1);
}
const HUME_API_KEY = process.env.HUME_API_KEY;
if (!HUME_API_KEY) {
  console.error('HUME_API_KEY não definida. Pegue em https://platform.hume.ai/settings/keys');
  process.exit(1);
}

// ============================================================================
// 3. Helpers Hume
// ============================================================================
const humeHttp = axios.create({
  baseURL: 'https://api.hume.ai',
  headers: { 'X-Hume-Api-Key': HUME_API_KEY },
  timeout: 120_000,
});

async function criarJob(filePath) {
  const buf = readFileSync(filePath);
  const sizeMB = (buf.length / 1024 / 1024).toFixed(2);
  console.log(`[hume] upload ${basename(filePath)} (${sizeMB} MB)...`);

  // Config: queremos análise prosódica (acústica) com granularidade por utterance.
  // O modelo "language" também extrai emoção do texto transcrito — útil de comparar.
  const config = {
    models: {
      prosody: {
        granularity: 'utterance',
        identify_speakers: true,
      },
      language: {
        granularity: 'sentence',
        identify_speakers: true,
      },
    },
    transcription: {
      language: 'pt',
    },
  };

  const form = new FormData();
  form.append('json', JSON.stringify(config));
  form.append('file', new Blob([buf]), basename(filePath));

  const resp = await humeHttp.post('/v0/batch/jobs', form, {
    maxContentLength: 1024 * 1024 * 1024,
    maxBodyLength: 1024 * 1024 * 1024,
  });
  const jobId = resp.data.job_id || resp.data.id;
  console.log(`[hume] job criado id=${jobId}`);
  return jobId;
}

async function aguardarJob(jobId) {
  const maxTentativas = 360; // 30min @ 5s
  for (let i = 0; i < maxTentativas; i++) {
    const resp = await humeHttp.get(`/v0/batch/jobs/${jobId}`);
    const status = resp.data.state?.status || resp.data.status;
    if (status === 'COMPLETED') {
      console.log('[hume] job completo.');
      return resp.data;
    }
    if (status === 'FAILED') {
      throw new Error(`Hume retornou FAILED: ${JSON.stringify(resp.data.state).slice(0, 500)}`);
    }
    if (i % 4 === 0) console.log(`[hume] polling… status=${status} (tentativa ${i + 1})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Timeout aguardando job Hume (>30min).');
}

async function buscarPredictions(jobId) {
  const resp = await humeHttp.get(`/v0/batch/jobs/${jobId}/predictions`);
  return resp.data;
}

// ============================================================================
// 4. Helpers de análise — extrai sinais úteis pra entrevista
// ============================================================================

// Emoções da Hume que importam pra avaliar nervosismo em entrevista.
// (Hume retorna 48 dimensões, mas só essas têm relevância pro caso.)
const EMOCOES_RELEVANTES = {
  nervosismo: ['Anxiety', 'Awkwardness', 'Distress', 'Fear', 'Embarrassment', 'Doubt'],
  confianca: ['Confidence', 'Calmness', 'Determination', 'Pride', 'Concentration'],
  engajamento: ['Interest', 'Excitement', 'Joy', 'Amusement', 'Satisfaction'],
  desengajamento: ['Boredom', 'Tiredness', 'Disappointment', 'Sadness'],
};

function extrairPrediction(predictions) {
  // predictions[0].results.predictions[0].models.prosody.grouped_predictions[]
  const arquivo = predictions[0];
  if (!arquivo) return { prosody: [], language: [] };
  const inner = arquivo.results?.predictions?.[0]?.models || {};
  return {
    prosody: inner.prosody?.grouped_predictions || [],
    language: inner.language?.grouped_predictions || [],
  };
}

function consolidarPorSpeaker(groupedPredictions) {
  // Cada grouped_prediction tem um speaker (id) com uma lista de predictions
  // (uma por janela de fala). Cada prediction tem emotions: [{name, score}].
  const porSpeaker = {};
  for (const grupo of groupedPredictions) {
    const speakerId = grupo.id || 'unknown';
    if (!porSpeaker[speakerId]) {
      porSpeaker[speakerId] = {
        speakerId,
        totalUtterances: 0,
        duracaoTotalS: 0,
        somasPorEmocao: {},
        utterances: [],
      };
    }
    const dados = porSpeaker[speakerId];
    for (const pred of grupo.predictions || []) {
      dados.totalUtterances++;
      const begin = pred.time?.begin ?? 0;
      const end = pred.time?.end ?? 0;
      dados.duracaoTotalS += end - begin;
      for (const e of pred.emotions || []) {
        dados.somasPorEmocao[e.name] = (dados.somasPorEmocao[e.name] || 0) + e.score;
      }
      dados.utterances.push({
        begin,
        end,
        texto: pred.text || '',
        topEmocoes: [...(pred.emotions || [])]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((e) => ({ nome: e.name, score: Number(e.score.toFixed(3)) })),
      });
    }
  }
  // Calcula médias
  for (const dados of Object.values(porSpeaker)) {
    dados.mediasPorEmocao = {};
    for (const [nome, soma] of Object.entries(dados.somasPorEmocao)) {
      dados.mediasPorEmocao[nome] = Number((soma / Math.max(1, dados.totalUtterances)).toFixed(3));
    }
    delete dados.somasPorEmocao;
  }
  return porSpeaker;
}

function calcularIndicesAgregados(mediasPorEmocao) {
  // Média das emoções de cada categoria — gera um índice macro 0-1.
  const calcular = (lista) => {
    const presentes = lista.filter((nome) => nome in mediasPorEmocao);
    if (!presentes.length) return null;
    const soma = presentes.reduce((acc, nome) => acc + mediasPorEmocao[nome], 0);
    return Number((soma / presentes.length).toFixed(3));
  };
  return {
    nervosismo: calcular(EMOCOES_RELEVANTES.nervosismo),
    confianca: calcular(EMOCOES_RELEVANTES.confianca),
    engajamento: calcular(EMOCOES_RELEVANTES.engajamento),
    desengajamento: calcular(EMOCOES_RELEVANTES.desengajamento),
  };
}

function identificarCandidato(porSpeaker) {
  // Heurística igual ao test-ia.mjs: speaker com mais tempo de fala.
  let best = null;
  for (const dados of Object.values(porSpeaker)) {
    if (!best || dados.duracaoTotalS > best.duracaoTotalS) best = dados;
  }
  return best?.speakerId || 'unknown';
}

function trajetoriaTemporal(utterances, emocoes) {
  // Divide as utterances em 3 terços e calcula média de cada categoria por terço.
  if (!utterances.length) return null;
  const tercoSize = Math.ceil(utterances.length / 3);
  const tercos = [
    utterances.slice(0, tercoSize),
    utterances.slice(tercoSize, tercoSize * 2),
    utterances.slice(tercoSize * 2),
  ];
  return tercos.map((tercos) => {
    const acc = {};
    for (const u of tercos) {
      for (const e of u.topEmocoes) {
        acc[e.nome] = (acc[e.nome] || 0) + e.score;
      }
    }
    const out = {};
    for (const [nome, soma] of Object.entries(acc)) {
      out[nome] = Number((soma / Math.max(1, tercos.length)).toFixed(3));
    }
    return out;
  });
}

// ============================================================================
// 5. Main
// ============================================================================
(async () => {
  const t0 = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(process.cwd(), 'out', `test-hume-${stamp}`);
  mkdirSync(outDir, { recursive: true });

  console.log(`\n=== test-hume ===`);
  console.log(`audio: ${audioAbsPath}`);
  console.log(`out:   ${outDir}\n`);

  try {
    const jobId = await criarJob(audioAbsPath);
    await aguardarJob(jobId);
    const predictions = await buscarPredictions(jobId);

    // Salva o JSON cru da Hume — útil pra debugar e explorar manualmente
    writeFileSync(resolve(outDir, 'hume-raw.json'), JSON.stringify(predictions, null, 2));
    console.log(`[out] hume-raw.json gravada (${JSON.stringify(predictions).length} chars)`);

    const { prosody, language } = extrairPrediction(predictions);
    if (!prosody.length) {
      console.warn('[aviso] Hume não retornou predictions de prosody — verifique se o áudio tem fala.');
      return;
    }

    // -- Consolida por speaker -------------------------------------------
    const porSpeakerProsody = consolidarPorSpeaker(prosody);
    const porSpeakerLanguage = consolidarPorSpeaker(language);
    const candidato = identificarCandidato(porSpeakerProsody);

    const dadosCandidato = porSpeakerProsody[candidato];
    const indicesProsody = calcularIndicesAgregados(dadosCandidato.mediasPorEmocao);
    const trajetoria = trajetoriaTemporal(dadosCandidato.utterances, EMOCOES_RELEVANTES.nervosismo);

    // -- Top 10 emoções do candidato (prosody) ---------------------------
    const top10Prosody = Object.entries(dadosCandidato.mediasPorEmocao)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    // -- Resumo agregado --------------------------------------------------
    const resumo = {
      candidato_speaker: candidato,
      duracao_fala_candidato_s: Number(dadosCandidato.duracaoTotalS.toFixed(1)),
      total_utterances: dadosCandidato.totalUtterances,
      indices_prosody: indicesProsody,
      top10_emocoes_prosody: top10Prosody.map(([nome, score]) => ({ nome, score })),
      trajetoria_nervosismo_3_tercos: trajetoria,
      speakers_detectados: Object.values(porSpeakerProsody).map((s) => ({
        speakerId: s.speakerId,
        duracaoS: Number(s.duracaoTotalS.toFixed(1)),
        utterances: s.totalUtterances,
      })),
    };

    writeFileSync(resolve(outDir, 'resumo.json'), JSON.stringify(resumo, null, 2));
    console.log(`[out] resumo.json gravada`);

    // Por-utterance detalhado pra inspeção manual
    writeFileSync(
      resolve(outDir, 'utterances-candidato.json'),
      JSON.stringify(dadosCandidato.utterances, null, 2),
    );
    console.log(`[out] utterances-candidato.json gravada`);

    // -- Print resumo legível --------------------------------------------
    console.log('\n=== resumo ===');
    console.log(`candidato:        speaker ${candidato}`);
    console.log(`duração fala:     ${resumo.duracao_fala_candidato_s}s em ${resumo.total_utterances} utterances`);
    console.log(`\nspeakers detectados:`);
    for (const s of resumo.speakers_detectados) {
      const tag = s.speakerId === candidato ? '← candidato' : '';
      console.log(`  ${s.speakerId.padEnd(12)} ${String(s.duracaoS).padStart(6)}s  ${String(s.utterances).padStart(4)} ut  ${tag}`);
    }
    console.log(`\nÍndices agregados (0-1, média das emoções da categoria):`);
    console.log(`  nervosismo:     ${indicesProsody.nervosismo}`);
    console.log(`  confiança:      ${indicesProsody.confianca}`);
    console.log(`  engajamento:    ${indicesProsody.engajamento}`);
    console.log(`  desengajamento: ${indicesProsody.desengajamento}`);
    console.log(`\nTop 10 emoções (prosody) do candidato:`);
    for (const [nome, score] of top10Prosody) {
      console.log(`  ${nome.padEnd(28)} ${score}`);
    }
    if (trajetoria) {
      console.log(`\nTrajetória de nervosismo (início → meio → fim):`);
      const tercoLabels = ['início', 'meio  ', 'fim   '];
      for (const emo of EMOCOES_RELEVANTES.nervosismo) {
        const scores = trajetoria.map((t) => t[emo] ?? 0);
        const linha = scores.map((s) => s.toFixed(2)).join('  →  ');
        console.log(`  ${emo.padEnd(14)} ${linha}`);
      }
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n=== concluído em ${dt}s — arquivos em ${outDir} ===`);
  } catch (err) {
    console.error('\n[ERRO]', err?.response?.data || err?.message || err);
    if (err?.response?.status) console.error(`HTTP ${err.response.status}`);
    process.exit(1);
  }
})();
