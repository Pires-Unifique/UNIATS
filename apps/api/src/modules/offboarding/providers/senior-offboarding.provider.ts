import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OffboardingSeniorSnapshot } from '@uniats/shared';

/**
 * Conector com o SENIOR (RH) para o OFFBOARDING. NÃO há API — a integração real
 * é uma conexão DIRETA a uma VIEW do banco do Senior (read-only) via
 * SENIOR_DATABASE_URL, igual ao módulo de Alteração Contratual.
 *
 * Aqui buscamos os DADOS DEMISSIONAIS do colaborador (o "snapshot" grande que
 * alimenta o termo e as etapas) e os CONTATOS PESSOAIS (e-mail/WhatsApp).
 *
 * Plugável via SENIOR_PROVIDER:
 *  - "senior"       → consulta a view (TODO: montar o client `pg` e as queries);
 *  - "desabilitado" → modo SIMULADO: devolve um snapshot plausível derivado do
 *                     que já temos do colaborador (permite exercitar o fluxo sem
 *                     o Senior conectado — que só liga depois da homologação).
 *
 * Atenção (rede Unifique): se a view estiver atrás de TLS, lembrar do
 * NODE_EXTRA_CA_CERTS (ver memória "TLS Netskope & Node").
 */

/** Dica vinda do espelho local p/ enriquecer o snapshot simulado. */
export interface DadosDemissionaisInput {
  matricula: string;
  nome?: string | null;
  unidade?: string | null;
  centro_custo?: string | null;
  cargo?: string | null;
  email_corporativo?: string | null;
  lider_nome?: string | null;
  // Contatos pessoais já conhecidos (do espelho/CSV) — NÃO fabricamos: o Senior
  // real os trará; até lá, refletem o que temos (e podem ser editados na UI).
  email_pessoal?: string | null;
  whatsapp_pessoal?: string | null;
}

export interface DadosDemissionaisResult {
  simulado: boolean;
  snapshot: OffboardingSeniorSnapshot;
}

export interface ContatosPessoaisResult {
  simulado: boolean;
  email_pessoal: string | null;
  whatsapp_pessoal: string | null;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

@Injectable()
export class SeniorOffboardingProvider {
  readonly nome = 'senior';
  private readonly logger = new Logger(SeniorOffboardingProvider.name);
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

  /** Dados demissionais completos (o "snapshot" que congela na solicitação). */
  async obterDadosDemissionais(
    input: DadosDemissionaisInput,
  ): Promise<DadosDemissionaisResult> {
    if (!this.habilitado()) {
      this.logger.warn(
        `SENIOR_PROVIDER desabilitado — dados demissionais SIMULADOS p/ matrícula ${input.matricula}.`,
      );
      return { simulado: true, snapshot: this.snapshotSimulado(input) };
    }
    // TODO(view Senior): SELECT na view demissional → OffboardingSeniorSnapshot.
    throw new Error(
      'SeniorOffboardingProvider.obterDadosDemissionais: query na view ainda não implementada.',
    );
  }

  /** Contatos pessoais (para validar — "verificar"). */
  async obterContatosPessoais(
    matricula: string,
  ): Promise<ContatosPessoaisResult> {
    if (!this.habilitado()) {
      // Sem Senior real, NÃO inventamos contato pessoal — o service preenche a
      // partir do espelho (dados do CSV/Senior que já temos). Ver OffboardingService.
      this.logger.warn(
        `SENIOR_PROVIDER desabilitado — contatos pessoais virão do espelho (sem Senior real) p/ matrícula ${matricula}.`,
      );
      return { simulado: true, email_pessoal: null, whatsapp_pessoal: null };
    }
    // TODO(view Senior): SELECT dos contatos pessoais.
    throw new Error(
      'SeniorOffboardingProvider.obterContatosPessoais: query na view ainda não implementada.',
    );
  }

  /**
   * Monta um snapshot plausível a partir do pouco que sabemos do colaborador.
   * Datas derivam de "hoje" só para a demonstração — NÃO são dados reais.
   */
  private snapshotSimulado(
    input: DadosDemissionaisInput,
  ): OffboardingSeniorSnapshot {
    const hoje = new Date();
    return {
      nome_completo: input.nome ?? null,
      filial: input.unidade ?? null,
      centro_custo: input.centro_custo ?? null,
      data_admissao: toDateStr(addDias(hoje, -730)), // ~2 anos atrás
      data_termino_cumprimento: toDateStr(addDias(hoje, 30)),
      prazo_homologacao: toDateStr(addDias(hoje, 10)),
      pagamento_ate_dia: toDateStr(addDias(hoje, 10)),
      agendamento_homologacao: null,
      agendamento_exame_demissional: null,
      // Contatos: refletem o que já temos (espelho/CSV) — sem inventar.
      email_pessoal: input.email_pessoal ?? null,
      whatsapp_pessoal: input.whatsapp_pessoal ?? null,
      possui_ferias: false,
      possui_cargo_lideranca: false,
      possui_procuracao: false,
      efetua_registro_ponto: true,
      presencial_ou_home: 'Presencial',
      data_ultimo_aso: toDateStr(addDias(hoje, -200)),
      lideranca_imediata: input.lider_nome ?? null,
      transferido_de_unidade: false,
      atestado: null,
      afastamentos: null,
      pcd: false,
      reabilitado: false,
      estabilidades: null,
      menor: false,
      cargo: input.cargo ?? null,
      cpf: null,
      email_corporativo: input.email_corporativo ?? null,
      escala_trabalho: '5x2 (segunda a sexta)',
      situacao_atual: 'Trabalhando',
    };
  }
}
