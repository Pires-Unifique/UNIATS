import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Conector com o SENIOR (RH). NÃO há API — a integração é uma conexão DIRETA a
 * uma VIEW do banco do Senior (read-only), via SENIOR_DATABASE_URL. Fonte de:
 *  - colaboradores (espelho local p/ busca rápida) — SEM salário (regra de negócio);
 *  - centros de custo;
 *  - filiais/unidades (o UNIIT não expõe unidades).
 *
 * A APLICAÇÃO da alteração (write-back na data exata) é SEPARADA: uma view é só
 * leitura, então `aplicarAlteracao` ainda não tem destino definido (procedure?
 * outra base? processo manual do DHO?). Fica como TODO + modo simulado.
 *
 * Plugável via SENIOR_PROVIDER:
 *  - "senior"       → conecta na view (TODO: montar o client `pg` e as queries);
 *  - "desabilitado" → sync devolve vazio e a aplicação é SIMULADA (loga e segue).
 *
 * Atenção (rede Unifique): se a view estiver atrás de TLS, lembrar do
 * NODE_EXTRA_CA_CERTS (ver memória "TLS Netskope & Node").
 */

/** Colaborador vindo da view do Senior (shape mínimo do espelho). */
export interface SeniorColaborador {
  matricula: string; // "Numcad" no Senior
  senior_id?: string | null;
  nome: string;
  email?: string | null;
  cpf_hash?: string | null;
  unidade_externo_id?: string | null; // casa com Unidade.externo_id no sync
  centro_custo_senior_id?: string | null;
  cargo_atual?: string | null;
  lider_matricula?: string | null;
  lider_nome?: string | null;
  ativo?: boolean;
}

export interface SeniorCentroCusto {
  senior_id: string;
  codigo?: string | null;
  nome: string;
  ativo?: boolean;
}

export interface SeniorUnidade {
  externo_id: string;
  codigo?: string | null;
  nome: string;
  cidade?: string | null;
  estado?: string | null;
  ativo?: boolean;
}

/** Uma alteração a aplicar (já resolvida pelo service a partir dos itens). */
export interface AplicarAlteracaoInput {
  solicitacaoId: string;
  matricula: string;
  dataAplicacao: string; // YYYY-MM-DD
  alteracoes: Array<{
    tipo: 'CARGO' | 'SALARIO' | 'CENTRO_CUSTO' | 'UNIDADE' | 'LIDER';
    de?: string | null;
    para: string;
  }>;
}

export interface AplicarAlteracaoResult {
  /** true quando NÃO houve write-back real (provider desabilitado). */
  simulado: boolean;
  payloadEnviado: unknown;
  resposta: unknown;
}

@Injectable()
export class SeniorProvider {
  readonly nome = 'senior';
  private readonly logger = new Logger(SeniorProvider.name);
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<string>('SENIOR_PROVIDER') ?? 'desabilitado';
  }

  habilitado(): boolean {
    return (
      this.provider === 'senior' &&
      !!this.config.get<string>('SENIOR_DATABASE_URL')
    );
  }

  async listarColaboradores(): Promise<SeniorColaborador[]> {
    if (!this.habilitado()) {
      this.logger.warn(
        'SENIOR_PROVIDER desabilitado/sem SENIOR_DATABASE_URL — sync de colaboradores não executado.',
      );
      return [];
    }
    // TODO(view Senior): SELECT na view de colaboradores → SeniorColaborador (sem salário).
    throw new Error('SeniorProvider.listarColaboradores: query na view ainda não implementada.');
  }

  async listarCentrosCusto(): Promise<SeniorCentroCusto[]> {
    if (!this.habilitado()) {
      this.logger.warn('SENIOR_PROVIDER desabilitado — sync de centros de custo não executado.');
      return [];
    }
    // TODO(view Senior): SELECT na view de centros de custo.
    throw new Error('SeniorProvider.listarCentrosCusto: query na view ainda não implementada.');
  }

  async listarUnidades(): Promise<SeniorUnidade[]> {
    if (!this.habilitado()) {
      this.logger.warn('SENIOR_PROVIDER desabilitado — sync de unidades/filiais não executado.');
      return [];
    }
    // TODO(view Senior): SELECT na view de filiais/unidades.
    throw new Error('SeniorProvider.listarUnidades: query na view ainda não implementada.');
  }

  /** Aplica a alteração no Senior na data exata. Gera log completo no service. */
  async aplicarAlteracao(input: AplicarAlteracaoInput): Promise<AplicarAlteracaoResult> {
    if (!this.habilitado()) {
      this.logger.warn(
        `SENIOR_PROVIDER desabilitado — aplicação SIMULADA da solicitação ${input.solicitacaoId} ` +
          `(matrícula ${input.matricula}, ${input.alteracoes.length} alteração(ões)).`,
      );
      return { simulado: true, payloadEnviado: input, resposta: { simulado: true } };
    }
    // TODO(write-back Senior): aplicar de fato (procedure/integração a definir —
    // a view é read-only). Em erro, lançar (o service grava FALHA_EXECUCAO).
    throw new Error('SeniorProvider.aplicarAlteracao: write-back ainda não implementado.');
  }
}
