import { describe, expect, it } from '@jest/globals';
import { Prisma } from '@collab/db';

import {
  VagaGupySchema,
  CandidatoGupySchema,
  CandidaturaGupySchema,
} from '@collab/shared';

import {
  mapearStatusVaga,
  mapearStatusCandidatura,
  extrairRequisitos,
  paraUpsertVaga,
  paraUpsertCandidato,
  paraUpsertCandidatura,
  paraUpsertCurriculoGupy,
  traduzirTipoContrato,
} from '../mappers/gupy.mapper.js';

import {
  vagaFakeJson,
  candidatoFakeJson,
  candidaturaFakeJson,
  candidatoComFormacaoFakeJson,
  candidatoSoSchoolingFakeJson,
} from './fixtures/gupy.fixtures.js';

describe('mapearStatusVaga', () => {
  it.each([
    ['draft', 'RASCUNHO'],
    ['waiting_approval', 'EM_APROVACAO'],
    ['approved', 'APROVADA'],
    ['published', 'PUBLICADA'],
    ['PUBLISHED', 'PUBLICADA'],
    ['paused', 'PAUSADA'],
    ['frozen', 'PAUSADA'],
    ['closed', 'ENCERRADA'],
    ['canceled', 'CANCELADA'],
  ])('"%s" → %s', (input, esperado) => {
    expect(mapearStatusVaga(input)).toBe(esperado);
  });

  it('sem status (payload antigo/webhook) → PUBLICADA', () => {
    expect(mapearStatusVaga(undefined)).toBe('PUBLICADA');
    expect(mapearStatusVaga(null)).toBe('PUBLICADA');
  });

  it('status desconhecido → RASCUNHO (não polui a visão de publicadas)', () => {
    expect(mapearStatusVaga('xyz')).toBe('RASCUNHO');
  });
});

describe('traduzirTipoContrato', () => {
  it.each([
    ['vacancy_type_effective', 'Efetivo'],
    ['vacancy_type_internship', 'Estágio'],
    ['vacancy_type_apprentice', 'Aprendiz'],
    ['vacancy_legal_entity', 'Pessoa Jurídica (PJ)'],
    ['effective', 'Efetivo'],
    ['young_apprentice', 'Jovem Aprendiz'],
  ])('"%s" → %s', (input, esperado) => {
    expect(traduzirTipoContrato(input)).toBe(esperado);
  });

  it('valor desconhecido volta cru; vazio vira null', () => {
    expect(traduzirTipoContrato('CLT')).toBe('CLT');
    expect(traduzirTipoContrato(null)).toBeNull();
    expect(traduzirTipoContrato(undefined)).toBeNull();
  });
});

describe('mapearStatusCandidatura', () => {
  it.each([
    ['in_analysis', 'EM_ANALISE'],
    ['approved', 'APROVADO'],
    ['rejected', 'REPROVADO'],
    ['hired', 'CONTRATADO'],
    ['withdrew', 'DESISTENTE'],
    // valores reais da API da Gupy
    ['in_process', 'EM_ANALISE'],
    ['give_up', 'DESISTENTE'],
    ['reproved', 'REPROVADO'],
  ])('"%s" → %s', (input, esperado) => {
    expect(mapearStatusCandidatura(input)).toBe(esperado);
  });

  it('default para EM_ANALISE quando indefinido', () => {
    expect(mapearStatusCandidatura(undefined)).toBe('EM_ANALISE');
    expect(mapearStatusCandidatura('foo')).toBe('EM_ANALISE');
  });
});

