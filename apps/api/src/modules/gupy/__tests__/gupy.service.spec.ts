import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { GupyService } from '../gupy.service.js';
import { GupyClient } from '../gupy.client.js';

import {
  vagaFakeJson,
  candidaturaFakeJson,
  candidaturaSemCvFakeJson,
} from './fixtures/gupy.fixtures.js';

import {
  VagaGupySchema,
  CandidaturaGupySchema,
} from '@uniats/shared';

/**
 * Service é a camada de orquestração — testamos APENAS comportamento,
 * mockando GupyClient (rede), PrismaService (banco) e Queue (BullMQ).
 */

type MockQueue = { add: jest.Mock };
type MockPrisma = {
  vaga: { upsert: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  candidato: { upsert: jest.Mock };
  candidatura: { upsert: jest.Mock };
};

function montarMocks() {
  const filaCV: MockQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const filaSync: MockQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const client = {
    obterVaga: jest.fn(),
    obterCandidatura: jest.fn(),
    iterarVagas: jest.fn(),
    iterarCandidaturas: jest.fn(),
  } as unknown as jest.Mocked<GupyClient>;
  const prisma: MockPrisma = {
    vaga: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    candidato: { upsert: jest.fn() },
    candidatura: { upsert: jest.fn() },
  };
  const auth = {
    vincularGestorAoSincronizar: jest.fn().mockResolvedValue(undefined),
  };
  const admissao = {
    criarDeCandidaturaSeElegivel: jest.fn().mockResolvedValue(false),
  };
  const service = new GupyService(
    client as any,
    prisma as any,
    auth as any,
    admissao as any,
    filaCV as any,
    filaSync as any,
  );
  return { service, client, prisma, auth, admissao, filaCV, filaSync };
}

async function* gen<T>(items: T[]): AsyncGenerator<T, void, void> {
  for (const it of items) yield it;
}

describe('GupyService.sincronizarVaga', () => {
  it('busca na Gupy, faz upsert e retorna o id local', async () => {
    const { service, client, prisma } = montarMocks();
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    (client.obterVaga as any).mockResolvedValue(vaga);
    prisma.vaga.upsert.mockResolvedValue({ id: 'vaga-uuid-1' });

    const resultado = await service.sincronizarVaga(BigInt(987654));

    expect(client.obterVaga).toHaveBeenCalledWith(BigInt(987654));
    expect(prisma.vaga.upsert).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ id: 'vaga-uuid-1' });
  });
});

describe('GupyService.sincronizarTodasAsVagas', () => {
  it('itera o cliente paginado e conta upserts', async () => {
    const { service, client, prisma } = montarMocks();
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    (client.iterarVagas as any).mockReturnValue(gen([vaga, vaga, vaga]));
    prisma.vaga.upsert.mockResolvedValue({ id: 'x' });

    const r = await service.sincronizarTodasAsVagas();
    expect(r.total).toBe(3);
    expect(prisma.vaga.upsert).toHaveBeenCalledTimes(3);
  });

  it('varre SEM filtro de status (rascunhos/aprovadas também entram)', async () => {
    const { service, client, prisma } = montarMocks();
    (client.iterarVagas as any).mockReturnValue(gen([]));
    prisma.vaga.upsert.mockResolvedValue({ id: 'x' });

    await service.sincronizarTodasAsVagas();
    expect(client.iterarVagas).toHaveBeenCalledWith();
  });
});

describe('GupyService.iniciarSyncVagas', () => {
  it('retorna na hora e conclui em background com a contagem', async () => {
    const { service, client, prisma } = montarMocks();
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    (client.iterarVagas as any).mockReturnValue(gen([vaga, vaga]));
    prisma.vaga.upsert.mockResolvedValue({ id: 'x' });

    const r = service.iniciarSyncVagas();
    expect(r.iniciado).toBe(true);
    expect(r.emAndamento).toBe(true);

    // Cede o event loop até o varredor em background terminar.
    await new Promise((res) => setImmediate(res));
    const st = service.statusSyncVagas();
    expect(st.emAndamento).toBe(false);
    expect(st.importadas).toBe(2);
    expect(st.erro).toBeNull();
  });

  it('NÃO dispara de novo enquanto um sync está em andamento', async () => {
    const { service, client, prisma } = montarMocks();
    const vaga = VagaGupySchema.parse(vagaFakeJson);
    (client.iterarVagas as any).mockReturnValue(gen([vaga]));
    prisma.vaga.upsert.mockResolvedValue({ id: 'x' });

    const primeiro = service.iniciarSyncVagas();
    const segundo = service.iniciarSyncVagas();
    expect(primeiro.iniciado).toBe(true);
    expect(segundo.iniciado).toBe(false);

    await new Promise((res) => setImmediate(res));
    expect(client.iterarVagas).toHaveBeenCalledTimes(1);
  });

  it('falha do client vira `erro` no status (não derruba nada)', async () => {
    const { service, client } = montarMocks();
    (client.iterarVagas as any).mockReturnValue(
      (async function* (): AsyncGenerator<never, void, void> {
        throw new Error('Gupy 500');
      })(),
    );

    service.iniciarSyncVagas();
    await new Promise((res) => setImmediate(res));

    const st = service.statusSyncVagas();
    expect(st.emAndamento).toBe(false);
    expect(st.erro).toBe('Gupy 500');
  });
});

