/**
 * DTOs compartilhados entre backend (NestJS) e frontend (Next.js).
 *
 * Estes tipos espelham o shape que os controllers REST devolvem. Mantemos
 * em um pacote independente para que o frontend NÃO importe nada do
 * @uniats/db (evita carregar Prisma no navegador) e para que mudanças
 * de shape sejam visíveis em uma única alteração de arquivo.
 */

// ---------- Enums (strings literais, espelham Prisma) ----------

// Espelha exatamente o enum StatusCandidatura do Prisma (packages/db).
export type StatusCandidatura =
  | 'EM_ANALISE'
  | 'TRIAGEM_IA'
  | 'APROVADO_TRIAGEM'
  | 'ENTREVISTA_AGENDADA'
  | 'ENTREVISTA_REALIZADA'
  | 'APROVADO'
  | 'REPROVADO'
  | 'CONTRATADO'
  | 'DESISTENTE';

export type StatusVaga =
  | 'RASCUNHO'
  | 'APROVADA' // aprovada na Gupy, ainda não publicada
  | 'PUBLICADA'
  | 'PAUSADA'
  | 'ENCERRADA'
  | 'CANCELADA';

export type TipoScore =
  | 'SIMILARIDADE_VETORIAL'
  | 'RANKING_CV'
  | 'ENTREVISTA'
  | 'TOM_DE_VOZ'
  | 'CONSOLIDADO';

export type CanalMensagem = 'WHATSAPP' | 'EMAIL' | 'SMS';
export type StatusMensagem =
  | 'PENDENTE'
  | 'ENVIADO'
  | 'ENTREGUE'
  | 'LIDO'
  | 'RESPONDIDO'
  | 'FALHADO'
  | 'CANCELADO';
export type DirecaoMensagem = 'ENTRADA' | 'SAIDA';

export type StatusEntrevista =
  | 'AGENDADA'
  | 'EM_ANDAMENTO'
  | 'FINALIZADA'
  | 'CANCELADA'
  | 'NAO_COMPARECEU';

export type DificuldadePergunta = 'baixa' | 'media' | 'alta';

// ---------- Vaga ----------

export interface VagaDTO {
  id: string;
  gupy_id: string; // BigInt vira string em JSON
  codigo?: string | null;
  titulo: string;
  descricao?: string | null;
  departamento?: string | null;
  unidade?: string | null;
  cidade?: string | null;
  estado?: string | null;
  tipo_contrato?: string | null;
  remoto: boolean;
  status: StatusVaga;
  data_publicacao?: string | null; // ISO-8601
  data_fechamento?: string | null;
  requisitos_json?: unknown;
  requisitos_texto?: string | null;
  criado_em: string;
  atualizado_em: string;
}

// ---------- Candidato ----------

export interface CandidatoDTO {
  id: string;
  email?: string | null;
  telefone?: string | null;
  nome_completo: string;
  cidade?: string | null;
  estado?: string | null;
  linkedin_url?: string | null;
  consentimento_lgpd_em?: string | null;
  consentimento_gravacao_em?: string | null;
  excluido_em?: string | null;
}

// ---------- Currículo estruturado ----------

export interface ExperienciaDTO {
  cargo: string;
  empresa: string;
  inicio?: string;
  fim?: string;
  descricao?: string;
  tecnologias?: string[];
}

export interface FormacaoDTO {
  curso: string;
  instituicao: string;
  nivel?:
    | 'tecnico'
    | 'tecnologo'
    | 'graduacao'
    | 'pos-graduacao'
    | 'mba'
    | 'mestrado'
    | 'doutorado'
    | 'curso-livre'
    | 'outro';
  inicio?: string;
  fim?: string;
}

export interface IdiomaDTO {
  idioma: string;
  nivel?: 'basico' | 'intermediario' | 'avancado' | 'fluente' | 'nativo';
}

export interface CertificacaoDTO {
  nome: string;
  emissor?: string;
  ano?: string;
}

export interface CurriculoEstruturadoDTO {
  id: string;
  candidato_id: string;
  candidatura_id: string;
  arquivo_sha256?: string | null;
  resumo?: string | null;
  experiencias?: ExperienciaDTO[];
  formacoes?: FormacaoDTO[];
  competencias: string[];
  idiomas?: IdiomaDTO[];
  certificacoes?: CertificacaoDTO[];
  anos_experiencia?: number | null;
  parser_versao: string;
  processado_em: string;
  atualizado_em: string;
}

