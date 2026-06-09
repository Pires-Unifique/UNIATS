/**
 * Seed de DADOS FALSOS para visualizar o Painel Analítico (/analise) populado.
 *
 * NÃO use em produção. É idempotente: tudo que cria fica marcado e é apagado
 * num novo run:
 *   - vagas/candidatos com gupy_id >= OFFSET_FAKE
 *   - usuários com azure_oid começando em "seed-"
 *
 * Rode:  pnpm --filter @uniats/db run seed:fake
 */
import {
  PrismaClient,
  PapelUsuario,
  StatusVaga,
  StatusCandidatura,
  StatusEntrevista,
  TipoScore,
} from '@prisma/client';

const prisma = new PrismaClient();

const OFFSET_FAKE = 900_000_000n;
let gupySeq = OFFSET_FAKE;
const proxGupy = () => ++gupySeq;

// ---------- utilidades de aleatoriedade ----------
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)];
const chance = (p: number) => Math.random() < p;
const MS_DIA = 86_400_000;
const diasAtras = (n: number) => new Date(Date.now() - n * MS_DIA);
const addDias = (d: Date, n: number) => new Date(d.getTime() + n * MS_DIA);
const addMin = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

// ---------- pools de texto ----------
const NOMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique',
  'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Natan', 'Olívia', 'Pedro',
  'Quésia', 'Rafael', 'Sofia', 'Thiago', 'Úrsula', 'Vinícius', 'Wagner', 'Yara',
];
const SOBRENOMES = [
  'Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Lima', 'Costa', 'Almeida',
  'Ferreira', 'Rodrigues', 'Gomes', 'Martins', 'Araújo', 'Ribeiro', 'Carvalho',
];
const DEPARTAMENTOS = [
  'Tecnologia', 'Comercial', 'Atendimento', 'Infraestrutura',
  'Financeiro', 'Recursos Humanos', 'Marketing',
];
const CIDADES: Array<[string, string]> = [
  ['Blumenau', 'SC'], ['Florianópolis', 'SC'], ['Joinville', 'SC'],
  ['Curitiba', 'PR'], ['Porto Alegre', 'RS'], ['São Paulo', 'SP'],
];
const TITULOS_VAGA = [
  'Analista de Suporte N2', 'Desenvolvedor(a) Back-end', 'Técnico de Campo',
  'Consultor(a) de Vendas', 'Analista de Infraestrutura', 'Analista Financeiro',
  'Analista de Marketing', 'Engenheiro(a) de Redes', 'Desenvolvedor(a) Front-end',
  'Assistente Administrativo', 'Coordenador(a) de Atendimento', 'SRE Pleno',
  'Analista de Dados', 'Especialista em Segurança', 'Designer de Produto',
];

const nomeCompleto = () => `${pick(NOMES)} ${pick(SOBRENOMES)} ${pick(SOBRENOMES)}`;
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '');

// Distribuição da etapa mais avançada que cada candidatura alcançou.
// Soma = 1. Modela um funil decrescente realista + saídas (reprovado/desistente).
const DISTRIBUICAO: Array<{ status: StatusCandidatura; peso: number }> = [
  { status: StatusCandidatura.EM_ANALISE, peso: 0.34 },
  { status: StatusCandidatura.TRIAGEM_IA, peso: 0.1 },
  { status: StatusCandidatura.APROVADO_TRIAGEM, peso: 0.08 },
  { status: StatusCandidatura.ENTREVISTA_AGENDADA, peso: 0.09 },
  { status: StatusCandidatura.ENTREVISTA_REALIZADA, peso: 0.08 },
  { status: StatusCandidatura.APROVADO, peso: 0.05 },
  { status: StatusCandidatura.CONTRATADO, peso: 0.05 },
  { status: StatusCandidatura.REPROVADO, peso: 0.16 },
  { status: StatusCandidatura.DESISTENTE, peso: 0.05 },
];
function sortearStatus(): StatusCandidatura {
  const r = Math.random();
  let acc = 0;
  for (const d of DISTRIBUICAO) {
    acc += d.peso;
    if (r < acc) return d.status;
  }
  return StatusCandidatura.EM_ANALISE;
}

