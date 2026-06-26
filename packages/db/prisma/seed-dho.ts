/**
 * Seed do módulo ALTERAÇÃO CONTRATUAL (DHO) — dados de TESTE.
 *
 * Popula cargos (catálogo), filiais/unidades, centros de custo e colaboradores.
 * Idempotente (upsert por chave natural). NÃO use em produção.
 *
 * FONTE: export do Senior em `prisma/data/colaboradores.csv`. O parser entende
 * os cabeçalhos do próprio export (Numcad, Title, Email, JobTitle, JobLevel,
 * CostCenter, Departament, Manager, City, Status) e DERIVA dele:
 *   - unidades/filiais (City, ex.: "SC/TIMBO" → TIMBO/SC);
 *   - centros de custo (Departament + CostCenter);
 *   - cargos (JobTitle = título; JobLevel SR/PL/JR = senioridade);
 *   - colaboradores (SEM salário — regra de negócio);
 *   - hierarquia de líder casando o e-mail de `Manager` com o Email dos colegas.
 * Sem o CSV, cai num conjunto pequeno de dados fictícios.
 *
 * Rode:  pnpm --filter @uniats/db run seed:dho
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CSV_PATH = resolve(process.cwd(), 'prisma/data/colaboradores.csv');

// ---------------- util ----------------
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** SR/PL/JR (ou Sênior/Pleno/Júnior) → rótulo padronizado. */
function mapLevel(lvl?: string): string | undefined {
  if (!lvl) return undefined;
  const t = norm(lvl);
  if (!t) return undefined;
  if (t.startsWith('s')) return 'Sênior';
  if (t.startsWith('p')) return 'Pleno';
  if (t.startsWith('j')) return 'Júnior';
  return undefined;
}

/** Remove o sufixo de nível embutido no título (… PL/JR/SR) e devolve a senioridade. */
function splitSenioridade(jobTitle: string): { titulo: string; senioridade?: string } {
  const t = jobTitle.trim();
  const m = t.match(/\s(s[êe]nior|sr|pleno|pl|j[úu]nior|jr)\.?$/i);
  if (!m) return { titulo: t };
  return { titulo: t.slice(0, m.index).trim() || t, senioridade: mapLevel(m[1]) };
}

function cargoDisplay(jobTitle: string, jobLevel?: string): string {
  if (!jobLevel) return jobTitle;
  return norm(jobTitle).endsWith(norm(jobLevel)) ? jobTitle : `${jobTitle} ${jobLevel}`;
}

/** "SC/TIMBO" / "SC/RIO DOS CEDROS" → { estado, cidade }. */
function parseCity(city: string): { estado: string | null; cidade: string } {
  const partes = city.split('/');
  if (partes.length >= 2) {
    return { estado: partes[0].trim().toUpperCase() || null, cidade: partes.slice(1).join('/').trim() };
  }
  return { estado: null, cidade: city.trim() };
}

const ativoDeStatus = (status?: string) =>
  !status || norm(status).startsWith('trabalh') || norm(status) === 'active' || norm(status) === 'ativo';

// ---------------- CSV ----------------
function parseCsv(texto: string): Array<Record<string, string>> {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (linhas.length < 2) return [];
  const splitLinha = (l: string): string[] => {
    const campos: string[] = [];
    let atual = '';
    let aspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (aspas && l[i + 1] === '"') {
          atual += '"';
          i++;
        } else aspas = !aspas;
      } else if ((c === ',' || c === ';' || c === '\t') && !aspas) {
        campos.push(atual);
        atual = '';
      } else atual += c;
    }
    campos.push(atual);
    return campos.map((s) => s.trim());
  };
  const headers = splitLinha(linhas[0]).map((h) => norm(h));
  return linhas.slice(1).map((l) => {
    const valores = splitLinha(l);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = valores[i] ?? ''));
    return rec;
  });
}

/** Valor da 1ª coluna que casa: exato primeiro, depois "contém". */
function col(rec: Record<string, string>, ...chaves: string[]): string | undefined {
  for (const k of chaves) if (rec[k]?.trim()) return rec[k].trim();
  for (const chave of chaves) {
    const k = Object.keys(rec).find((h) => h.includes(chave));
    if (k && rec[k]?.trim()) return rec[k].trim();
  }
  return undefined;
}

interface ColabIn {
  matricula: string;
  nome: string;
  email?: string;
  cargoTitulo?: string; // JobTitle sem o sufixo de nível
  senioridade?: string; // Sênior/Pleno/Júnior
  cargoAtual?: string; // texto cru p/ snapshot
  centroNome?: string;
  centroCod?: string;
  cidade?: string;
  estado?: string | null;
  managerEmail?: string; // e-mail do líder (resolvido depois)
  liderNome?: string; // pré-definido (fallback fake)
  liderMat?: string;
  ativo: boolean;
}

