import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

import { AtaReuniaoSchema, ATA_RESUMO_MAX_CHARS } from '../../claude/ata.schema.js';
import { GraphClient } from '../../graph/graph.client.js';
import { FusaoTranscricaoProcessor } from '../processors/fusao-transcricao.processor.js';
import { PlaywrightTranscricaoProcessor } from '../processors/playwright-transcricao.processor.js';
import { TranscricaoGraphProcessor } from '../processors/transcricao-graph.processor.js';

/**
 * A ATA nunca tinha rodado numa entrevista real — a censura falhava antes. Quando o
 * loteamento destravou a censura, ela estourou o cap de 3000 chars e, por não estar
 * protegida por catch em dois dos três chamadores, derrubou o job DEPOIS de a
 * transcrição já estar no banco: entrevista presa em EM_ANDAMENTO, fusão nunca
 * agendada, e cada retry re-executando a censura inteira para morrer no mesmo ponto.
 */

const ENTREVISTA = '3f7c1a90-1111-4222-8333-444455556666';
const job = (data: unknown): Job => ({ data, id: '1', attemptsMade: 0 }) as unknown as Job;

function configMock(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

/** RedacaoService: devolve os turnos intactos (a censura não é o alvo aqui). */
function redacaoMock() {
  return {
    redigirTurnos: jest.fn(async (turnos: Array<{ texto: string }>) => ({
      turnos,
      texto: turnos.map((t) => t.texto).join('\n'),
    })),
    redigirRegexTexto: jest.fn((t: string) => t),
  };
}

function filaMock() {
  return { add: jest.fn(async () => undefined) };
}

const erroDaAta = new Error('Estrutura da ATA inválida — esquema falhou.');

describe('AtaReuniaoSchema — cap do resumo', () => {
  const base = { topicos: [] };

  it('aceita um resumo longo de entrevista de 1h (o que quebrava em 3000)', () => {
    const r = AtaReuniaoSchema.safeParse({ ...base, resumo: 'x'.repeat(4_500) });
    expect(r.success).toBe(true);
  });

  it('aceita exatamente no cap e rejeita um caractere acima', () => {
    expect(
      AtaReuniaoSchema.safeParse({ ...base, resumo: 'x'.repeat(ATA_RESUMO_MAX_CHARS) }).success,
    ).toBe(true);
    expect(
      AtaReuniaoSchema.safeParse({ ...base, resumo: 'x'.repeat(ATA_RESUMO_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });

  it('continua rejeitando resumo vazio', () => {
    expect(AtaReuniaoSchema.safeParse({ ...base, resumo: '' }).success).toBe(false);
  });
});

describe('ATA best-effort — processor do Playwright', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function montar(gerarAtaReuniao: jest.Mock) {
    const prisma = {
      entrevista: {
        findUnique: jest.fn(async () => ({ id: ENTREVISTA, status: 'EM_ANDAMENTO' })),
        update: jest.fn(async () => undefined),
      },
      transcricao: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => undefined),
        update: jest.fn(async () => undefined),
      },
    };
    const fila = filaMock();
    const proc = new PlaywrightTranscricaoProcessor(
      prisma as never,
      { gerarAtaReuniao } as never,
      redacaoMock() as never,
      configMock(),
      fila as never,
    );
    return { proc, prisma, fila };
  }

  const payload = {
    entrevistaId: ENTREVISTA,
    texto: 'DHO: bom dia',
    segmentos: [{ inicio_ms: 0, falante: 'DHO', texto: 'bom dia' }],
    whisperSegmentos: [{ inicio_ms: 0, falante: 'Desconhecido', texto: 'bom dia' }],
  };

  it('ATA falhando NÃO derruba o job: transcrição fica, entrevista fecha, fusão é agendada', async () => {
    const { proc, prisma, fila } = montar(jest.fn().mockRejectedValue(erroDaAta));

    const r = await proc.process(job(payload));

    expect(r).toEqual({ entrevistaId: ENTREVISTA, ok: true });
    expect(prisma.transcricao.upsert).toHaveBeenCalledTimes(1);
    // Sem ATA não há update de resumo — mas o resto do fluxo continua.
    expect(prisma.transcricao.update).not.toHaveBeenCalled();
    expect(prisma.entrevista.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FINALIZADA', bot_status: 'ended' }),
      }),
    );
    expect(fila.add).toHaveBeenCalledTimes(1); // fusão agendada
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ATA falhou'));
  });

  it('ATA funcionando grava resumo e tópicos normalmente', async () => {
    const { proc, prisma } = montar(
      jest.fn().mockResolvedValue({ ata: { resumo: 'Contexto: ...', topicos: ['Node'] } }),
    );

    await proc.process(job(payload));

    expect(prisma.transcricao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { resumo: 'Contexto: ...', topicos: ['Node'] },
      }),
    );
  });
});

