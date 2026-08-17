import {
  prepararCurriculoParaIA,
  REDACAO_CV_VERSAO,
} from '../curriculo-para-ia.js';

/**
 * Esta é a barreira que impede o vazamento de voltar. Cada teste aqui descreve
 * um jeito de o dado sensível escapar para Voyage/Claude.
 */

const EXPERIENCIA_SENSIVEL = {
  empresa: 'Sindicato dos Metalúrgicos',
  cargo: 'Analista',
  inicio: '2020-01',
  fim: '2022-06',
  descricao: 'Afastado por tratamento de saúde em 2021; atuei na pastoral.',
};

const CV_SEM_ESPELHO = {
  resumo: 'Militante sindical e voluntário na igreja.',
  experiencias: [EXPERIENCIA_SENSIVEL],
  competencias: ['Excel', 'SAP'],
  formacoes: [{ curso: 'Administração' }],
  idiomas: [{ idioma: 'Inglês', nivel: 'avançado' }],
  certificacoes: [],
  anos_experiencia: 2.5,
  texto_normalizado: 'Afastado por tratamento de saúde em 2021.',
  ia_redacao_versao: null,
};

describe('prepararCurriculoParaIA — sem espelho censurado', () => {
  it('NÃO deixa passar descrição, resumo nem trecho literal', () => {
    const r = prepararCurriculoParaIA(CV_SEM_ESPELHO);

    expect(r.completo).toBe(false);
    expect(r.resumo).toBeNull();
    expect(r.textoLiteral).toBe('');
    expect(r.experiencias[0]).not.toHaveProperty('descricao');

    // Rede de segurança: nada do texto sensível pode aparecer em lugar nenhum
    // da saída, por qualquer caminho.
    const serializado = JSON.stringify(r).toLowerCase();
    for (const termo of ['saúde', 'saude', 'pastoral', 'igreja', 'militante']) {
      expect(serializado).not.toContain(termo);
    }
  });

  it('preserva o histórico profissional — o ranking degrada, não quebra', () => {
    const r = prepararCurriculoParaIA(CV_SEM_ESPELHO);

    expect(r.experiencias[0]).toMatchObject({
      empresa: 'Sindicato dos Metalúrgicos',
      cargo: 'Analista',
      inicio: '2020-01',
      fim: '2022-06',
    });
    expect(r.competencias).toEqual(['Excel', 'SAP']);
    expect(r.anos_experiencia).toBe(2.5);
    expect(r.formacoes).toEqual([{ curso: 'Administração' }]);
  });

  it('aguenta currículo vazio ou com campos ausentes', () => {
    const r = prepararCurriculoParaIA({});
    expect(r.experiencias).toEqual([]);
    expect(r.competencias).toEqual([]);
    expect(r.textoLiteral).toBe('');
    expect(r.completo).toBe(false);
  });

  it('aguenta experiencias em formato inesperado (Json solto do banco)', () => {
    for (const lixo of [null, undefined, 'texto', 42, { nao: 'array' }]) {
      const r = prepararCurriculoParaIA({ experiencias: lixo });
      expect(r.experiencias).toEqual([]);
    }
  });
});

describe('prepararCurriculoParaIA — com espelho censurado', () => {
  const CV_COM_ESPELHO = {
    ...CV_SEM_ESPELHO,
    ia_redacao_versao: REDACAO_CV_VERSAO,
    ia_resumo: 'Profissional com atuação em [OCULTADO: filiação sindical].',
    ia_experiencias: [
      {
        empresa: 'Sindicato dos Metalúrgicos',
        cargo: 'Analista',
        inicio: '2020-01',
        fim: '2022-06',
        descricao: 'Afastado por [OCULTADO: saúde] em 2021.',
      },
    ],
    ia_texto: 'Afastado por [OCULTADO: saúde] em 2021.',
  };

  it('usa o texto censurado, não o original', () => {
    const r = prepararCurriculoParaIA(CV_COM_ESPELHO);

    expect(r.completo).toBe(true);
    expect(r.resumo).toContain('[OCULTADO:');
    expect(r.textoLiteral).toContain('[OCULTADO:');
    expect((r.experiencias[0] as { descricao: string }).descricao).toContain(
      '[OCULTADO:',
    );

    const serializado = JSON.stringify(r).toLowerCase();
    expect(serializado).not.toContain('tratamento de saúde');
    expect(serializado).not.toContain('pastoral');
  });

  it('espelho de versão ANTIGA é tratado como ausente', () => {
    // O prompt mudou: o texto guardado pode não cobrir o que a versão nova pega.
    const r = prepararCurriculoParaIA({
      ...CV_COM_ESPELHO,
      ia_redacao_versao: 'redacao-cv-v0',
    });

    expect(r.completo).toBe(false);
    expect(r.resumo).toBeNull();
    expect(r.textoLiteral).toBe('');
    expect(r.experiencias[0]).not.toHaveProperty('descricao');
  });
});