// Conjuntos para decidir evidências coerentes com o status.
const PASSOU_TRIAGEM = new Set<StatusCandidatura>([
  StatusCandidatura.TRIAGEM_IA,
  StatusCandidatura.APROVADO_TRIAGEM,
  StatusCandidatura.ENTREVISTA_AGENDADA,
  StatusCandidatura.ENTREVISTA_REALIZADA,
  StatusCandidatura.APROVADO,
  StatusCandidatura.CONTRATADO,
]);
const TEVE_ENTREVISTA = new Set<StatusCandidatura>([
  StatusCandidatura.ENTREVISTA_AGENDADA,
  StatusCandidatura.ENTREVISTA_REALIZADA,
  StatusCandidatura.APROVADO,
  StatusCandidatura.CONTRATADO,
]);
const ENTREVISTA_CONCLUIDA = new Set<StatusCandidatura>([
  StatusCandidatura.ENTREVISTA_REALIZADA,
  StatusCandidatura.APROVADO,
  StatusCandidatura.CONTRATADO,
]);

async function limpar() {
  // Vaga -> cascade candidaturas/scores/entrevistas/perguntas/embeddings.
  const v = await prisma.vaga.deleteMany({ where: { gupy_id: { gte: OFFSET_FAKE } } });
  const c = await prisma.candidato.deleteMany({ where: { gupy_id: { gte: OFFSET_FAKE } } });
  const u = await prisma.usuario.deleteMany({ where: { azure_oid: { startsWith: 'seed-' } } });
  console.log(`[seed:fake] limpeza: ${v.count} vagas, ${c.count} candidatos, ${u.count} usuários`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed de dados falsos bloqueado em produção');
  }

  await limpar();

  // ---------- usuários (recrutadores + gestores) ----------
  const recrutadores = await Promise.all(
    ['Marina Recrutadora', 'Carlos Recrutador', 'Patrícia RH', 'Rodrigo Talentos', 'Juliana Seleção'].map(
      (nome, i) =>
        prisma.usuario.create({
          data: {
            azure_oid: `seed-rec-${i}`,
            email: `${slug(nome)}@seed.local`,
            nome,
            papel: PapelUsuario.RECRUTADOR,
            ativo: true,
          },
        }),
    ),
  );
  const gestores = await Promise.all(
    ['Fernanda Gestora', 'Marcelo Líder', 'Beatriz Diretora'].map((nome, i) =>
      prisma.usuario.create({
        data: {
          azure_oid: `seed-ges-${i}`,
          email: `${slug(nome)}@seed.local`,
          nome,
          papel: PapelUsuario.GESTOR,
          ativo: true,
        },
      }),
    ),
  );
  const entrevistadores = [...recrutadores, ...gestores];

  // ---------- vagas ----------
  const NUM_VAGAS = 14;
  const vagas = [];
  for (let i = 0; i < NUM_VAGAS; i++) {
    const [cidade, estado] = pick(CIDADES);
    const publicadaHa = randInt(20, 200);
    const encerrada = chance(0.25);
    vagas.push(
      await prisma.vaga.create({
        data: {
          gupy_id: proxGupy(),
          codigo: `FAKE-${1000 + i}`,
          titulo: TITULOS_VAGA[i % TITULOS_VAGA.length],
          departamento: pick(DEPARTAMENTOS),
          unidade: cidade,
          cidade,
          estado,
          remoto: chance(0.4),
          status: encerrada ? StatusVaga.ENCERRADA : StatusVaga.PUBLICADA,
          data_publicacao: diasAtras(publicadaHa),
          data_fechamento: encerrada ? diasAtras(randInt(1, publicadaHa - 1)) : null,
          recrutador_id: pick(recrutadores).id,
          gestor_id: pick(gestores).id,
        },
      }),
    );
  }

  // ---------- candidaturas + scores + entrevistas ----------
  let totalCand = 0;
  let totalScores = 0;
  let totalEntrevistas = 0;

  for (const vaga of vagas) {
    const qtd = randInt(18, 70);
    for (let j = 0; j < qtd; j++) {
      const [cidade, estado] = pick(CIDADES);
      const nome = nomeCompleto();
      const inscrito = diasAtras(randInt(5, 180));
      const status = sortearStatus();

      const candidato = await prisma.candidato.create({
        data: {
          gupy_id: proxGupy(),
          nome_completo: nome,
          email: `${slug(nome)}.${randInt(1, 9999)}@email.com`,
          telefone: `4799${randInt(1000000, 9999999)}`,
          cidade,
          estado,
        },
      });

      // movido_em: última movimentação após a inscrição (dirige o time-to-hire).
      const diasAteMover = randInt(1, 45);
      const movido = addDias(inscrito, Math.min(diasAteMover, randInt(1, 175)));

      // Evidências coerentes.
      const scores: Array<{
        tipo: TipoScore;
        valor: number;
        justificativa: string;
        modelo: string;
        criado_em: Date;
      }> = [];
      const geraScore =
        PASSOU_TRIAGEM.has(status) || status === StatusCandidatura.REPROVADO;
      if (geraScore) {
        const base = randInt(45, 92);
        const criado = addDias(inscrito, randInt(1, 4));
        scores.push({
          tipo: TipoScore.RANKING_CV,
          valor: base + randInt(-5, 5),
          justificativa: 'Aderência do currículo aos requisitos da vaga (dado fictício).',
          modelo: 'seed-fake',
          criado_em: criado,
        });
        scores.push({
          tipo: TipoScore.CONSOLIDADO,
          valor: base,
          justificativa: 'Score consolidado fictício para visualização do painel.',
          modelo: 'seed-fake',
          criado_em: criado,
        });
      }

      const entrevistas: Array<{
        candidato_id: string;
        entrevistador_id: string;
        agendada_para: Date;
        duracao_estimada_min: number;
        status: StatusEntrevista;
        iniciada_em: Date | null;
        finalizada_em: Date | null;
      }> = [];
      const temEntrevista =
        TEVE_ENTREVISTA.has(status) ||
        (status === StatusCandidatura.REPROVADO && chance(0.45));
      if (temEntrevista) {
        const entrevistador = pick(entrevistadores);
        const duracao = pick([30, 45, 60]);
        let agendada: Date;
        let st: StatusEntrevista;
        let iniciada: Date | null = null;
        let finalizada: Date | null = null;

        if (
          ENTREVISTA_CONCLUIDA.has(status) ||
          (status === StatusCandidatura.REPROVADO && chance(0.7))
        ) {
          // Entrevista realizada (passado).
          agendada = addDias(inscrito, randInt(7, 30));
          if (agendada > new Date()) agendada = diasAtras(randInt(2, 20));
          st = StatusEntrevista.FINALIZADA;
          iniciada = agendada;
          finalizada = addMin(agendada, duracao);
        } else {
          // Apenas agendada: futuro / no-show / cancelada.
          const r = Math.random();
          if (r < 0.45) {
            agendada = addDias(new Date(), randInt(2, 20)); // futuro
            st = StatusEntrevista.AGENDADA;
          } else if (r < 0.75) {
            agendada = diasAtras(randInt(2, 25)); // passado, faltou
            st = StatusEntrevista.NAO_COMPARECEU;
          } else {
            agendada = diasAtras(randInt(2, 25));
            st = StatusEntrevista.CANCELADA;
          }
        }

        entrevistas.push({
          candidato_id: candidato.id,
          entrevistador_id: entrevistador.id,
          agendada_para: agendada,
          duracao_estimada_min: duracao,
          status: st,
          iniciada_em: iniciada,
          finalizada_em: finalizada,
        });
      }

      await prisma.candidatura.create({
        data: {
          gupy_id: proxGupy(),
          vaga_id: vaga.id,
          candidato_id: candidato.id,
          status,
          etapa_gupy: status.replace(/_/g, ' '),
          inscrito_em: inscrito,
          movido_em: movido,
          scores: scores.length ? { create: scores } : undefined,
          entrevistas: entrevistas.length ? { create: entrevistas } : undefined,
        },
      });

      totalCand++;
      totalScores += scores.length;
      totalEntrevistas += entrevistas.length;
    }
  }

  console.log('[seed:fake] criado:');
  console.log(`  • ${recrutadores.length} recrutadores + ${gestores.length} gestores`);
  console.log(`  • ${vagas.length} vagas`);
  console.log(`  • ${totalCand} candidaturas`);
  console.log(`  • ${totalScores} scores`);
  console.log(`  • ${totalEntrevistas} entrevistas`);
  console.log('Abra /analise no front para ver o painel populado.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