function lerCsv(): ColabIn[] {
  const registros = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  return registros
    .map((r): ColabIn => {
      const city = col(r, 'city', 'cidade', 'unidade', 'filial') ?? '';
      const { estado, cidade } = city ? parseCity(city) : { estado: null, cidade: '' };
      const jobTitle = col(r, 'jobtitle', 'cargo', 'funcao') ?? '';
      const jobLevel = col(r, 'joblevel');
      const { titulo, senioridade: senTitulo } = jobTitle ? splitSenioridade(jobTitle) : { titulo: '', senioridade: undefined };
      const managerEmail = col(r, 'manager', 'lider', 'gestor', 'chefe');
      return {
        matricula: col(r, 'numcad', 'matricula') ?? '',
        nome: col(r, 'title', 'nome') ?? '',
        email: col(r, 'email', 'socialname'),
        cargoTitulo: titulo || undefined,
        senioridade: mapLevel(jobLevel) ?? senTitulo,
        cargoAtual: jobTitle ? cargoDisplay(jobTitle, jobLevel) : undefined,
        centroNome: col(r, 'departament', 'departam', 'centro'),
        centroCod: col(r, 'costcenter', 'costcente'),
        cidade: cidade || undefined,
        estado,
        managerEmail: managerEmail ? norm(managerEmail) : undefined,
        ativo: ativoDeStatus(col(r, 'status')),
      };
    })
    .filter((c) => c.matricula && c.nome);
}

