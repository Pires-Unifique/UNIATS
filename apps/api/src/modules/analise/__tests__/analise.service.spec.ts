import { AnaliseService } from '../analise.service.js';

describe('AnaliseService — helpers puros', () => {
  describe('taxa', () => {
    it('calcula a razão', () => {
      expect(AnaliseService.taxa(5, 20)).toBe(0.25);
    });

    it('retorna null quando o denominador é zero', () => {
      expect(AnaliseService.taxa(3, 0)).toBeNull();
    });

    it('retorna null quando o denominador é zero mesmo com numerador zero', () => {
      expect(AnaliseService.taxa(0, 0)).toBeNull();
    });
  });

  describe('montarFunil', () => {
    const counts = {
      inscritos: 100,
      triados: 60,
      entrevistaAgendada: 30,
      entrevistaRealizada: 24,
      aprovados: 10,
      contratados: 5,
    };

    it('monta as 6 etapas na ordem do funil', () => {
      const funil = AnaliseService.montarFunil(counts);
      expect(funil.map((e) => e.etapa)).toEqual([
        'INSCRITOS',
        'TRIADOS',
        'ENTREVISTA_AGENDADA',
        'ENTREVISTA_REALIZADA',
        'APROVADOS',
        'CONTRATADOS',
      ]);
    });

    it('a primeira etapa não tem taxa de conversão', () => {
      const funil = AnaliseService.montarFunil(counts);
      expect(funil[0].taxaConversao).toBeNull();
    });

    it('conversão de cada etapa é relativa à anterior', () => {
      const funil = AnaliseService.montarFunil(counts);
      expect(funil[1].taxaConversao).toBeCloseTo(0.6); // 60/100
      expect(funil[2].taxaConversao).toBeCloseTo(0.5); // 30/60
      expect(funil[5].taxaConversao).toBeCloseTo(0.5); // 5/10
    });

    it('lida com etapa anterior zerada sem dividir por zero', () => {
      const funil = AnaliseService.montarFunil({
        inscritos: 0,
        triados: 0,
        entrevistaAgendada: 0,
        entrevistaRealizada: 0,
        aprovados: 0,
        contratados: 0,
      });
      expect(funil.every((e) => e.total === 0)).toBe(true);
      expect(funil[1].taxaConversao).toBeNull();
    });
  });
});