describe('GupyService.iniciarSyncCandidaturasTodas', () => {
  it('varre só vagas vivas (exclui ENCERRADA/CANCELADA)', async () => {
    const { service, prisma } = montarMocks();
    prisma.vaga.findMany.mockResolvedValue([]);

    service.iniciarSyncCandidaturasTodas();
    // O varredor roda em background — cede o event loop até ele consultar o banco.
    await new Promise((r) => setImmediate(r));

    expect(prisma.vaga.findMany).toHaveBeenCalledWith({
      where: {
        excluido_em: null,
        status: { notIn: ['ENCERRADA', 'CANCELADA'] },
      },
      select: { gupy_id: true },
    });
  });
});

describe('GupyService.sincronizarCandidaturasDaVaga', () => {
  it('falha com NotFoundException se a vaga ainda não foi importada', async () => {
    const { service, prisma } = montarMocks();
    prisma.vaga.findUnique.mockResolvedValue(null);

    await expect(
      service.sincronizarCandidaturasDaVaga(BigInt(987654)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts candidato + candidatura e enfileira CV para baixar', async () => {
    const { service, client, prisma, filaCV } = montarMocks();
    const cand = CandidaturaGupySchema.parse(candidaturaFakeJson);
    prisma.vaga.findUnique.mockResolvedValue({ id: 'vaga-1' });
    (client.iterarCandidaturas as any).mockReturnValue(gen([cand]));
    prisma.candidato.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.candidatura.upsert.mockResolvedValue({ id: 'app-1' });

    const r = await service.sincronizarCandidaturasDaVaga(BigInt(987654));

    expect(r.total).toBe(1);
    expect(prisma.candidato.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.candidatura.upsert).toHaveBeenCalledTimes(1);
    expect(filaCV.add).toHaveBeenCalledWith(
      'baixar-cv',
      expect.objectContaining({
        candidaturaId: 'app-1',
        candidatoId: 'cand-1',
        url: candidaturaFakeJson.resumeUrl,
      }),
      expect.objectContaining({ jobId: 'cv-app-1' }),
    );
  });

  it('NÃO enfileira CV quando resumeUrl é nulo', async () => {
    const { service, client, prisma, filaCV } = montarMocks();
    const cand = CandidaturaGupySchema.parse(candidaturaSemCvFakeJson);
    prisma.vaga.findUnique.mockResolvedValue({ id: 'vaga-1' });
    (client.iterarCandidaturas as any).mockReturnValue(gen([cand]));
    prisma.candidato.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.candidatura.upsert.mockResolvedValue({ id: 'app-1' });

    await service.sincronizarCandidaturasDaVaga(BigInt(987654));
    expect(filaCV.add).not.toHaveBeenCalled();
  });
});

describe('GupyService.sincronizarCandidatura', () => {
  it('agenda backfill da vaga se ela não existir e lança NotFoundException', async () => {
    const { service, client, prisma, filaSync } = montarMocks();
    const cand = CandidaturaGupySchema.parse(candidaturaFakeJson);
    (client.obterCandidatura as any).mockResolvedValue(cand);
    prisma.vaga.findUnique.mockResolvedValue(null);

    await expect(
      service.sincronizarCandidatura(BigInt(5544332211)),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(filaSync.add).toHaveBeenCalledWith(
      'sincronizar-vaga',
      { gupyId: cand.jobId },
    );
  });

  it('upserts candidato + candidatura e retorna o id quando a vaga existe', async () => {
    const { service, client, prisma, filaCV } = montarMocks();
    const cand = CandidaturaGupySchema.parse(candidaturaFakeJson);
    (client.obterCandidatura as any).mockResolvedValue(cand);
    prisma.vaga.findUnique.mockResolvedValue({ id: 'vaga-1' });
    prisma.candidato.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.candidatura.upsert.mockResolvedValue({ id: 'app-1' });

    const r = await service.sincronizarCandidatura(BigInt(5544332211));
    expect(r).toEqual({ id: 'app-1' });
    expect(filaCV.add).toHaveBeenCalled();
  });

  it('cria admissão automaticamente quando a candidatura está CONTRATADO', async () => {
    const { service, client, prisma, admissao } = montarMocks();
    const cand = CandidaturaGupySchema.parse(candidaturaFakeJson);
    (client.obterCandidatura as any).mockResolvedValue(cand);
    prisma.vaga.findUnique.mockResolvedValue({ id: 'vaga-1' });
    prisma.candidato.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.candidatura.upsert.mockResolvedValue({
      id: 'app-1',
      status: 'CONTRATADO',
    });

    await service.sincronizarCandidatura(BigInt(5544332211));
    expect(admissao.criarDeCandidaturaSeElegivel).toHaveBeenCalledWith('app-1');
  });

  it('NÃO cria admissão quando a candidatura não está CONTRATADO', async () => {
    const { service, client, prisma, admissao } = montarMocks();
    const cand = CandidaturaGupySchema.parse(candidaturaFakeJson);
    (client.obterCandidatura as any).mockResolvedValue(cand);
    prisma.vaga.findUnique.mockResolvedValue({ id: 'vaga-1' });
    prisma.candidato.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.candidatura.upsert.mockResolvedValue({
      id: 'app-1',
      status: 'EM_ANALISE',
    });

    await service.sincronizarCandidatura(BigInt(5544332211));
    expect(admissao.criarDeCandidaturaSeElegivel).not.toHaveBeenCalled();
  });
});
