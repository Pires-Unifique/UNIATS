import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Executa as INTEGRAÇÕES das etapas de encerramento do offboarding:
 *  - ACESSO_TI       → remoção de acessos (abertura de chamado no Acelerato p/ o TI);
 *  - BENEFICIOS      → exclusão de benefícios (endpoints a definir com as áreas);
 *  - PONTO_FECHAMENTO→ solicitar fechamento do ponto.
 *
 * NESTA FASE tudo roda em MODO SIMULADO — nenhuma chamada externa é feita (o
 * usuário pediu para NÃO abrir chamado ainda). Cada integração tem um TODO claro
 * de onde plugar a chamada real. O padrão de provider plugável já existe no
 * módulo de Acesso (`ACESSO_PROVIDER` / `AceleratoProvider`) e pode ser reusado
 * para o ACESSO_TI quando for ligar.
 */

export interface ResultadoIntegracao {
  ok: boolean;
  simulado: boolean;
  observacao: string;
  payload: unknown;
}

@Injectable()
export class EncerramentoConectorService {
  private readonly logger = new Logger(EncerramentoConectorService.name);

  constructor(private readonly config: ConfigService) {}

  private get simulado(): boolean {
    // Por ora SEMPRE simulado (gated p/ ligar integração por integração depois).
    return (this.config.get<string>('OFFBOARDING_INTEGRACOES') ?? 'simulado') !==
      'real';
  }

  /**
   * Executa a integração de uma chave INTEGRACAO. Em modo simulado, loga e
   * devolve sucesso com um payload fake. Lança em erro real (o service grava FALHA).
   */
  async executar(
    chave: string,
    ctx: { solicitacaoId: string; matricula: string; colaboradorNome: string },
  ): Promise<ResultadoIntegracao> {
    if (this.simulado) {
      const observacao = this.descricaoSimulada(chave);
      this.logger.warn(
        `OFFBOARDING_INTEGRACOES=simulado — "${chave}" SIMULADO p/ ${ctx.colaboradorNome} ` +
          `(matrícula ${ctx.matricula}, solicitação ${ctx.solicitacaoId}).`,
      );
      return {
        ok: true,
        simulado: true,
        observacao,
        payload: { chave, simulado: true, ...ctx },
      };
    }

    switch (chave) {
      case 'ACESSO_TI':
        // TODO(integração TI): abrir chamado de remoção de acessos no Acelerato
        // (reusar o padrão do AcessoProvider/AceleratoProvider do módulo Acesso).
        throw new Error('Integração ACESSO_TI real ainda não implementada.');
      case 'BENEFICIOS':
        // TODO(integração benefícios): endpoints a definir com a área de benefícios.
        throw new Error('Integração BENEFICIOS real ainda não implementada.');
      case 'PONTO_FECHAMENTO':
        // TODO(integração ponto): solicitar fechamento do ponto.
        throw new Error('Integração PONTO_FECHAMENTO real ainda não implementada.');
      default:
        throw new Error(`Integração desconhecida: ${chave}.`);
    }
  }

  private descricaoSimulada(chave: string): string {
    switch (chave) {
      case 'ACESSO_TI':
        return 'Solicitação de remoção de acessos enviada ao TI (SIMULADO).';
      case 'BENEFICIOS':
        return 'Exclusão de benefícios solicitada (SIMULADO).';
      case 'PONTO_FECHAMENTO':
        return 'Fechamento do ponto solicitado (SIMULADO).';
      default:
        return `Integração "${chave}" executada (SIMULADO).`;
    }
  }
}
