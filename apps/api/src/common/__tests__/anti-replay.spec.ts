import { UnauthorizedException } from '@nestjs/common';

import {
  assertDentroDaJanela,
  TOLERANCIA_REPLAY_PADRAO_MS,
} from '../anti-replay.js';

describe('assertDentroDaJanela', () => {
  it('aceita evento recente', () => {
    expect(() =>
      assertDentroDaJanela(Date.now() - 30_000, 'Teste'),
    ).not.toThrow();
  });

  it('recusa evento mais velho que a tolerância', () => {
    const velho = Date.now() - TOLERANCIA_REPLAY_PADRAO_MS - 1_000;
    expect(() => assertDentroDaJanela(velho, 'Teste')).toThrow(
      UnauthorizedException,
    );
  });

  it('recusa evento no futuro — relógio adiantado estenderia a validade do payload', () => {
    const futuro = Date.now() + TOLERANCIA_REPLAY_PADRAO_MS + 1_000;
    expect(() => assertDentroDaJanela(futuro, 'Teste')).toThrow(
      UnauthorizedException,
    );
  });

  it('respeita tolerância customizada (SendGrid usa 10 min)', () => {
    const oitoMin = Date.now() - 8 * 60 * 1000;
    expect(() => assertDentroDaJanela(oitoMin, 'Teste')).toThrow();
    expect(() =>
      assertDentroDaJanela(oitoMin, 'Teste', { toleranciaMs: 10 * 60 * 1000 }),
    ).not.toThrow();
  });

  describe('timestamp ausente', () => {
    it('por padrão apenas alerta — não derruba a ingestão', () => {
      expect(() => assertDentroDaJanela(null, 'Teste')).not.toThrow();
      expect(() => assertDentroDaJanela(undefined, 'Teste')).not.toThrow();
      expect(() => assertDentroDaJanela(NaN, 'Teste')).not.toThrow();
    });

    it('recusa quando estrito', () => {
      expect(() =>
        assertDentroDaJanela(null, 'Teste', { estrito: true }),
      ).toThrow(UnauthorizedException);
    });
  });
});