describe('extrairRequisitos', () => {
  it('mapeia customFields em json + texto concatenado', () => {
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    const { json, texto } = extrairRequisitos(vaga);

    // customFields ficam namespaced sob `customFields` no JSON estruturado.
    expect(json.customFields).toMatchObject({
      'Conhecimentos obrigatórios': 'Node.js, TypeScript, PostgreSQL',
      'Anos de experiência': '3+',
      Idioma: 'Inglês intermediário',
    });
    expect(texto).toContain('Conhecimentos obrigatórios: Node.js');
    expect(texto).toContain('Anos de experiência: 3+');
  });

  it('ignora customFields sem título', () => {
    const vaga = VagaGupySchema.parse({
      ...vagaFakeJson,
      customFields: [
        { id: 'x', title: '', value: 'sem titulo' },
        { id: 'y', title: 'Válido', value: 'ok' },
      ],
    });
    const { json, texto } = extrairRequisitos(vaga);
    expect(json.customFields).toEqual({ Válido: 'ok' });
    expect(texto).toBe('Válido: ok');
  });

  it('ignora customFields com valor vazio/null no texto (mas mantém no json)', () => {
    const vaga = VagaGupySchema.parse({
      ...vagaFakeJson,
      customFields: [
        { id: 'a', title: 'Vazio', value: '' },
        { id: 'b', title: 'Nulo', value: null },
        { id: 'c', title: 'Preenchido', value: 'X' },
      ],
    });
    const { json, texto } = extrairRequisitos(vaga);
    expect(json.customFields).toEqual({ Vazio: '', Nulo: null, Preenchido: 'X' });
    expect(texto).toBe('Preenchido: X');
  });

  it('lida com customFields ausente', () => {
    const vaga = VagaGupySchema.parse({
      ...vagaFakeJson,
      customFields: undefined,
    });
    expect(extrairRequisitos(vaga)).toEqual({ json: {}, texto: '' });
  });
});

describe('paraUpsertVaga', () => {
  it('produz argumentos de upsert coerentes', () => {
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    const upsert = paraUpsertVaga(vaga);

    expect(upsert.where).toEqual({ gupy_id: vaga.id });
    expect(upsert.create).toMatchObject({
      gupy_id: vaga.id,
      codigo: 'VAGA-001',
      titulo: 'Engenheiro(a) de Software Pleno',
      departamento: 'Tecnologia da Informação',
      unidade: 'Timbó - Matriz',
      cidade: 'Timbó',
      estado: 'SC',
      tipo_contrato: 'CLT',
      remoto: true,
      status: 'PUBLICADA',
    });
    expect(upsert.create.data_publicacao).toBeInstanceOf(Date);
    expect(upsert.create.requisitos_texto).toContain('Node.js');
    // O schema virou ALLOWLIST: campo não declarado é descartado no parse e
    // NÃO chega ao gupy_payload (antes era .passthrough() e ia tudo).
    expect(upsert.create.gupy_payload).not.toHaveProperty('campoDesconhecido');
  });

  it('atualiza gupy_sincronizado_em em update', () => {
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    const upsert = paraUpsertVaga(vaga);
    expect((upsert.update as any).gupy_sincronizado_em).toBeInstanceOf(Date);
  });
});

describe('paraUpsertCandidato', () => {
  it('mapeia identidade do candidato', () => {
    const cand = CandidatoGupySchema.parse(candidatoFakeJson);
    const upsert = paraUpsertCandidato(cand);
    expect(upsert.where).toEqual({ gupy_id: cand.id });
    expect(upsert.create).toMatchObject({
      gupy_id: cand.id,
      nome_completo: 'Maria Aparecida Silva',
      email: 'maria.silva@example.com',
      telefone: '+5547999990000',
      linkedin_url: 'https://linkedin.com/in/mariaaparecida',
      cidade: 'Blumenau',
      estado: 'SC',
    });
  });

  it('aceita campos opcionais ausentes', () => {
    const cand = CandidatoGupySchema.parse({
      id: 42,
      name: 'Anônimo',
    });
    const upsert = paraUpsertCandidato(cand);
    expect(upsert.create).toMatchObject({
      gupy_id: cand.id,
      nome_completo: 'Anônimo',
      email: null,
      telefone: null,
      linkedin_url: null,
    });
  });
});

