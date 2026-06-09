import type { Job, Queue } from 'bullmq';

import { EmbeddingProcessor } from '../processors/embedding.processor.js';
import { EmbeddingService } from '../services/embedding.service.js';
import { MatchingProcessor } from '../processors/matching.processor.js';
import { MatchingService } from '../services/matching.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

function fakeJob(data: unknown, id = '1'): Job<unknown> {
  return { id, data, attemptsMade: 0 } as Job<unknown>;
}

describe('EmbeddingProcessor', () => {
  let embeddings: jest.Mocked<EmbeddingService>;
  let prisma: any;
  let filaMatching: jest.Mocked<Queue>;
  let processor: EmbeddingProcessor;

  beforeEach(() => {
    embeddings = {
      embedarVaga: jest.fn(),
      embedarCurriculo: jest.fn(),
    } as unknown as jest.Mocked<EmbeddingService>;
    prisma = { candidatura: { findUnique: jest.fn() } };
    filaMatching = { add: jest.fn() } as unknown as jest.Mocked<Queue>;
    processor = new EmbeddingProcessor(
      embeddings,
      prisma as PrismaService,
      filaMatching,
    );
  });

  it('rejeita payload inválido', async () => {
    await expect(
      processor.process(fakeJob({ alvo: 'outro', candidaturaId: 'x' })),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('alvo=vaga: chama embedarVaga e NÃO enfileira matching', async () => {
    embeddings.embedarVaga.mockResolvedValue({ embeddingId: 'e-1' });
    const out = await processor.process(
      fakeJob({
        alvo: 'vaga',
        vagaId: '00000000-0000-4000-8000-000000000010',
      }),
    );
    expect(out.embeddingId).toBe('e-1');
    expect(filaMatching.add).not.toHaveBeenCalled();
  });

  it('alvo=curriculo: chama embedarCurriculo e cascateia matching', async () => {
    const candidaturaId = '00000000-0000-4000-8000-000000000020';
    embeddings.embedarCurriculo.mockResolvedValue({ embeddingId: 'e-2' });
    prisma.candidatura.findUnique.mockResolvedValue({ vaga_id: 'v-1' });

    const out = await processor.process(
      fakeJob({ alvo: 'curriculo', candidaturaId, cascataMatching: true }),
    );

    expect(out.embeddingId).toBe('e-2');
    expect(filaMatching.add).toHaveBeenCalledWith(
      'matching-candidatura',
      { candidaturaId, vagaId: 'v-1' },
      { jobId: `match-${candidaturaId}` },
    );
  });

  it('alvo=curriculo sem candidatura no banco: loga warn, sem crash', async () => {
    const candidaturaId = '00000000-0000-4000-8000-000000000030';
    embeddings.embedarCurriculo.mockResolvedValue({ embeddingId: 'e-3' });
    prisma.candidatura.findUnique.mockResolvedValue(null);

    const out = await processor.process(
      fakeJob({ alvo: 'curriculo', candidaturaId, cascataMatching: true }),
    );
    expect(out.embeddingId).toBe('e-3');
    expect(filaMatching.add).not.toHaveBeenCalled();
  });
});

describe('MatchingProcessor', () => {
  let matching: jest.Mocked<MatchingService>;
  let processor: MatchingProcessor;

  beforeEach(() => {
    matching = {
      scorearCandidatura: jest.fn(),
    } as unknown as jest.Mocked<MatchingService>;
    processor = new MatchingProcessor(matching);
  });

  it('rejeita payload inválido', async () => {
    await expect(
      processor.process(fakeJob({ candidaturaId: 'x' })),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('encaminha para MatchingService e retorna score consolidado', async () => {
    matching.scorearCandidatura.mockResolvedValue({
      candidaturaId: '00000000-0000-4000-8000-000000000040',
      candidatoId: 'c',
      candidatoNome: 'A',
      curriculoId: 'cv',
      distancia: 0.2,
      similaridadeVetorial: 90,
      scoreRankingCv: 80,
      scoreConsolidado: 84,
      justificativa: 'ok',
    });

    const out = await processor.process(
      fakeJob({
        candidaturaId: '00000000-0000-4000-8000-000000000040',
        vagaId: '00000000-0000-4000-8000-000000000050',
      }),
    );
    expect(out.scoreConsolidado).toBe(84);
  });
});
