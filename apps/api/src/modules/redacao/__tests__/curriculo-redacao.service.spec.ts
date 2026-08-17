import { PrismaService } from '../../../prisma/prisma.service.js';
import { CurriculoRedacaoService } from '../curriculo-redacao.service.js';
import { REDACAO_CV_VERSAO } from '../curriculo-para-ia.js';
import { RedacaoService } from '../redacao.service.js';

function montar() {
  const prisma: any = {
    curriculoProcessado: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  // Censura falsa: marca cada turno para ficar óbvio o que passou por ela.
  const redacao: any = {
    redigirTurnos: jest.fn(async (turnos: Array<{ texto: string }>) => ({
      turnos: turnos.map((t) => ({ ...t, texto: `CENSURADO(${t.texto})` })),
      texto: '',
      categorias: ['saude'],
      houveOcultacao: true,
    })),
  };
  const service = new CurriculoRedacaoService(
    prisma as PrismaService,
    redacao as RedacaoService,
  );
  return { service, prisma, redacao };
}

const CV_BASE = {
  id: 'cv-1',
  resumo: 'Resumo original',
  experiencias: [
    { empresa: 'A', cargo: 'Dev', descricao: 'Descricao A' },
    { empresa: 'B', cargo: 'Lead' }, // sem descrição
    { empresa: 'C', cargo: 'Arq', descricao: 'Descricao C' },
  ],
  texto_normalizado: 'Texto completo',
  ia_redacao_versao: null,
};

describe('CurriculoRedacaoService.gerarEspelho', () => {
  it('censura descrições, resumo e texto — e não toca nas colunas originais', async () => {
    const { service, prisma } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue(CV_BASE);

    await service.gerarEspelho('cv-1');

    const { data } = prisma.curriculoProcessado.update.mock.calls[0][0];

    expect(data.ia_experiencias[0].descricao).toBe('CENSURADO(Descricao A)');
    expect(data.ia_experiencias[2].descricao).toBe('CENSURADO(Descricao C)');
    expect(data.ia_resumo).toBe('CENSURADO(Resumo original)');
    expect(data.ia_texto).toBe('CENSURADO(Texto completo)');
    expect(data.ia_redacao_versao).toBe(REDACAO_CV_VERSAO);

    // O original é o que o recrutador lê — não pode ser sobrescrito.
    expect(data).not.toHaveProperty('experiencias');
    expect(data).not.toHaveProperty('resumo');
    expect(data).not.toHaveProperty('texto_normalizado');
  });

  it('mantém o alinhamento quando há experiência SEM descrição', async () => {
    // O bug natural aqui é o cursor: se ele contar as experiências em vez das
    // descrições, a censura de C vai parar no resumo.
    const { service, prisma } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue(CV_BASE);

    await service.gerarEspelho('cv-1');

    const { data } = prisma.curriculoProcessado.update.mock.calls[0][0];
    expect(data.ia_experiencias[1].descricao).toBeUndefined();
    expect(data.ia_experiencias[1].empresa).toBe('B');
    expect(data.ia_resumo).toBe('CENSURADO(Resumo original)');
  });

  it('grava apenas as CATEGORIAS, nunca o valor ocultado', async () => {
    const { service, prisma } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue(CV_BASE);

    await service.gerarEspelho('cv-1');

    const { data } = prisma.curriculoProcessado.update.mock.calls[0][0];
    expect(data.ia_categorias).toEqual(['saude']);
  });

  it('pula quando já está na versão atual', async () => {
    const { service, prisma, redacao } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue({
      ...CV_BASE,
      ia_redacao_versao: REDACAO_CV_VERSAO,
    });

    const r = await service.gerarEspelho('cv-1');

    expect(r.gerado).toBe(false);
    expect(redacao.redigirTurnos).not.toHaveBeenCalled();
    expect(prisma.curriculoProcessado.update).not.toHaveBeenCalled();
  });

  it('com `forcar`, reprocessa mesmo na versão atual', async () => {
    const { service, prisma, redacao } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue({
      ...CV_BASE,
      ia_redacao_versao: REDACAO_CV_VERSAO,
    });

    await service.gerarEspelho('cv-1', { forcar: true });

    expect(redacao.redigirTurnos).toHaveBeenCalled();
  });

  it('currículo sem texto livre marca a versão e sai da fila do backfill', async () => {
    const { service, prisma, redacao } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue({
      id: 'cv-2',
      resumo: null,
      experiencias: [{ empresa: 'A', cargo: 'Dev' }],
      texto_normalizado: '',
      ia_redacao_versao: null,
    });

    const r = await service.gerarEspelho('cv-2');

    expect(r.gerado).toBe(true);
    expect(redacao.redigirTurnos).not.toHaveBeenCalled();
    const { data } = prisma.curriculoProcessado.update.mock.calls[0][0];
    expect(data.ia_redacao_versao).toBe(REDACAO_CV_VERSAO);
  });

  it('falha da censura PROPAGA — espelho parcial seria pior que nenhum', async () => {
    const { service, prisma, redacao } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue(CV_BASE);
    redacao.redigirTurnos.mockRejectedValue(new Error('Claude fora do ar'));

    await expect(service.gerarEspelho('cv-1')).rejects.toThrow('Claude fora do ar');
    expect(prisma.curriculoProcessado.update).not.toHaveBeenCalled();
  });

  it('recusa currículo inexistente', async () => {
    const { service, prisma } = montar();
    prisma.curriculoProcessado.findUnique.mockResolvedValue(null);
    await expect(service.gerarEspelho('nao-existe')).rejects.toThrow(/não existe/);
  });
});