describe('paraUpsertCurriculoGupy — formação vinda de academicQualification', () => {
  function montar(candidate: unknown) {
    const cand = CandidaturaGupySchema.parse({
      ...candidaturaFakeJson,
      candidate,
    });
    return paraUpsertCurriculoGupy(cand, 'candidatura-uuid', 'cand-uuid');
  }

  it('usa curso + instituição + tipo + status (antes só tinha o nível agregado)', () => {
    const upsert = montar(candidatoComFormacaoFakeJson);
    const formacoes = upsert!.create.formacoes as any[];

    expect(formacoes).toHaveLength(2);
    expect(formacoes[0]).toMatchObject({
      curso: 'Análise e Desenvolvimento de Sistemas',
      instituicao: 'SENAI Blumenau',
      nivel: 'tecnologo',
      status: 'concluída',
      inicio: '2018-02',
      fim: '2020-12',
    });
    expect(formacoes[1]).toMatchObject({
      curso: 'Engenharia de Software',
      nivel: 'pos-graduacao',
      status: 'em andamento',
      fim: null, // ainda cursando
    });
  });

  it('o texto consolidado traz curso e instituição, nunca "undefined"', () => {
    const upsert = montar(candidatoComFormacaoFakeJson);
    const texto = upsert!.create.texto_normalizado as string;

    expect(texto).toContain('Análise e Desenvolvimento de Sistemas');
    expect(texto).toContain('SENAI Blumenau');
    expect(texto).toContain('em andamento');
    expect(texto).not.toContain('undefined');
  });

  it('sem academicQualification, cai no schooling agregado — e ainda sem "undefined"', () => {
    const upsert = montar(candidatoSoSchoolingFakeJson);
    const formacoes = upsert!.create.formacoes as any[];

    expect(formacoes).toHaveLength(1);
    expect(formacoes[0]).toMatchObject({
      curso: null,
      instituicao: null,
      nivel: 'outro', // high_school não tem equivalente no enum
      status: 'concluída',
    });
    expect(upsert!.create.texto_normalizado as string).not.toContain('undefined');
  });

  it('marca parser_versao v2 (rastro de quem já foi reconstruído)', () => {
    const upsert = montar(candidatoComFormacaoFakeJson);
    expect(upsert!.create.parser_versao).toBe('gupy-structured-v2');
  });

  it('descarta item de formação sem curso E sem instituição', () => {
    const upsert = montar({
      ...candidatoComFormacaoFakeJson,
      academicQualification: [
        { id: 'x', course: null, institution: null, formation: 'graduation' },
      ],
    });
    // Cai no fallback do schooling, em vez de gravar formação vazia.
    const formacoes = upsert!.create.formacoes as any[];
    expect(formacoes).toHaveLength(1);
    expect(formacoes[0].curso).toBeNull();
  });
});

/**
 * Minimização LGPD: com ?fields=all a Gupy devolve o cadastro completo. O que
 * não é essencial para a triagem tem de morrer no parse — antes de tocar banco,
 * fila, log ou prompt de IA.
 */
