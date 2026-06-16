import { parseVtt } from '../vtt.parser.js';

describe('parseVtt', () => {
  it('extrai falante, tempos e texto do formato Teams', () => {
    const vtt = [
      'WEBVTT',
      '',
      '0001-0001',
      '00:00:01.234 --> 00:00:05.678',
      '<v Guilherme Viana>Olá, tudo bem?</v>',
      '',
      '0002-0002',
      '00:00:06.000 --> 00:00:09.500',
      '<v Maria Souza>Tudo sim, e você?</v>',
    ].join('\n');

    const out = parseVtt(vtt);
    expect(out.segmentos).toHaveLength(2);
    expect(out.segmentos[0]).toMatchObject({
      falante: 'Guilherme Viana',
      texto: 'Olá, tudo bem?',
      inicio_ms: 1234,
      fim_ms: 5678,
    });
    expect(out.segmentos[1].falante).toBe('Maria Souza');
    expect(out.texto).toBe(
      'Guilherme Viana: Olá, tudo bem?\nMaria Souza: Tudo sim, e você?',
    );
  });

  it('lida com cue sem identificador e sem tag de voz', () => {
    const vtt = ['WEBVTT', '', '00:01.000 --> 00:03.000', 'Texto solto aqui'].join(
      '\n',
    );
    const out = parseVtt(vtt);
    expect(out.segmentos).toHaveLength(1);
    expect(out.segmentos[0].texto).toBe('Texto solto aqui');
    expect(out.segmentos[0].falante).toBeUndefined();
    expect(out.segmentos[0].inicio_ms).toBe(1000);
  });

  it('ignora blocos NOTE/header e VTT vazio', () => {
    expect(parseVtt('WEBVTT\n\nNOTE algo aqui').segmentos).toHaveLength(0);
    expect(parseVtt('').segmentos).toHaveLength(0);
  });
});