// ---------- Scores / Ranking ----------

export interface EvidenciaScoreDTO {
  eixo:
    | 'requisitos_gestor'
    | 'experiencia'
    | 'competencias'
    | 'formacao'
    | 'outros';
  trecho: string;
  impacto: 'positivo' | 'negativo' | 'neutro';
}

export interface ScoreDTO {
  tipo: TipoScore;
  valor: number;
  justificativa: string;
  evidencias?: {
    pontos_fortes?: string[];
    lacunas?: string[];
    evidencias?: EvidenciaScoreDTO[];
  };
  modelo: string;
  prompt_versao?: string | null;
  revisado_por?: string | null;
  revisado_em?: string | null;
  criado_em: string;
}

export interface RankingItemDTO {
  candidaturaId: string;
  candidatoId: string;
  candidatoNome: string;
  curriculoId: string;
  distancia: number;
  similaridadeVetorial: number;
  scoreRankingCv: number | null;
  scoreConsolidado: number;
  justificativa: string | null;
}

export interface RankingResponseDTO {
  vaga: { id: string; titulo: string };
  total: number;
  itens: RankingItemDTO[];
}

// ---------- Mensagens ----------

export interface MensagemDTO {
  id: string;
  candidatura_id?: string | null;
  canal: CanalMensagem;
  direcao: DirecaoMensagem;
  template_codigo?: string | null;
  assunto?: string | null;
  destino: string;
  provider: string;
  provider_msg_id?: string | null;
  status: StatusMensagem;
  erro?: string | null;
  enviado_em?: string | null;
  entregue_em?: string | null;
  lido_em?: string | null;
  respondido_em?: string | null;
  criado_em: string;
}

export interface TemplateDTO {
  codigo: string;
  versao: string;
  descricao: string;
  variaveis: readonly string[] | string[];
  canais: ('WHATSAPP' | 'EMAIL')[];
}

// ---------- Entrevista / Transcrição / Voz ----------

export interface TranscricaoDTO {
  id: string;
  idioma: string;
  texto_completo: string;
  resumo?: string | null;
  topicos?: string[];
  criado_em: string;
}

export interface AnaliseVozDTO {
  sentimento_global?: string | null;
  confianca_media?: number | null;
  nervosismo_medio?: number | null;
  entusiasmo_medio?: number | null;
  hesitacao_count?: number | null;
  observacoes_llm?: string | null;
  criado_em: string;
}

export interface EntrevistaDTO {
  id: string;
  candidatura_id: string;
  candidato_id: string;
  entrevistador_id?: string | null;
  agendada_para: string;
  duracao_estimada_min: number;
  meet_url?: string | null;
  google_event_id?: string | null;
  status: StatusEntrevista;
  bot_provider?: string | null;
  bot_session_id?: string | null;
  bot_status?: string | null;
  iniciada_em?: string | null;
  finalizada_em?: string | null;
  audio_sha256?: string | null;
  audio_expira_em?: string | null;
  parecer_final?: string | null;
  parecer_aprovado_em?: string | null;
  parecer_aprovado_por?: string | null;
  criado_em: string;
  atualizado_em: string;
  transcricao?: TranscricaoDTO | null;
  analise_voz?: AnaliseVozDTO | null;
}

// ---------- Perguntas ----------

export interface PerguntaDTO {
  id: string;
  ordem: number;
  entrevista_id?: string | null;
  vaga_id: string;
  pergunta: string;
  objetivo?: string | null;
  competencia?: string | null;
  dificuldade?: DificuldadePergunta | null;
  resposta_esperada?: string | null;
  modelo?: string;
  prompt_versao?: string | null;
  criado_em?: string;
}

// ---------- Admissão ----------

// Espelha o enum StatusAdmissao do Prisma (packages/db).
export type StatusAdmissao =
  | 'AGUARDANDO_ACEITE'
  | 'PROPOSTA_ACEITA'
  | 'COLETA_DOCUMENTOS'
  | 'DOCUMENTOS_EM_ANALISE'
  | 'EXAME_MEDICO'
  | 'ASSINATURA_CONTRATO'
  | 'ENVIO_ESOCIAL'
  | 'INTEGRACAO'
  | 'CONCLUIDA'
  | 'CANCELADA';

