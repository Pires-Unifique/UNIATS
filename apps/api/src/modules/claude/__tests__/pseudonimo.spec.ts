import { criarPseudonimizador } from '../pseudonimo.js';

describe('criarPseudonimizador', () => {
  it('troca nome completo e partes por tokens distintos', () => {
    const p = criarPseudonimizador('João Silva Souza');
    const saida = p.aplicar(
      'João Silva Souza entrou. O Silva falou. Depois João explicou.',
    );

    expect(saida).not.toMatch(/João/);
    expect(saida).not.toMatch(/Silva/);
    expect(saida).toContain('[CANDIDATO]');
  });

  it('restaura a palavra exata que estava no texto (evidência literal)', () => {
    const p = criarPseudonimizador('João Silva Souza');
    const original = 'João Silva Souza entrou. O Silva falou. Depois João explicou.';

    expect(p.restaurar(p.aplicar(original))).toBe(original);
  });

  it('casa nomes acentuados — \\b do JS não enxerga "ã" como letra', () => {
    const p = criarPseudonimizador('Conceição');
    const saida = p.aplicar('A Conceição respondeu.');

    expect(saida).toBe('A [CANDIDATO] respondeu.');
  });

  it('ignora maiúsculas/minúsculas do transcript', () => {
    const p = criarPseudonimizador('Maria Antunes');
    expect(p.aplicar('maria antunes chegou')).toBe('[CANDIDATO] chegou');
  });

  it('não parte palavra que apenas contém o nome', () => {
    const p = criarPseudonimizador('Ana Lima');
    // "Analista" começa com "Ana"; trocar ali destruiria o texto.
    expect(p.aplicar('Ana Lima é analista sênior')).toBe(
      '[CANDIDATO] é analista sênior',
    );
  });

  it('não trata partículas como identificador', () => {
    const p = criarPseudonimizador('Pedro de Souza');
    const saida = p.aplicar('o carro de Pedro');
    // "de" sozinho não pode virar token — quebraria a frase inteira.
    expect(saida).toBe('o carro de [CANDIDATO_1]');
  });

  it('fica inerte sem nome utilizável', () => {
    for (const nome of [null, undefined, '', '  ', 'Jo']) {
      const p = criarPseudonimizador(nome);
      expect(p.ativo).toBe(false);
      expect(p.aplicar('texto qualquer')).toBe('texto qualquer');
      expect(p.restaurar('texto qualquer')).toBe('texto qualquer');
    }
  });

  it('é estável entre chamadas (regex /g reusada não pula ocorrências)', () => {
    const p = criarPseudonimizador('Carlos Dias');
    const primeira = p.aplicar('Carlos Dias falou');
    const segunda = p.aplicar('Carlos Dias falou');

    expect(segunda).toBe(primeira);
  });
});
