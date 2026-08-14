import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { MARCADOR_PURGADO } from '../retencao.constants.js';
import { RetencaoDadosService } from '../retencao-dados.service.js';

function montar(envs: Record<string, number | string> = {}) {
  const config = { RETENCAO_MODO: 'real', ...envs };
  const prisma: any = {
    curriculoProcessado: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    candidato: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    entrevista: { update: jest.fn().mockResolvedValue({}) },
    transcricao: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    mensagem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    embedding: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    registroAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const storage: any = { deleteObject: jest.fn().mockResolvedValue(undefined) };
  const configService: any = { get: jest.fn((k: string) => config[k]) };
  const service = new RetencaoDadosService(
    prisma as PrismaService,
    storage as StorageService,
    configService as ConfigService,
  );
  return { service, prisma, storage, config: configService };
}

describe('RetencaoDadosService.purgarCurriculosExpirados', () => {
  it('apaga o blob e os embeddings antes de zerar o texto', async () => {
    const { service, prisma, storage } = montar();
    prisma.curriculoProcessado.findMany.mockResolvedValue([
      { id: 'cv-1', candidato_id: 'c-1', arquivo_url: 'cv/aa/bb.pdf' },
    ]);

    const r = await service.purgarCurriculosExpirados();

    expect(r.purgados).toBe(1);
    expect(storage.deleteObject).toHaveBeenCalledWith('cv/aa/bb.pdf');
    expect(prisma.embedding.deleteMany).toHaveBeenCalledWith({
      where: { curriculo_id: 'cv-1' },
    });
    expect(prisma.curriculoProcessado.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cv-1' },
        data: expect.objectContaining({
          texto_bruto: MARCADOR_PURGADO,
          texto_normalizado: MARCADOR_PURGADO,
          arquivo_url: null,
          competencias: [],
        }),
      }),
    );
  });

  it('exclui da varredura o que já carrega o marcador (idempotência)', async () => {
    const { service, prisma } = montar();
    await service.purgarCurriculosExpirados();

    const where = prisma.curriculoProcessado.findMany.mock.calls[0][0].where;
    expect(where.texto_bruto).toEqual({ not: MARCADOR_PURGADO });
  });

  it('usa RETENCAO_CV_DIAS para calcular o corte', async () => {
    const { service, prisma } = montar({ RETENCAO_CV_DIAS: 10 });
    await service.purgarCurriculosExpirados();

    const { lte } = prisma.curriculoProcessado.findMany.mock.calls[0][0].where
      .processado_em;
    const diasAtras = (Date.now() - lte.getTime()) / (24 * 60 * 60 * 1000);
    expect(diasAtras).toBeCloseTo(10, 1);
  });

  it('se o storage falhar, NÃO zera o texto — volta na varredura seguinte', async () => {
    const { service, prisma, storage } = montar();
    prisma.curriculoProcessado.findMany.mockResolvedValue([
      { id: 'cv-1', candidato_id: 'c-1', arquivo_url: 'cv/aa/bb.pdf' },
    ]);
    storage.deleteObject.mockRejectedValue(new Error('MinIO fora do ar'));

    const r = await service.purgarCurriculosExpirados();

    expect(r.purgados).toBe(0);
    expect(prisma.curriculoProcessado.update).not.toHaveBeenCalled();
    expect(prisma.registroAuditoria.create).not.toHaveBeenCalled();
  });
});

describe('RetencaoDadosService.apagarCandidato', () => {
  const candidatoCompleto = {
    id: 'c-1',
    excluido_em: null,
    curriculos: [{ id: 'cv-1', arquivo_url: 'cv/1.pdf' }],
    entrevistas: [{ id: 'e-1', audio_url: 'audio/1.enc' }],
  };

  it('apaga currículo, áudio, transcrição e mensagens, e carimba a lápide', async () => {
    const { service, prisma, storage } = montar();
    prisma.candidato.findUnique.mockResolvedValue(candidatoCompleto);
    prisma.transcricao.updateMany.mockResolvedValue({ count: 1 });
    prisma.mensagem.deleteMany.mockResolvedValue({ count: 3 });

    const r = await service.apagarCandidato('c-1', { motivo: 'pedido do titular' });

    expect(storage.deleteObject).toHaveBeenCalledWith('cv/1.pdf');
    expect(storage.deleteObject).toHaveBeenCalledWith('audio/1.enc');
    expect(prisma.mensagem.deleteMany).toHaveBeenCalledWith({
      where: { candidato_id: 'c-1' },
    });
    expect(r.categorias).toEqual(
      expect.arrayContaining([
        'curriculo',
        'audio_entrevista',
        'transcricao',
        'mensagens',
        'identificacao_candidato',
      ]),
    );

    const data = prisma.candidato.update.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        nome_completo: MARCADOR_PURGADO,
        email: null,
        telefone: null,
        linkedin_url: null,
        cpf_hash: null,
      }),
    );
    // A lápide é o que impede o sync da Gupy de repopular o registro.
    expect(data.excluido_em).toBeInstanceOf(Date);
  });

  it('a auditoria registra categoria e motivo — nunca o valor do dado', async () => {
    const { service, prisma } = montar();
    prisma.candidato.findUnique.mockResolvedValue(candidatoCompleto);

    await service.apagarCandidato('c-1', {
      motivo: 'protocolo 42',
      autorId: 'u-1',
    });

    const { data } = prisma.registroAuditoria.create.mock.calls[0][0];
    expect(data).toEqual(
      expect.objectContaining({
        acao: 'exclusao_lgpd_candidato',
        entidade: 'candidato',
        entidade_id: 'c-1',
        usuario_id: 'u-1',
      }),
    );
    const diff = JSON.stringify(data.diff);
    expect(diff).toContain('protocolo 42');
    expect(diff).toContain('identificacao_candidato');
    // Nenhum valor pessoal pode vazar para dentro da trilha.
    expect(diff).not.toContain('@');
  });

  it('é idempotente: candidato já apagado não gera nova auditoria', async () => {
    const { service, prisma } = montar();
    prisma.candidato.findUnique.mockResolvedValue({
      ...candidatoCompleto,
      excluido_em: new Date(),
    });

    const r = await service.apagarCandidato('c-1', { motivo: 'repetido' });

    expect(r.categorias).toEqual([]);
    expect(prisma.candidato.update).not.toHaveBeenCalled();
    expect(prisma.registroAuditoria.create).not.toHaveBeenCalled();
  });

  it('recusa candidato inexistente', async () => {
    const { service } = montar();
    await expect(
      service.apagarCandidato('nao-existe', { motivo: 'x' }),
    ).rejects.toThrow(/não existe/);
  });
});