// Ordem canônica das etapas (para stepper/board). CANCELADA fica fora do fluxo.
export const ETAPAS_ADMISSAO: readonly StatusAdmissao[] = [
  'AGUARDANDO_ACEITE',
  'PROPOSTA_ACEITA',
  'COLETA_DOCUMENTOS',
  'DOCUMENTOS_EM_ANALISE',
  'EXAME_MEDICO',
  'ASSINATURA_CONTRATO',
  'ENVIO_ESOCIAL',
  'INTEGRACAO',
  'CONCLUIDA',
] as const;

export const ROTULO_ETAPA_ADMISSAO: Record<StatusAdmissao, string> = {
  AGUARDANDO_ACEITE: 'Aguardando aceite',
  PROPOSTA_ACEITA: 'Proposta aceita',
  COLETA_DOCUMENTOS: 'Coleta de documentos',
  DOCUMENTOS_EM_ANALISE: 'Documentos em análise',
  EXAME_MEDICO: 'Exame médico',
  ASSINATURA_CONTRATO: 'Assinatura de contrato',
  ENVIO_ESOCIAL: 'Envio ao eSocial',
  INTEGRACAO: 'Integração',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

export type TipoDocumentoAdmissional =
  | 'RG'
  | 'CPF'
  | 'CTPS'
  | 'TITULO_ELEITOR'
  | 'PIS_NIS'
  | 'COMPROVANTE_RESIDENCIA'
  | 'COMPROVANTE_ESCOLARIDADE'
  | 'CERTIDAO_NASCIMENTO_CASAMENTO'
  | 'RESERVISTA'
  | 'DADOS_BANCARIOS'
  | 'FOTO_3X4'
  | 'DEPENDENTES'
  | 'OUTRO';

export type StatusDocumentoAdmissional =
  | 'PENDENTE'
  | 'ENVIADO'
  | 'EM_ANALISE'
  | 'APROVADO'
  | 'REPROVADO';

export type ResultadoExameAdmissional =
  | 'PENDENTE'
  | 'APTO'
  | 'APTO_COM_RESTRICOES'
  | 'INAPTO';

// Dados lidos do RG por IA (OCR via Claude visão). Tudo opcional — só o que
// estava legível no documento. Tratar como "extraído por IA, conferir".
export interface RgExtraidoDTO {
  nome_completo?: string;
  rg_numero?: string;
  orgao_emissor?: string;
  uf?: string;
  data_nascimento?: string;
  data_expedicao?: string;
  filiacao?: { pai?: string; mae?: string };
  cpf?: string;
  naturalidade?: string;
  confianca?: 'alta' | 'media' | 'baixa';
}

export interface DocumentoAdmissionalDTO {
  id: string;
  tipo: TipoDocumentoAdmissional;
  status: StatusDocumentoAdmissional;
  obrigatorio: boolean;
  arquivo_url?: string | null;
  nome_arquivo?: string | null;
  validade?: string | null;
  motivo_recusa?: string | null;
  enviado_em?: string | null;
  analisado_em?: string | null;
  // OCR por IA (preenchido para o RG após o upload).
  dados_extraidos_json?: RgExtraidoDTO | null;
  ocr_versao?: string | null;
  ocr_processado_em?: string | null;
}

// Gatilho de criação de acesso de AD (chamado no Acelerato).
export type StatusSolicitacaoAcesso = 'PENDENTE' | 'ENVIADA' | 'FALHADA';

export interface SolicitacaoAcessoDTO {
  id: string;
  provider: string;
  status: StatusSolicitacaoAcesso;
  nome_enviado?: string | null;
  ref_externa?: string | null;
  url_externa?: string | null;
  erro?: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ExameAdmissionalDTO {
  id: string;
  clinica?: string | null;
  agendado_para?: string | null;
  realizado_em?: string | null;
  resultado: ResultadoExameAdmissional;
  restricoes?: string | null;
  aso_url?: string | null;
}

export interface EventoAdmissaoDTO {
  id: string;
  de_status?: StatusAdmissao | null;
  para_status: StatusAdmissao;
  autor_nome?: string | null;
  observacao?: string | null;
  criado_em: string;
}

// Item de listagem (board/kanban)
export interface AdmissaoListItemDTO {
  id: string;
  status: StatusAdmissao;
  candidato_nome: string;
  vaga_titulo: string | null;
  cargo?: string | null;
  data_admissao?: string | null;
  atualizado_em: string;
}

// Detalhe agregado
export interface AdmissaoDetalheDTO {
  id: string;
  status: StatusAdmissao;
  candidatura_id: string;
  candidato: { id: string; nome_completo: string; email?: string | null; telefone?: string | null };
  vaga: { id: string; titulo: string } | null;
  responsavel_id?: string | null;
  cargo?: string | null;
  salario?: string | null; // Decimal vira string em JSON
  tipo_contratacao?: string | null;
  jornada?: string | null;
  data_admissao?: string | null;
  data_aceite?: string | null;
  data_conclusao?: string | null;
  motivo_cancelamento?: string | null;
  esocial_recibo?: string | null;
  esocial_status?: string | null;
  matricula?: string | null;
  observacoes?: string | null;
  criado_em: string;
  atualizado_em: string;
  documentos: DocumentoAdmissionalDTO[];
  exame?: ExameAdmissionalDTO | null;
  eventos: EventoAdmissaoDTO[];
  solicitacao_acesso?: SolicitacaoAcessoDTO | null;
}

// ---------- Candidatura (agregada) ----------

export interface CandidaturaDetalheDTO {
  id: string;
  vaga_id: string;
  candidato: CandidatoDTO;
  status: StatusCandidatura;
  etapa_gupy?: string | null;
  inscrito_em?: string | null;
  curriculo?: CurriculoEstruturadoDTO | null;
  scores: ScoreDTO[];
  entrevistas: EntrevistaDTO[];
}

// ---------- Sistema: usuários, chaves de API e WhatsApp (WAHA) ----------

// Usuário na tela de gestão (seção Sistema → Usuários). `areas` usa os valores
// internos ('admin' | 'recrutamento' | 'admissao' | 'dho' | 'offboarding');
// o rótulo exibido de 'dho' no produto é "Administração de Pessoas".
export interface UsuarioAdminDTO {
  id: string;
  nome: string;
  email: string;
  areas: string[];
  ativo: boolean;
  ultimo_login_em: string | null;
  criado_em: string;
  /** Nº de vagas em que é gestor (vínculo automático por e-mail da Gupy). */
  vagas_como_gestor: number;
  /** Admin garantido por AUTH_ADMIN_EMAILS — remover 'admin' volta no próximo login. */
  admin_via_ambiente: boolean;
  /** Pré-cadastrado por e-mail e ainda sem 1º login (azure_oid provisório). */
  aguardando_primeiro_login: boolean;
}

export interface ChaveApiDTO {
  id: string;
  nome: string;
  /** Trecho exibível da chave (ex.: "clb_9f2a41c8") — nunca a chave completa. */
  prefixo: string;
  escopos: string[];
  criado_por_nome: string | null;
  expira_em: string | null;
  ultimo_uso_em: string | null;
  revogado_em: string | null;
  criado_em: string;
}

// Resposta da CRIAÇÃO — única vez em que a chave completa sai do servidor.
export interface ChaveApiCriadaDTO extends ChaveApiDTO {
  chave: string;
}

// Status da sessão WhatsApp (WAHA), proxiado pela API. `status` cru do WAHA
// (WORKING | SCAN_QR_CODE | STARTING | STOPPED | FAILED) ou os nossos
// NAO_CONFIGURADO | INDISPONIVEL.
export interface WahaStatusDTO {
  configurado: boolean;
  sessao: string;
  status: string;
  numero: string | null;
  nome_exibicao: string | null;
  engine: string | null;
  ultimo_webhook_em: string | null;
  ultimo_webhook_evento: string | null;
  /** Pacing anti-banimento da fila de mensagens. Null quando desativado. */
  pacing: {
    enviadas_hoje: number;
    cap_diario: number | null;
    janela: string;
    dentro_janela: boolean;
  } | null;
}

export interface WahaQrDTO {
  /** Data URL (image/png;base64) — o QR expira; re-buscar a cada ~20 s. */
  image: string;
}
