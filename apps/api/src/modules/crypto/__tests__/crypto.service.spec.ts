import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { CryptoService } from '../crypto.service.js';

function configMock(opts: { key?: string; env?: string } = {}): ConfigService {
  const map: Record<string, unknown> = {
    DATA_ENCRYPTION_KEY: opts.key,
    NODE_ENV: opts.env ?? 'test',
  };
  return {
    get: <T>(k: string) => map[k] as T,
    getOrThrow: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

function chaveValida(): string {
  return randomBytes(32).toString('base64');
}

describe('CryptoService', () => {
  it('falha alto em produção se chave ausente', () => {
    const svc = new CryptoService(configMock({ env: 'production' }));
    expect(() => svc.onModuleInit()).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  it('rejeita chave com tamanho errado', () => {
    const svc = new CryptoService(
      configMock({ key: Buffer.alloc(16).toString('base64') }),
    );
    expect(() => svc.onModuleInit()).toThrow(/32 bytes/);
  });

  it('em dev sem chave fica inoperante e rejeita encrypt/decrypt', () => {
    const svc = new CryptoService(configMock());
    svc.onModuleInit();
    expect(svc.estaDisponivel()).toBe(false);
    expect(() => svc.encrypt(Buffer.from('x'))).toThrow();
    expect(() => svc.decrypt(Buffer.alloc(50))).toThrow();
  });

  describe('com chave válida', () => {
    let svc: CryptoService;

    beforeEach(() => {
      svc = new CryptoService(configMock({ key: chaveValida() }));
      svc.onModuleInit();
    });

    it('faz roundtrip encrypt → decrypt corretamente', () => {
      const original = Buffer.from('áudio binário muito sensível 🎤', 'utf8');
      const enc = svc.encrypt(original);
      const dec = svc.decrypt(enc.bytes);
      expect(dec.equals(original)).toBe(true);
      // bytes deve ser maior que original (header iv+tag)
      expect(enc.bytes.length).toBeGreaterThan(original.length);
    });

    it('IV é único por chamada (criptografar mesmo plaintext duas vezes dá output diferente)', () => {
      const data = Buffer.from('mesma mensagem');
      const a = svc.encrypt(data);
      const b = svc.encrypt(data);
      expect(a.bytes.equals(b.bytes)).toBe(false);
    });

    it('detecta tampering no ciphertext (modifica 1 byte → decrypt falha)', () => {
      const data = Buffer.from('dados sensíveis');
      const enc = svc.encrypt(data);
      // Modifica um byte do ciphertext (posição > IV+TAG)
      enc.bytes[enc.bytes.length - 1] ^= 0xff;
      expect(() => svc.decrypt(enc.bytes)).toThrow(/integridade/);
    });

    it('detecta tampering na tag', () => {
      const data = Buffer.from('dados sensíveis');
      const enc = svc.encrypt(data);
      enc.bytes[12] ^= 0x01; // primeiro byte do tag (offset 12)
      expect(() => svc.decrypt(enc.bytes)).toThrow(/integridade/);
    });

    it('AAD diferente no decrypt falha (vincula payload a contexto)', () => {
      const data = Buffer.from('vinculado-a-entrevista-1');
      const aadCorreto = Buffer.from('entrevista-1');
      const aadErrado = Buffer.from('entrevista-OUTRA');
      const enc = svc.encrypt(data, aadCorreto);
      expect(svc.decrypt(enc.bytes, aadCorreto).equals(data)).toBe(true);
      expect(() => svc.decrypt(enc.bytes, aadErrado)).toThrow(/integridade/);
    });

    it('rejeita payload muito curto', () => {
      expect(() => svc.decrypt(Buffer.alloc(10))).toThrow(/muito curto/);
    });

    it('rejeita plaintext vazio', () => {
      expect(() => svc.encrypt(Buffer.alloc(0))).toThrow();
    });

    it('compararEmTempoConstante reconhece igualdade', () => {
      expect(
        svc.compararEmTempoConstante(Buffer.from('abc'), Buffer.from('abc')),
      ).toBe(true);
      expect(
        svc.compararEmTempoConstante(Buffer.from('abc'), Buffer.from('abd')),
      ).toBe(false);
      expect(
        svc.compararEmTempoConstante(Buffer.from('abc'), Buffer.from('abcd')),
      ).toBe(false);
    });
  });
});
