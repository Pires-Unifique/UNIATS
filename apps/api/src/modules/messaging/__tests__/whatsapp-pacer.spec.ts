import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { WhatsappPacerService } from '../whatsapp-pacer.service.js';

/**
 * O pacer decide por relógio de parede no fuso configurado. Para testes
 * determinísticos, congelamos o relógio com jest.setSystemTime em instantes
 * UTC cuja hora em America/Sao_Paulo (UTC-3, sem DST) é conhecida.
 */
type MockPrisma = { mensagem: { count: jest.Mock } };

function montar(envOverrides: Record<string, unknown> = {}) {
  const prisma: MockPrisma = {
    mensagem: { count: jest.fn().mockResolvedValue(0) },
  };
  const waha = { salvarContato: jest.fn(async () => undefined) };
  const env: Record<string, unknown> = {
    WHATSAPP_PACING: true,
    WHATSAPP_CAP_DIARIO: 80,
    WHATSAPP_JANELA_INICIO: 8,
    WHATSAPP_JANELA_FIM: 19,
    WHATSAPP_JANELA_DIAS: '1,2,3,4,5,6',
    WHATSAPP_JITTER_MIN_MS: 0,
    WHATSAPP_JITTER_MAX_MS: 0,
    WHATSAPP_SALVAR_CONTATO: true,
    WHATSAPP_TIMEZONE: 'America/Sao_Paulo',
    ...envOverrides,
  };
  const config = { get: jest.fn((k: string) => env[k]) };
  const service = new WhatsappPacerService(
    config as any,
    prisma as any,
    waha as any,
  );
  return { service, prisma, waha };
}

// Quarta-feira 2026-07-01: 14:00 UTC = 11:00 em São Paulo (dentro da janela 8-19).
const QUARTA_11H_SP = new Date('2026-07-01T14:00:00Z');
// Quarta-feira 2026-07-01: 23:30 UTC = 20:30 em SP (depois do fechamento).
const QUARTA_20H30_SP = new Date('2026-07-01T23:30:00Z');
// Sábado 2026-07-04: 14:00 UTC = 11:00 em SP (sábado é permitido no default).
// Domingo 2026-07-05: 14:00 UTC = 11:00 em SP (domingo NÃO é permitido).
const DOMINGO_11H_SP = new Date('2026-07-05T14:00:00Z');

describe('WhatsappPacerService.avaliarJanelaECap', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('libera dentro da janela com cap folgado', async () => {
    jest.setSystemTime(QUARTA_11H_SP);
    const { service, prisma } = montar();
    prisma.mensagem.count.mockResolvedValue(10);

    const r = await service.avaliarJanelaECap();
    expect(r).toEqual({ liberado: true });
  });

  it('fora do horário → retoma na abertura do dia seguinte', async () => {
    jest.setSystemTime(QUARTA_20H30_SP);
    const { service } = montar();

    const r = await service.avaliarJanelaECap();
    expect(r.liberado).toBe(false);
    if (!r.liberado) {
      expect(r.motivo).toMatch(/janela/);
      // Quinta 08:00 SP = 11:00 UTC de 2026-07-02.
      expect(r.retomarEm.toISOString()).toBe('2026-07-02T11:00:00.000Z');
    }
  });

  it('domingo → retoma segunda na abertura', async () => {
    jest.setSystemTime(DOMINGO_11H_SP);
    const { service } = montar();

    const r = await service.avaliarJanelaECap();
    expect(r.liberado).toBe(false);
    if (!r.liberado) {
      // Segunda 2026-07-06 08:00 SP = 11:00 UTC.
      expect(r.retomarEm.toISOString()).toBe('2026-07-06T11:00:00.000Z');
    }
  });

  it('teto diário atingido → retoma AMANHÃ mesmo com a janela aberta', async () => {
    jest.setSystemTime(QUARTA_11H_SP);
    const { service, prisma } = montar({ WHATSAPP_CAP_DIARIO: 50 });
    prisma.mensagem.count.mockResolvedValue(50);

    const r = await service.avaliarJanelaECap();
    expect(r.liberado).toBe(false);
    if (!r.liberado) {
      expect(r.motivo).toMatch(/teto diário/);
      expect(r.retomarEm.toISOString()).toBe('2026-07-02T11:00:00.000Z');
    }
    // O count deve olhar só o dia local corrente (desde 00:00 SP = 03:00 UTC).
    const arg = prisma.mensagem.count.mock.calls[0][0] as any;
    expect(arg.where.enviado_em.gte.toISOString()).toBe('2026-07-01T03:00:00.000Z');
  });

  it('cap 0 = sem teto (não consulta o banco)', async () => {
    jest.setSystemTime(QUARTA_11H_SP);
    const { service, prisma } = montar({ WHATSAPP_CAP_DIARIO: 0 });

    const r = await service.avaliarJanelaECap();
    expect(r).toEqual({ liberado: true });
    expect(prisma.mensagem.count).not.toHaveBeenCalled();
  });

  it('pacing desligado libera sempre (dev)', async () => {
    jest.setSystemTime(DOMINGO_11H_SP);
    const { service, prisma } = montar({ WHATSAPP_PACING: false });

    const r = await service.avaliarJanelaECap();
    expect(r).toEqual({ liberado: true });
    expect(prisma.mensagem.count).not.toHaveBeenCalled();
  });
});