describe('ATA best-effort — processor do Graph', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    // O oid sai do ?context do joinUrl; aqui o formato do link não é o alvo.
    jest.spyOn(GraphClient, 'extrairOidDoJoinUrl').mockReturnValue('oid-1');
  });
  afterEach(() => jest.restoreAllMocks());

  it('ATA falhando NÃO impede fechar a entrevista nem agendar a fusão', async () => {
    const prisma = {
      entrevista: {
        findUnique: jest.fn(async () => ({
          id: ENTREVISTA,
          teams_join_url: 'https://teams.microsoft.com/l/meetup-join/x',
          meet_url: null,
          graph_online_meeting_id: 'meet-1',
          graph_organizador_email: 'rh@unifique.com.br',
          entrevistador: null,
          candidatura: { vaga: { recrutador: null } },
        })),
        update: jest.fn(async () => undefined),
      },
      transcricao: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => undefined),
        update: jest.fn(async () => undefined),
      },
    };
    const graph = {
      enabled: true,
      listarTranscripts: jest.fn(async () => [{ id: 't1', criadoEm: '2026-08-04T10:00:00Z' }]),
      baixarTranscriptVtt: jest.fn(
        async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v DHO>Bom dia.</v>\n',
      ),
    };
    const fila = filaMock();
    const proc = new TranscricaoGraphProcessor(
      prisma as never,
      graph as never,
      { gerarAtaReuniao: jest.fn().mockRejectedValue(erroDaAta) } as never,
      redacaoMock() as never,
      configMock(),
      fila as never,
    );

    const r = await proc.process(job({ entrevistaId: ENTREVISTA }));

    expect(r).toEqual({ entrevistaId: ENTREVISTA, ok: true });
    expect(prisma.transcricao.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.transcricao.update).not.toHaveBeenCalled();
    expect(prisma.entrevista.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FINALIZADA' }),
      }),
    );
    expect(fila.add).toHaveBeenCalledTimes(1);
  });
});

describe('ATA best-effort — processor da fusão (comportamento já existente)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('ATA falhando ainda grava o texto fundido e mantém o resumo anterior', async () => {
    const prisma = {
      transcricao: {
        findUnique: jest.fn(async () => ({
          segmentos: [{ falante: 'DHO', texto: 'bom dia' }],
          whisper_segmentos: [{ texto: 'bom dia' }],
        })),
        update: jest.fn(async () => undefined),
      },
    };
    const claude = {
      fundirTranscricoes: jest.fn(async () => ({
        turnos: [{ falante: 'DHO', texto: 'bom dia' }],
        texto: 'DHO: bom dia',
      })),
      gerarAtaReuniao: jest.fn().mockRejectedValue(erroDaAta),
    };
    const proc = new FusaoTranscricaoProcessor(
      prisma as never,
      claude as never,
      { analisar: jest.fn(async () => undefined) } as never,
      { notificarAnalisePronta: jest.fn(async () => undefined) } as never,
      redacaoMock() as never,
    );

    const r = await proc.process(job({ entrevistaId: ENTREVISTA }));

    expect(r).toEqual({ entrevistaId: ENTREVISTA, ok: true });
    const gravado = prisma.transcricao.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(gravado.data.texto_fundido).toBe('DHO: bom dia');
    // Sem ATA nova, o resumo anterior não é sobrescrito.
    expect(gravado.data).not.toHaveProperty('resumo');
  });
});
