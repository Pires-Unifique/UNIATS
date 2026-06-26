import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Conector com o AUTENTIQUE (assinatura eletrônica do TERMO de desligamento).
 * Assinam o COLABORADOR (desligado) e o REPRESENTANTE_EMPRESA (pessoa do DHO na
 * via digital, ou um procurador na via física).
 *
 * Plugável via AUTENTIQUE_PROVIDER:
 *  - "autentique"   → integra de verdade (TODO: preencher a chamada GraphQL real);
 *  - "desabilitado" → modo SIMULADO: devolve um id/links fake e loga (permite
 *                     exercitar o fluxo de assinatura sem a ferramenta externa).
 */

export interface SignatarioOffboardingInput {
  papel: 'COLABORADOR' | 'REPRESENTANTE_EMPRESA';
  nome: string;
  email: string;
}

export interface EnviarAssinaturaOffboardingInput {
  solicitacaoId: string;
  titulo: string;
  /** HTML do termo a assinar (gerado pelo service). */
  conteudo: string;
  signatarios: SignatarioOffboardingInput[];
}

export interface SignatarioOffboardingResult {
  papel: 'COLABORADOR' | 'REPRESENTANTE_EMPRESA';
  email: string;
  /** id do signatário no Autentique (liga o webhook ao registro). */
  autentiqueSignatarioId?: string | null;
  linkAssinatura?: string | null;
}

export interface EnviarAssinaturaOffboardingResult {
  simulado: boolean;
  documentoId: string;
  signatarios: SignatarioOffboardingResult[];
  payloadEnviado: unknown;
  resposta: unknown;
}

@Injectable()
export class AutentiqueOffboardingProvider {
  readonly nome = 'autentique';
  private readonly logger = new Logger(AutentiqueOffboardingProvider.name);
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.provider =
      this.config.get<string>('AUTENTIQUE_PROVIDER') ?? 'desabilitado';
  }

  habilitado(): boolean {
    return this.provider === 'autentique';
  }

  async enviarParaAssinatura(
    input: EnviarAssinaturaOffboardingInput,
  ): Promise<EnviarAssinaturaOffboardingResult> {
    if (!this.habilitado()) {
      // Modo SIMULADO — gera ids/links fake determinísticos por solicitação.
      this.logger.warn(
        `AUTENTIQUE_PROVIDER=desabilitado — envio SIMULADO do termo da solicitação ` +
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
    // signatários (colaborador + representante) e devolver os ids/links.
    // Token: AUTENTIQUE_API_TOKEN.
    throw new Error(
      'AutentiqueOffboardingProvider.enviarParaAssinatura: integração real ainda não implementada.',
    );
  }
}
