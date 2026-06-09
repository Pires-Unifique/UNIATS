import { PublicarVagaInput } from '@uniats/shared';

import { VagaTemplateService } from '../vaga-template.service.js';

function baseInput(over: Partial<PublicarVagaInput> = {}): PublicarVagaInput {
  return {
    titulo: 'Analista de Soluções de IA Júnior',
    departamentoNome: 'Centro de Excelência em IA',
    missao: 'Apoiar a construção de soluções com IA.',
    formacaoMinima: 'Ensino Superior cursando.',
    formacaoIdeal: 'Cursos complementares em IA.',
    conhecimentos: [{ texto: 'Noções de IA generativa', grau: 'B', nivel: 'JR' }],
    responsabilidades: ['Entender problemas', 'Construir protótipos'],
    autonomiaNivel: 'JR',
    autonomiaParagrafos: ['Autonomia supervisionada.'],
    mensuravel: null,
    departmentId: 10,
    roleId: 20,
    branchId: 30,
    type: 'effective',
    numVacancies: 1,
    hiringDeadline: '2026-12-31',
    workplaceType: 'hybrid',
    publicationType: 'external',
    code: null,
    recruiterEmail: null,
    managerEmail: null,
    publicarAgora: false,
    arquivoSha256: null,
    ...over,
  };
}

function montarService() {
  const gupy = {
    criarVaga: jest.fn().mockResolvedValue({ id: 123n, code: 'JOB-123' }),
    publicarVaga: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    vaga: {
      create: jest.fn().mockResolvedValue({ id: 'uuid-1', gupy_id: 123n }),
    },
  };
  const storage = { buildKey: jest.fn(), putObject: jest.fn() };
  const service = new VagaTemplateService(
    prisma as never,
    storage as never,
    gupy as never,
  );
  return { service, gupy, prisma };
}

describe('VagaTemplateService.publicar', () => {
  it('cria rascunho e NÃO publica quando publicarAgora=false', async () => {
    const { service, gupy, prisma } = montarService();

    const res = await service.publicar(baseInput({ publicarAgora: false }));

    expect(gupy.criarVaga).toHaveBeenCalledTimes(1);
    expect(gupy.publicarVaga).not.toHaveBeenCalled();
    expect(res.status).toBe('RASCUNHO');
    expect(res.gupyId).toBe('123');

    // Vaga persistida em rascunho, sem data de publicação.
    const data = prisma.vaga.create.mock.calls[0][0].data;
    expect(data.status).toBe('RASCUNHO');
    expect(data.data_publicacao).toBeNull();
    expect(data.gupy_id).toBe(123n);
  });

  it('publica quando publicarAgora=true', async () => {
    const { service, gupy, prisma } = montarService();

    const res = await service.publicar(baseInput({ publicarAgora: true }));

    expect(gupy.publicarVaga).toHaveBeenCalledWith(123n);
    expect(res.status).toBe('PUBLICADA');
    const data = prisma.vaga.create.mock.calls[0][0].data;
    expect(data.status).toBe('PUBLICADA');
    expect(data.data_publicacao).toBeInstanceOf(Date);
  });

  it('mapeia o template para o payload da Gupy', async () => {
    const { service, gupy } = montarService();

    await service.publicar(baseInput());

    const payload = gupy.criarVaga.mock.calls[0][0];
    expect(payload.name).toBe('Analista de Soluções de IA Júnior');
    expect(payload.departmentId).toBe(10);
    expect(payload.roleId).toBe(20);
    expect(payload.branchId).toBe(30);
    expect(payload.type).toBe('effective');
    expect(payload.hiringDeadline).toBe('2026-12-31');
    expect(payload.description).toContain('soluções com IA');
    expect(payload.responsibilities).toContain('Construir protótipos');
    expect(payload.prerequisites).toContain('FORMAÇÃO MÍNIMA');
    expect(payload.prerequisites).toContain('IA generativa');
    expect(payload.additionalInformation).toContain('FORMAÇÃO IDEAL');
  });

  it('omite campos opcionais ausentes no payload', async () => {
    const { service, gupy } = montarService();

    await service.publicar(
      baseInput({ branchId: null, workplaceType: null, recruiterEmail: null }),
    );

    const payload = gupy.criarVaga.mock.calls[0][0];
    expect(payload).not.toHaveProperty('branchId');
    expect(payload).not.toHaveProperty('workplaceType');
    expect(payload).not.toHaveProperty('recruiterEmail');
  });
});
