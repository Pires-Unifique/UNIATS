import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TemplateParser } from '../template-parser.js';

const fixture = (nome: string) =>
  readFileSync(join(__dirname, 'fixtures', nome));

describe('TemplateParser.parseXlsx', () => {
  it('extrai o template de IA Júnior (origem Google Sheets / inline)', async () => {
    const r = await TemplateParser.parseXlsx(fixture('ia_junior.xlsx'));

    expect(r.titulo).toMatch(/ANALISTA DE SOLU/i);
    expect(r.titulo).toMatch(/J[ÚU]NIOR/i);
    expect(r.departamentoNome).toMatch(/Centro de Excel/i);
    expect(r.missao).toMatch(/Intelig[êe]ncia Artificial/i);
    expect(r.formacaoMinima).toMatch(/Ensino Superior/i);
    expect(r.formacaoIdeal).toMatch(/Ensino Superior/i);
    expect(r.conhecimentos.length).toBeGreaterThanOrEqual(3);
    expect(r.responsabilidades.length).toBeGreaterThanOrEqual(5);
    expect(r.autonomiaNivel).toBe('JR');
    expect(r.autonomiaParagrafos.length).toBeGreaterThanOrEqual(3);
  });

  it('detecta nível PL e SR pelos respectivos arquivos', async () => {
    const pl = await TemplateParser.parseXlsx(fixture('ia_pleno.xlsx'));
    const sr = await TemplateParser.parseXlsx(fixture('ia_senior.xlsx'));
    expect(pl.autonomiaNivel).toBe('PL');
    expect(sr.autonomiaNivel).toBe('SR');
  });

  it('extrai o template de Coordenador (origem Excel / sharedStrings)', async () => {
    const r = await TemplateParser.parseXlsx(fixture('coordenador.xlsx'));

    expect(r.titulo).toMatch(/COORDENADOR DE ATENDIMENTO/i);
    expect(r.departamentoNome).toMatch(/^TI$/i);
    expect(r.missao).toMatch(/atendimento e suporte/i);
    expect(r.formacaoMinima).toMatch(/Ensino Superior/i);
    expect(r.conhecimentos.length).toBeGreaterThanOrEqual(3);
    expect(r.responsabilidades.length).toBeGreaterThanOrEqual(8);
  });

  it('não lança e devolve avisos quando o buffer não é um template', async () => {
    const r = await TemplateParser.parseXlsx(Buffer.from('not-an-xlsx'));
    expect(Array.isArray(r.avisos)).toBe(true);
  }, 10000);
});