describe('WhatsappPacerService.salvarContatoSeNovo', () => {
  it('salva no 1º contato (nenhuma mensagem enviada antes)', async () => {
    const { service, prisma, waha } = montar({
      WHATSAPP_JITTER_MIN_MS: 0,
      WHATSAPP_JITTER_MAX_MS: 0,
    });
    prisma.mensagem.count.mockResolvedValue(0);

    await service.salvarContatoSeNovo('cand-1', '5547999@c.us', 'Ana Souza');
    expect(waha.salvarContato).toHaveBeenCalledWith('5547999@c.us', 'Ana Souza');
  });

  it('não salva de novo em contato recorrente', async () => {
    const { service, prisma, waha } = montar();
    prisma.mensagem.count.mockResolvedValue(3);

    await service.salvarContatoSeNovo('cand-1', '5547999@c.us', 'Ana Souza');
    expect(waha.salvarContato).not.toHaveBeenCalled();
  });

  it('desligado por env ou sem nome → no-op', async () => {
    const desligado = montar({ WHATSAPP_SALVAR_CONTATO: false });
    await desligado.service.salvarContatoSeNovo('c', 'x@c.us', 'Ana');
    expect(desligado.waha.salvarContato).not.toHaveBeenCalled();

    const semNome = montar();
    await semNome.service.salvarContatoSeNovo('c', 'x@c.us', null);
    expect(semNome.waha.salvarContato).not.toHaveBeenCalled();
  });

  it('falha no WAHA nunca propaga (best-effort)', async () => {
    const { service, prisma, waha } = montar();
    prisma.mensagem.count.mockRejectedValue(new Error('db off'));
    await expect(
      service.salvarContatoSeNovo('c', 'x@c.us', 'Ana'),
    ).resolves.toBeUndefined();
    expect(waha.salvarContato).not.toHaveBeenCalled();
  });
});

describe('WhatsappPacerService.aguardarVez', () => {
  it('com pacing desligado retorna imediato', async () => {
    const { service } = montar({ WHATSAPP_PACING: false });
    await expect(service.aguardarVez()).resolves.toBeUndefined();
  });

  it('serializa envios: o 2º chamado espera o gap do 1º', async () => {
    const { service } = montar({
      WHATSAPP_JITTER_MIN_MS: 30,
      WHATSAPP_JITTER_MAX_MS: 30,
    });
    const t0 = Date.now();
    await service.aguardarVez(); // 1º: sai na hora, agenda o próximo p/ +30ms
    await service.aguardarVez(); // 2º: precisa esperar ~30ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});

describe('WhatsappPacerService.statusDoDia', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reporta envios do dia, cap e janela para a tela WhatsApp', async () => {
    jest.setSystemTime(QUARTA_11H_SP);
    const { service, prisma } = montar();
    prisma.mensagem.count.mockResolvedValue(12);

    const s = await service.statusDoDia();
    expect(s).toEqual({
      pacing_ativo: true,
      enviadas_hoje: 12,
      cap_diario: 80,
      janela: '08h–19h',
      dentro_janela: true,
    });
  });
});
