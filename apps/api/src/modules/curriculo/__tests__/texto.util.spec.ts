import {
  normalizarTexto,
  pareceTextoUtil,
} from '../parsers/texto.util.js';

describe('texto.util', () => {
  describe('normalizarTexto', () => {
    it('remove caracteres de controle preservando \\n e \\t', () => {
      const input = 'linha 1\u0000\u0001\nlinha 2\u0007\u007F';
      const out = normalizarTexto(input);
      expect(out).toContain('linha 1');
      expect(out).toContain('linha 2');
      expect(out).not.toMatch(/[\u0000-\u0008]/);
    });

    it('colapsa múltiplos espaços e tabs em um só', () => {
      expect(normalizarTexto('foo   bar\t\tbaz')).toBe('foo bar baz');
    });

    it('remove linhas em branco', () => {
      const out = normalizarTexto('a\n\n\nb\n   \nc');
      expect(out).toBe('a\nb\nc');
    });

    it('normaliza NFKC (compatibilidade unicode)', () => {
      // U+FB01 (ligadura "fi") → "fi"
      const out = normalizarTexto('e\uFB01ciente');
      expect(out).toBe('eficiente');
    });

    it('trunca em 50KB sem cortar caractere multi-byte', () => {
      const grande = 'á'.repeat(60_000); // ~120KB em UTF-8
      const out = normalizarTexto(grande);
      expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(50_000);
      // Não pode ter byte de substituição U+FFFD por corte mid-char
      expect(out).not.toContain('\uFFFD');
    });

    it('retorna string vazia para input vazio/nulo', () => {
      expect(normalizarTexto('')).toBe('');
      expect(normalizarTexto(undefined as unknown as string)).toBe('');
    });
  });

  describe('pareceTextoUtil', () => {
    it('rejeita texto muito curto', () => {
      expect(pareceTextoUtil('curto')).toBe(false);
    });

    it('rejeita texto sem espaços (CV escaneado mal-extraído)', () => {
      const sem = 'a'.repeat(200);
      expect(pareceTextoUtil(sem)).toBe(false);
    });

    it('aceita texto com proporção saudável de espaços', () => {
      const ok =
        'João Silva é um engenheiro de software com 8 anos de experiência em backend Node.js e PostgreSQL.';
      expect(pareceTextoUtil(ok)).toBe(true);
    });
  });
});
