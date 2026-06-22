/**
 * Contrato do "gatilho de saída" que solicita a criação do usuário de AD a uma
 * ferramenta externa. Hoje implementado pelo Acelerato (abertura de chamado);
 * o desenho é plugável para apontar a um segundo sistema no futuro sem mudar o
 * fluxo de admissão.
 */

export interface AbrirSolicitacaoInput {
  admissaoId: string;
  /** Nome completo conforme o RG (preferencial) ou cadastro (fallback). */
  nomeCompleto: string;
  /** De onde veio o nome — para a equipe saber o quanto confiar. */
  fonteNome: 'rg-ocr' | 'cadastro';
  cpf?: string;
  vagaTitulo?: string | null;
  cargo?: string | null;
  rgNumero?: string;
  orgaoEmissor?: string;
  /** Confiança do OCR ('alta' | 'media' | 'baixa'), quando houver. */
  confiancaOcr?: string;
  /** Link do painel de admissão para conferência humana. */
  linkPainel?: string | null;
}

export interface AbrirSolicitacaoResult {
  /** Identificador do chamado/ticket na ferramenta externa (ex.: ticketKey). */
  refExterna: string;
  /** Link direto do chamado, se a ferramenta devolver. */
  url: string | null;
  /** Payload bruto enviado (auditoria). */
  payloadEnviado: unknown;
  /** Resposta bruta recebida (auditoria). */
  resposta: unknown;
}

export interface AcessoProvider {
  /** Identificador curto do provider (gravado em SolicitacaoAcesso.provider). */
  readonly nome: string;
  abrirSolicitacao(input: AbrirSolicitacaoInput): Promise<AbrirSolicitacaoResult>;
}
