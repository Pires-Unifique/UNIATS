// Runner LOCAL descartável (não versionar) — sobe o bot numa call real, headful.
// Uso: JOIN_URL="<url>" node run-local.cjs
const { capturarReuniao } = require('./dist/teams-meeting.js');
const { criarLogger } = require('./dist/logger.js');
const fs = require('node:fs');

async function main() {
  const joinUrl = process.env.JOIN_URL || process.argv[2];
  if (!joinUrl) {
    console.error('Defina JOIN_URL.');
    process.exit(1);
  }
  const logger = criarLogger({ level: 'debug', pretty: true });
  const r = await capturarReuniao(
    {
      joinUrl,
      displayName: process.env.NOME || 'Assistente de Transcrição (UniATS)',
      headless: false, // VISÍVEL: você vê o bot entrar e admite do lobby
      navTimeoutMs: 60_000,
      lobbyTimeoutMs: Number(process.env.LOBBY_MIN || 5) * 60_000,
      maxDuracaoMin: Number(process.env.MAX_MIN || 15),
      ociosidadeMin: Number(process.env.OCIOSIDADE_MIN || 4),
      captionLang: 'pt-br',
    },
    logger,
  );
  console.log('\n===== RESULTADO =====');
  console.log(
    `entrou=${r.entrou} legendasLigadas=${r.legendasLigadas} segmentos=${r.segmentos.length}`,
  );
  console.log('\n--- TRANSCRIÇÃO ---\n' + (r.texto || '(vazio)'));
  fs.writeFileSync('resultado-local.json', JSON.stringify(r, null, 2));
  console.log('\n(resultado salvo em resultado-local.json)');
}
main().catch((e) => {
  console.error('FALHA:', e);
  process.exit(1);
});
