import { marcador, MARCADOR_REGEX, redigirRegex } from '../redacao.regex.js';

describe('redigirRegex (Camada 1 — determinística)', () => {
  it('oculta e-mail preservando o resto da frase', () => {
    const { texto, categorias } = redigirRegex(
      'Meu contato é joao.silva@empresa.com.br, pode chamar.',
    );
    expect(texto).toBe(`Meu contato é ${marcador('E-MAIL')}, pode chamar.`);
    expect(categorias).toContain('E-MAIL');
  });

  it('oculta CPF formatado e não formatado (ancorado)', () => {
    expect(redigirRegex('CPF 123.456.789-00').texto).toContain(
      marcador('CPF'),
    );
    expect(redigirRegex('meu CPF é 12345678900 ok').texto).toBe(
      `meu CPF é ${marcador('CPF')} ok`,
    );
  });

  it('oculta cartão de crédito em 4 grupos de 4', () => {
    expect(redigirRegex('cartão 4111 1111 1111 1111').texto).toContain(
      marcador('CARTÃO'),
    );
  });

  it('oculta telefone (parênteses, celular e ancorado)', () => {
    expect(redigirRegex('ligue (47) 99999-8888').texto).toContain(
      marcador('TELEFONE'),
    );
    expect(redigirRegex('meu whatsapp é 47988887777').texto).toContain(
      marcador('TELEFONE'),
    );
  });

  it('oculta CEP com hífen mas preserva o logradouro', () => {
    const { texto } = redigirRegex('moro na rua X, CEP 89000-000');
    expect(texto).toBe(`moro na rua X, CEP ${marcador('CEP')}`);
  });

  it('oculta data de nascimento ancorada, sem tocar em datas gerais', () => {
    expect(redigirRegex('nascimento 10/05/1990').texto).toContain(
      marcador('DATA DE NASCIMENTO'),
    );
    // Datas gerais (contexto de trabalho) NÃO são ocultadas.
    const geral = 'trabalhei de 2019 a 2024 na empresa';
    expect(redigirRegex(geral).texto).toBe(geral);
  });

  it('não altera texto sem dados estruturados', () => {
    const t = 'Tenho 8 anos de experiência em Node e liderança de equipe.';
    const { texto, categorias } = redigirRegex(t);
    expect(texto).toBe(t);
    expect(categorias).toHaveLength(0);
  });

  it('MARCADOR_REGEX detecta os marcadores gerados', () => {
    const t = redigirRegex('email a@b.com e cartão 4111 1111 1111 1111').texto;
    const achados = t.match(MARCADOR_REGEX) ?? [];
    expect(achados.length).toBe(2);
  });
});