describe('minimização LGPD do payload da Gupy', () => {
  // Como a Gupy realmente devolve um candidato com fields=all.
  const candidatoComDadoSensivel = {
    id: 11223344,
    name: 'Maria Aparecida',
    lastName: 'Silva',
    email: 'maria.silva@example.com',
    phone: '+5547999990000',
    city: 'Blumenau',
    state: 'SC',
    // --- daqui para baixo: nada disso pode sobreviver ---
    cpf: '123.456.789-00',
    birthdate: '1990-04-17',
    gender: 'Feminino',
    genderIdentity: 'Mulher cisgênero',
    sexualOrientation: 'Heterossexual',
    ethnicity: 'Parda',
    disabilities: [{ type: 'Auditiva', cid: 'H90.3' }],
    isPcd: true,
    addressStreet: 'Rua das Flores',
    addressNumber: '123',
    addressZipCode: '89000-000',
    maritalStatus: 'Casada',
    profilePictureUrl: 'https://gupy.example.com/foto/maria.jpg',
  };

  const PROIBIDOS = [
    'cpf',
    'birthdate',
    'gender',
    'genderIdentity',
    'sexualOrientation',
    'ethnicity',
    'disabilities',
    'isPcd',
    'addressStreet',
    'addressNumber',
    'addressZipCode',
    'maritalStatus',
    'profilePictureUrl',
  ];

  it('o schema descarta dado sensível e identificador desnecessário', () => {
    const c = CandidatoGupySchema.parse(candidatoComDadoSensivel);
    for (const campo of PROIBIDOS) {
      expect(c).not.toHaveProperty(campo);
    }
    // ...sem perder o que a triagem precisa:
    expect(c.name).toBe('Maria Aparecida');
    expect(c.email).toBe('maria.silva@example.com');
    expect(c.phone).toBe('+5547999990000');
    expect(c.city).toBe('Blumenau');
  });

  it('nem o dado sensível nem o payload bruto chegam ao banco (candidato)', () => {
    const c = CandidatoGupySchema.parse(candidatoComDadoSensivel);
    const upsert = paraUpsertCandidato(c);
    // Payload bruto deixou de ser persistido; DbNull também limpa linha legada.
    expect(upsert.create.gupy_payload).toBe(Prisma.DbNull);
    expect((upsert.update as any).gupy_payload).toBe(Prisma.DbNull);
    // Varredura: nenhum campo proibido aparece em NENHUM lugar do que grava.
    const serializado = JSON.stringify(upsert, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (const campo of PROIBIDOS) {
      expect(serializado).not.toContain(campo);
    }
    expect(serializado).not.toContain('123.456.789-00');
    expect(serializado).not.toContain('H90.3');
  });

  it('candidatura não persiste o payload (que aninha o candidato inteiro)', () => {
    const cand = CandidaturaGupySchema.parse({
      ...candidaturaFakeJson,
      candidate: candidatoComDadoSensivel,
    });
    const upsert = paraUpsertCandidatura(cand, 'vaga-uuid', 'cand-uuid');
    expect(upsert.create.gupy_payload).toBe(Prisma.DbNull);
    const serializado = JSON.stringify(upsert, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (const campo of PROIBIDOS) {
      expect(serializado).not.toContain(campo);
    }
  });

  it('respostas do formulário da vaga não são coletadas', () => {
    // Onde perguntas de diversidade/saúde costumam chegar.
    const cand = CandidaturaGupySchema.parse({
      ...candidaturaFakeJson,
      applicationAnswers: [
        { question: 'Você é PCD?', answer: 'Sim, deficiência auditiva' },
      ],
      customFields: [{ title: 'Autodeclaração de raça/cor', value: 'Parda' }],
    });
    expect(cand).not.toHaveProperty('applicationAnswers');
    expect(cand).not.toHaveProperty('customFields');
  });

  it('o currículo estruturado usa só experiência/formação/idioma', () => {
    const cand = CandidaturaGupySchema.parse({
      ...candidaturaFakeJson,
      candidate: {
        ...candidatoComDadoSensivel,
        workExperience: [
          {
            role: 'Analista',
            companyName: 'Unifique',
            activitiesPerformed: 'Suporte',
            startYear: 2020,
            // Campo extra no item: também precisa ser descartado.
            salaryAtCompany: 4500,
          },
        ],
        languages: [{ language: 'Inglês', level: 'Avançado' }],
      },
    });
    const upsert = paraUpsertCurriculoGupy(cand, 'candidatura-uuid', 'cand-uuid');
    expect(upsert).not.toBeNull();
    const serializado = JSON.stringify(upsert);
    expect(serializado).toContain('Analista');
    expect(serializado).not.toContain('salaryAtCompany');
    for (const campo of PROIBIDOS) {
      expect(serializado).not.toContain(campo);
    }
  });
});

describe('paraUpsertCandidatura', () => {
  it('mapeia candidatura ligada a vaga + candidato', () => {
    const cand = CandidaturaGupySchema.parse(candidaturaFakeJson);
    const upsert = paraUpsertCandidatura(cand, 'vaga-uuid', 'cand-uuid');

    expect(upsert.where).toEqual({ gupy_id: cand.id });
    expect(upsert.create).toMatchObject({
      gupy_id: cand.id,
      vaga_id: 'vaga-uuid',
      candidato_id: 'cand-uuid',
      etapa_gupy: 'Triagem',
      status: 'EM_ANALISE',
    });
    expect(upsert.create.inscrito_em).toBeInstanceOf(Date);
    expect(upsert.create.movido_em).toBeInstanceOf(Date);
  });
});
