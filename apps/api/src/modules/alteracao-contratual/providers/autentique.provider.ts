import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Conector com o AUTENTIQUE (assinatura eletrônica do documento de alteração).
 * Assinam o GESTOR do colaborador (ou o NOVO líder, em troca de liderança) e
 * alguém do DHO. O colaborador NÃO assina.
 *
 * Plugável via AUTENTIQUE_PROVIDER:
 *  - "autentique"   → integra de verdade (TODO: preencher a chamada GraphQL real);
 *  - "desabilitado" → modo SIMULADO: devolve um id/links fake e loga (permite
 *                     exercitar o fluxo de assinatura sem a ferramenta externa).
 */

export interface SignatarioInput {
  papel: 'GESTOR' | 'DHO';
  nome: string;
  email: string;
}

export interface EnviarAssinaturaInput {
  solicitacaoId: string;
  titulo: string;
  /** HTML/markdown do documento a assinar (gerado pelo service). */
  conteudo: string;
  signatarios: SignatarioInput[];
}

export interface SignatarioResult {
  papel: 'GESTOR' | 'DHO';
  email: string;
  /** id do signatário no Autentique (liga o webhook ao registro). */
  autentiqueSignatarioId?: string | null;
  linkAssinatura?: string | null;
}

export interface EnviarAssinaturaResult {
  simulado: boolean;
  documentoId: string;
  signatarios: SignatarioResult[];
  payloadEnviado: unknown;
  resposta: unknown;
}

@Injectable()
export class AutentiqueProvider {
  readonly nome = 'autentique';
  private readonly logger = new Logger(AutentiqueProvider.name);
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.provider =
      this.config.get<string>('AUTENTIQUE_PROVIDER') ?? 'desabilitado';
  }

  habilitado(): boolean {
    return this.provider === 'autentique';
  }

  async enviarParaAssinatura(
    input: EnviarAssinaturaInput,
  ): Promise<EnviarAssinaturaResult> {
    if (!this.habilitado()) {
      // Modo SIMULADO — gera ids/links fake determinísticos por solicitação.
      this.logger.warn(
        `AUTENTIQUE_PROVIDER=desabilitado — envio SIMULADO da solicitação ` +
          `${input.solicitacaoId} (${input.signatarios.length} signatário(s)).`,
      );
      const documentoId = `simulado-${input.solicitacaoId}`;
      return {
        simulado: true,
        documentoId,
        signatarios: input.signatarios.map((s) => ({
          papel: s.papel,
          email: s.email,
          autentiqueSignatarioId: `simulado-${input.solicitacaoId}-${s.papel}`,
          linkAssinatura: null,
        })),
        payloadEnviado: input,
        resposta: { simulado: true, documentoId },
      };
    }
    // TODO(integração Autentique): criar o documento via API GraphQL, anexar os
    // signatários (gestor + DHO) e devolver os ids/links. Token: AUTENTIQUE_API_TOKEN.
    throw new Error(
      'AutentiqueProvider.enviarParaAssinatura: integração real ainda não implementada.',
    );
  }
}
