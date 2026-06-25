import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { gerarPdfSimples } from '../pdf.js';

/**
 * Conector com o AUTENTIQUE (assinatura eletrônica do documento de alteração).
 * Assinam o GESTOR do colaborador (ou o NOVO líder, em troca de liderança) e
 * alguém do DHO. O colaborador NÃO assina.
 *
 * Plugável via AUTENTIQUE_PROVIDER:
 *  - "autentique"   → integração REAL: gera um PDF e cria o documento via API
 *                     GraphQL (mutation createDocument, multipart). Token em
 *                     AUTENTIQUE_API_TOKEN (painel → API keys).
 *  - "desabilitado" → modo SIMULADO: devolve ids/links fake e loga.
 *
 * Doc: https://docs.autentique.com.br/api (auth Bearer; rate limit 60 req/min).
 * Atenção (rede Unifique): a chamada externa exige NODE_EXTRA_CA_CERTS, senão dá
 * SELF_SIGNED_CERT_IN_CHAIN (ver memória "TLS Netskope & Node").
 */

export interface SignatarioInput {
  papel: 'GESTOR' | 'DHO';
  nome: string;
  email: string;
}

export interface EnviarAssinaturaInput {
  solicitacaoId: string;
  titulo: string;
  /** Texto do documento (uma linha por \n) — vira o PDF assinável. */
  conteudo: string;
  signatarios: SignatarioInput[];
}

export interface SignatarioResult {
  papel: 'GESTOR' | 'DHO';
  email: string;
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

const MUTATION_CRIAR_DOCUMENTO = `
mutation CriarDocumento($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
  createDocument(document: $document, signers: $signers, file: $file) {
    id
    name
    signatures { public_id email link { short_link } }
  }
}`;

@Injectable()
export class AutentiqueProvider {
  readonly nome = 'autentique';
  private readonly logger = new Logger(AutentiqueProvider.name);
  private readonly provider: string;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeout: number;

  constructor(private readonly config: ConfigService) {
    this.provider =
      this.config.get<string>('AUTENTIQUE_PROVIDER') ?? 'desabilitado';
    this.baseUrl =
      this.config.get<string>('AUTENTIQUE_API_BASE_URL') ??
      'https://api.autentique.com.br/v2/graphql';
    this.token = this.config.get<string>('AUTENTIQUE_API_TOKEN');
    this.timeout = this.config.get<number>('AUTENTIQUE_TIMEOUT_MS') ?? 20_000;
  }

  habilitado(): boolean {
    return this.provider === 'autentique';
  }

  async enviarParaAssinatura(
    input: EnviarAssinaturaInput,
  ): Promise<EnviarAssinaturaResult> {
    if (!this.habilitado()) {
      // Modo SIMULADO — ids/links fake determinísticos por solicitação.
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

    if (!this.token) {
      throw new Error('AUTENTIQUE_API_TOKEN ausente (necessário com AUTENTIQUE_PROVIDER=autentique).');
    }
    const semEmail = input.signatarios.filter((s) => !s.email?.trim());
    if (semEmail.length > 0) {
      throw new Error(
        `Signatário(s) sem e-mail: ${semEmail.map((s) => s.papel).join(', ')}. ` +
          'Informe o e-mail do gestor ao aprovar.',
      );
    }

    const pdf = gerarPdfSimples(input.titulo, input.conteudo.split('\n'));
    const variables = {
      document: { name: input.titulo },
      signers: input.signatarios.map((s) => ({ email: s.email, action: 'SIGN' })),
      file: null,
    };

    // GraphQL Multipart Request Spec: operations + map + arquivo na chave "0".
    const form = new FormData();
    form.append(
      'operations',
      JSON.stringify({ query: MUTATION_CRIAR_DOCUMENTO, variables }),
    );
    form.append('map', JSON.stringify({ '0': ['variables.file'] }));
    form.append(
      '0',
      new Blob([pdf], { type: 'application/pdf' }),
      `alteracao-contratual-${input.solicitacaoId}.pdf`,
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeout);
    let json: {
      data?: {
        createDocument?: {
          id: string;
          signatures?: Array<{
            public_id?: string;
            email?: string;
            link?: { short_link?: string };
          }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };
    try {
      const resp = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
        signal: ctrl.signal,
      });
      const texto = await resp.text();
      try {
        json = JSON.parse(texto);
      } catch {
        throw new Error(`Autentique respondeu não-JSON (HTTP ${resp.status}): ${texto.slice(0, 200)}`);
      }
      if (!resp.ok) {
        throw new Error(`Autentique HTTP ${resp.status}: ${texto.slice(0, 300)}`);
      }
    } finally {
      clearTimeout(timer);
    }

    if (json.errors?.length) {
      throw new Error(`Autentique: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    const doc = json.data?.createDocument;
    if (!doc?.id) {
      throw new Error('Autentique: resposta sem createDocument.id.');
    }

    const porEmail = new Map(
      (doc.signatures ?? []).map((s) => [(s.email ?? '').toLowerCase(), s]),
    );
    const signatarios: SignatarioResult[] = input.signatarios.map((s) => {
      const m = porEmail.get(s.email.toLowerCase());
      return {
        papel: s.papel,
        email: s.email,
        autentiqueSignatarioId: m?.public_id ?? null,
        linkAssinatura: m?.link?.short_link ?? null,
      };
    });

    this.logger.log(
      `Documento Autentique criado (solicitação ${input.solicitacaoId}, doc=${doc.id}).`,
    );
    return {
      simulado: false,
      documentoId: doc.id,
      signatarios,
      payloadEnviado: { document: variables.document, signers: variables.signers },
      resposta: doc,
    };
  }
}