// ---------------- fallback (sem CSV) ----------------
const FAKE: ColabIn[] = [
  { matricula: '105', nome: 'Beatriz Diretora', cargoTitulo: 'GERENTE DE OPERACOES', cargoAtual: 'GERENTE DE OPERACOES', centroNome: 'DHO', cidade: 'TIMBO', estado: 'SC', ativo: true },
  { matricula: '229', nome: 'Rodrigo Almeida', cargoTitulo: 'COORDENADOR DE ATENDIMENTO', cargoAtual: 'COORDENADOR DE ATENDIMENTO', centroNome: 'ATENDIMENTO', cidade: 'BLUMENAU', estado: 'SC', liderNome: 'Beatriz Diretora', liderMat: '105', ativo: true },
  { matricula: '175', nome: 'Ana Souza', cargoTitulo: 'ANALISTA', senioridade: 'Sênior', cargoAtual: 'ANALISTA SR', centroNome: 'ATENDIMENTO', cidade: 'BLUMENAU', estado: 'SC', liderNome: 'Rodrigo Almeida', liderMat: '229', ativo: true },
  { matricula: '218', nome: 'Diego Lima', cargoTitulo: 'TECNICO DE CAMPO', cargoAtual: 'TECNICO DE CAMPO', centroNome: 'INFRAESTRUTURA', cidade: 'JOINVILLE', estado: 'SC', liderNome: 'Rodrigo Almeida', liderMat: '229', ativo: true },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed do DHO bloqueado em produção (dados fictícios).');
  }

  const temCsv = existsSync(CSV_PATH);
  const colaboradores = temCsv ? lerCsv() : FAKE;
  console.log(
    temCsv
      ? `[seed:dho] CSV encontrado: ${colaboradores.length} colaboradores.`
      : `[seed:dho] CSV ausente (${CSV_PATH}) — usando ${colaboradores.length} colaboradores fake.`,
  );

  // ----- deriva unidades/centros/cargos -----
  const unidadesMap = new Map<string, { externo_id: string; nome: string; estado: string | null }>();
  const centrosMap = new Map<string, { senior_id: string; codigo: string | null; nome: string }>();
  const cargosMap = new Map<string, { codigo: string; titulo: string; senioridade?: string }>();

  for (const c of colaboradores) {
    if (c.cidade) {
      const key = norm(c.cidade);
      if (!unidadesMap.has(key))
        unidadesMap.set(key, { externo_id: `${c.estado ?? 'BR'}-${slug(c.cidade)}`, nome: c.cidade, estado: c.estado ?? null });
    }
    if (c.centroNome) {
      const key = norm(c.centroNome);
      if (!centrosMap.has(key))
        centrosMap.set(key, { senior_id: c.centroCod || `cc-${slug(c.centroNome)}`, codigo: c.centroCod || null, nome: c.centroNome });
    }
    if (c.cargoTitulo) {
      const key = `${norm(c.cargoTitulo)}|${c.senioridade ?? ''}`;
      if (!cargosMap.has(key))
        cargosMap.set(key, { codigo: `cargo-${slug(`${c.cargoTitulo}-${c.senioridade ?? ''}`)}`, titulo: c.cargoTitulo, senioridade: c.senioridade });
    }
  }

  for (const u of unidadesMap.values()) {
    await prisma.unidade.upsert({
      where: { externo_id: u.externo_id },
      create: { externo_id: u.externo_id, nome: u.nome, estado: u.estado, sincronizado_em: new Date() },
      update: { nome: u.nome, estado: u.estado, ativo: true },
    });
  }
  for (const cc of centrosMap.values()) {
    await prisma.centroCusto.upsert({
      where: { senior_id: cc.senior_id },
      create: { senior_id: cc.senior_id, codigo: cc.codigo, nome: cc.nome, sincronizado_em: new Date() },
      update: { codigo: cc.codigo, nome: cc.nome, ativo: true },
    });
  }
  for (const cg of cargosMap.values()) {
    await prisma.cargo.upsert({
      where: { codigo: cg.codigo },
      create: { codigo: cg.codigo, titulo: cg.titulo, senioridade: cg.senioridade ?? null, origem: 'seed' },
      update: { titulo: cg.titulo, senioridade: cg.senioridade ?? null, excluido_em: null },
    });
  }

  // ----- mapas p/ casar referências e líder -----
  const unidades = await prisma.unidade.findMany({ select: { id: true, nome: true } });
  const centros = await prisma.centroCusto.findMany({ select: { id: true, nome: true } });
  const unidadePorNome = new Map(unidades.map((u) => [norm(u.nome), u.id]));
  const centroPorNome = new Map(centros.map((c) => [norm(c.nome), c.id]));
  // e-mail → colaborador (p/ resolver o líder a partir do Manager).
  const porEmail = new Map<string, { matricula: string; nome: string }>();
  for (const c of colaboradores) if (c.email) porEmail.set(norm(c.email), { matricula: c.matricula, nome: c.nome });

  let comLider = 0;
  for (const c of colaboradores) {
    let liderNome = c.liderNome ?? null;
    let liderMat = c.liderMat ?? null;
    if (c.managerEmail) {
      const chefe = porEmail.get(c.managerEmail);
      if (chefe) {
        liderNome = chefe.nome;
        liderMat = chefe.matricula;
      } else {
        liderNome = c.managerEmail; // fora da amostra: guarda o e-mail mesmo
      }
    }
    if (liderNome) comLider++;

    const data = {
      nome: c.nome,
      email: c.email ?? null,
      unidade_id: c.cidade ? (unidadePorNome.get(norm(c.cidade)) ?? null) : null,
      centro_custo_id: c.centroNome ? (centroPorNome.get(norm(c.centroNome)) ?? null) : null,
      cargo_atual: c.cargoAtual ?? c.cargoTitulo ?? null,
      lider_matricula: liderMat,
      lider_nome: liderNome,
      ativo: c.ativo,
      sincronizado_em: new Date(),
    };
    await prisma.colaborador.upsert({
      where: { matricula: c.matricula },
      create: { matricula: c.matricula, ...data },
      update: data,
    });
  }

  // ----- procuradores (offboarding) -----
  // Pessoas que podem assinar como representante da empresa na via física.
  // Sem chave natural única → idempotência por nome (findFirst + create).
  const PROCURADORES = [
    { nome: 'Beatriz Diretora', email: 'beatriz.diretora@unifique.com.br', cargo: 'Diretora de Operações' },
    { nome: 'Carlos Procurador', email: 'carlos.procurador@unifique.com.br', cargo: 'Gerente Administrativo' },
    { nome: 'Marina DHO', email: 'marina.dho@unifique.com.br', cargo: 'Coordenadora de DHO' },
  ];
  let procuradoresCriados = 0;
  for (const p of PROCURADORES) {
    const existente = await prisma.procurador.findFirst({ where: { nome: p.nome } });
    if (!existente) {
      await prisma.procurador.create({ data: p });
      procuradoresCriados++;
    }
  }

  console.log('[seed:dho] concluído:');
  console.log(`  • ${cargosMap.size} cargos`);
  console.log(`  • ${unidadesMap.size} unidades/filiais`);
  console.log(`  • ${centrosMap.size} centros de custo`);
  console.log(`  • ${colaboradores.length} colaboradores (${comLider} com líder)`);
  console.log(`  • ${procuradoresCriados} procurador(es) novo(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