describe('RetencaoDadosService.apagarCandidatosInativos', () => {
  /**
   * Estes testes olham a FORMA do `where` porque é aí que mora o risco: um
   * filtro frouxo aqui apaga, de forma irreversível, os dados de alguém que
   * ainda está em processo. Perder qualquer uma das cláusulas quebra o teste.
   */
  it('exige candidatura, e nenhuma recente ou em andamento', async () => {
    const { service, prisma } = montar();
    await service.apagarCandidatosInativos();

    const { where } = prisma.candidato.findMany.mock.calls[0][0];
    expect(where.excluido_em).toBeNull();
    expect(where.candidaturas.some).toEqual({});

    // `none` sobre um OR: nenhuma candidatura pode ser recente NEM estar fora
    // de um status terminal.
    const [recente, emAndamento] = where.candidaturas.none.OR;
    expect(recente).toHaveProperty('criado_em');
    expect(emAndamento.status.notIn).toEqual(
      expect.arrayContaining(['REPROVADO', 'DESISTENTE', 'CONTRATADO']),
    );
  });

  it('não alcança quem tem entrevista aberta ou admissão', async () => {
    const { service, prisma } = montar();
    await service.apagarCandidatosInativos();

    const { where } = prisma.candidato.findMany.mock.calls[0][0];
    expect(where.entrevistas.none.status.in).toEqual(
      expect.arrayContaining(['AGENDADA', 'EM_ANDAMENTO']),
    );
    expect(where.admissoes).toEqual({ none: {} });
  });

  it('filtra por criado_em, não por atualizado_em (que o sync toca a cada 6h)', async () => {
    const { service, prisma } = montar({ RETENCAO_CANDIDATO_DIAS: 30 });
    await service.apagarCandidatosInativos();

    const { where } = prisma.candidato.findMany.mock.calls[0][0];
    const recente = where.candidaturas.none.OR[0];
    expect(recente).toHaveProperty('criado_em');
    expect(recente).not.toHaveProperty('atualizado_em');

    const diasAtras =
      (Date.now() - recente.criado_em.gt.getTime()) / (24 * 60 * 60 * 1000);
    expect(diasAtras).toBeCloseTo(30, 1);
  });
});

/**
 * O ensaio serve para conferir o filtro antes de encurtar um prazo. Se ele
 * apagar alguma coisa, perde o sentido — e o dado não volta.
 */
describe('RetencaoDadosService — modo simulado', () => {
  it('sem a variável definida, o modo é REAL — a política não fica esperando alguém ligar', async () => {
    const { service, prisma } = montar({ RETENCAO_MODO: undefined as never });
    prisma.curriculoProcessado.findMany.mockResolvedValue([
      { id: 'cv-1', candidato_id: 'c-1', arquivo_url: null },
    ]);

    const r = await service.purgarCurriculosExpirados();

    expect(r.simulado).toBe(false);
    expect(prisma.curriculoProcessado.update).toHaveBeenCalled();
  });

  it('conta os currículos elegíveis sem tocar em storage nem em banco', async () => {
    const { service, prisma, storage } = montar({ RETENCAO_MODO: 'simulado' });
    prisma.curriculoProcessado.findMany.mockResolvedValue([
      { id: 'cv-1', candidato_id: 'c-1', arquivo_url: 'cv/1.pdf' },
      { id: 'cv-2', candidato_id: 'c-2', arquivo_url: null },
    ]);

    const r = await service.purgarCurriculosExpirados();

    expect(r).toEqual({ purgados: 2, simulado: true });
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.embedding.deleteMany).not.toHaveBeenCalled();
    expect(prisma.curriculoProcessado.update).not.toHaveBeenCalled();
    expect(prisma.registroAuditoria.create).not.toHaveBeenCalled();
  });

  it('conta os candidatos elegíveis sem apagar', async () => {
    const { service, prisma, storage } = montar({ RETENCAO_MODO: 'simulado' });
    prisma.candidato.findMany.mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]);

    const r = await service.apagarCandidatosInativos();

    expect(r).toEqual({ apagados: 2, simulado: true });
    expect(prisma.candidato.update).not.toHaveBeenCalled();
    expect(prisma.mensagem.deleteMany).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('o pedido do titular (Art. 18) IGNORA o modo e apaga de verdade', async () => {
    // Simular a resposta a um direito exercido seria negá-lo em silêncio.
    const { service, prisma } = montar({ RETENCAO_MODO: 'simulado' });
    prisma.candidato.findUnique.mockResolvedValue({
      id: 'c-1',
      excluido_em: null,
      curriculos: [],
      entrevistas: [],
    });

    await service.apagarCandidato('c-1', { motivo: 'pedido do titular' });

    expect(prisma.candidato.update).toHaveBeenCalled();
    expect(prisma.registroAuditoria.create).toHaveBeenCalled();
  });
});
