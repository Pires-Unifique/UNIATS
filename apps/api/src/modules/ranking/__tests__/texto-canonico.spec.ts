import {
  montarTextoCanonicoCurriculo,
  montarTextoCanonicoVaga,
} from '../services/texto-canonico.js';

describe('texto-canonico', () => {
  describe('montarTextoCanonicoVaga', () => {
    it('inclui título, departamento, localização e requisitos do gestor', () => {
      const txt = montarTextoCanonicoVaga({
        titulo: 'Engenheiro de Software Sênior',
        departamento: 'Tecnologia',
        cidade: 'Timbó',
        estado: 'SC',
        remoto: true,
        tipo_contrato: 'CLT',
        descricao: 'Construir produtos B2B.',
        requisitos_json: {
          experiencia: '5+ anos com Node.js',
          ingles: 'avançado',
        },
      });
      expect(txt).toContain('Engenheiro de Software Sênior');
      expect(txt).toContain('Departamento: Tecnologia');
      expect(txt).toContain('Timbó / SC / remoto');
      expect(txt).toContain('5+ anos com Node.js');
      expect(txt).toContain('ingles: avançado');
    });

    it('duplica os requisitos do gestor para aumentar peso no embedding', () => {
      const txt = montarTextoCanonicoVaga({
        titulo: 'X',
        requisitos_json: { foo: 'bar' },
      });
      const matches = txt.match(/foo: bar/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('aceita array de {label, value}', () => {
      const txt = montarTextoCanonicoVaga({
        titulo: 'Dev',
        requisitos_json: [
          { label: 'Linguagem', value: 'TypeScript' },
          { label: 'Cloud', value: 'AWS' },
        ],
      });
      expect(txt).toContain('Linguagem: TypeScript');
      expect(txt).toContain('Cloud: AWS');
    });

    it('omite seção de requisitos quando JSON vazio', () => {
      const txt = montarTextoCanonicoVaga({
        titulo: 'Dev',
        requisitos_json: {},
      });
      expect(txt).not.toContain('Requisitos definidos pelo gestor');
    });
  });

  describe('montarTextoCanonicoCurriculo', () => {
    it('agrega resumo, competências, experiências e formação', () => {
      const txt = montarTextoCanonicoCurriculo({
        resumo: 'Dev backend Node há 8 anos.',
        estruturado: {
          experiencias: [
            {
              cargo: 'Dev Sr',
              empresa: 'Unifique',
              inicio: '2020-01',
              fim: 'atual',
              tecnologias: ['TypeScript', 'PostgreSQL'],
            },
          ],
          formacoes: [
            {
              curso: 'Sistemas de Informação',
              instituicao: 'UFSC',
              nivel: 'graduacao',
            },
          ],
          competencias: ['Node.js', 'TypeScript', 'Node.js'],
          idiomas: [{ idioma: 'Inglês', nivel: 'avancado' }],
          certificacoes: [{ nome: 'AWS SAA', ano: '2022' }],
          anos_experiencia: 8,
        },
      });
      expect(txt).toContain('Resumo: Dev backend Node há 8 anos.');
      expect(txt).toContain('Anos de experiência: 8');
      expect(txt).toContain('Dev Sr @ Unifique (2020-01 – atual)');
      expect(txt).toContain('TypeScript, PostgreSQL');
      expect(txt).toContain('UFSC');
      expect(txt).toContain('Inglês (avancado)');
      expect(txt).toContain('AWS SAA (2022)');
    });

    it('deduplica competências', () => {
      const txt = montarTextoCanonicoCurriculo({
        estruturado: {
          experiencias: [],
          formacoes: [],
          competencias: ['Node', 'Node', 'TypeScript'],
          idiomas: [],
          certificacoes: [],
        },
      });
      const matches = txt.match(/Node(?!\.)/g) ?? [];
      expect(matches.length).toBe(1);
    });
  });
});
