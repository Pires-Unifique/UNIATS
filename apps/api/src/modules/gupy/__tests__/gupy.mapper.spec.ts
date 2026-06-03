import { describe, expect, it } from '@jest/globals';

import {
  VagaGupySchema,
  CandidatoGupySchema,
  CandidaturaGupySchema,
} from '@triagem/shared';

import {
  mapearStatusVaga,
  mapearStatusCandidatura,
  extrairRequisitos,
  paraUpsertVaga,
  paraUpsertCandidato,
  paraUpsertCandidatura,
} from '../mappers/gupy.mapper.js';

import {
  vagaFakeJson,
  candidatoFakeJson,
  candidaturaFakeJson,
} from './fixtures/gupy.fixtures.js';

describe('mapearStatusVaga', () => {
  it.each([
    ['draft', 'RASCUNHO'],
    ['published', 'PUBLICADA'],
    ['PUBLISHED', 'PUBLICADA'],
    ['paused', 'PAUSADA'],
    ['closed', 'ENCERRADA'],
    ['canceled', 'CANCELADA'],
  ])('"%s" → %s', (input, esperado) => {
    expect(mapearStatusVaga(input)).toBe(esperado);
  });

  it('default para PUBLICADA quando indefinido ou desconhecido', () => {
    expect(mapearStatusVaga(undefined)).toBe('PUBLICADA');
    expect(mapearStatusVaga(null)).toBe('PUBLICADA');
    expect(mapearStatusVaga('xyz')).toBe('PUBLICADA');
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
    // Forward-compat: campos desconhecidos viram parte de gupy_payload
    expect(upsert.create.gupy_payload).toMatchObject({
      campoDesconhecido: 'futureproof',
    });
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
