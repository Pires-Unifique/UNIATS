export { PrismaClient, Prisma } from '@prisma/client';

// Enums da admissão exportados como VALOR (usados em runtime: switch, Object.values, etc.).
export {
  StatusAdmissao,
  TipoDocumentoAdmissional,
  StatusDocumentoAdmissional,
  ResultadoExameAdmissional,
  StatusSolicitacaoAcesso,
} from '@prisma/client';

export type {
  Usuario,
  Vaga,
  Candidato,
  Candidatura,
  CurriculoProcessado,
  Embedding,
  Score,
  Mensagem,
  Entrevista,
  PerguntaEntrevista,
  AvaliacaoEntrevista,
  Transcricao,
  AnaliseVoz,
  WebhookRecebido,
  RegistroAuditoria,
  Admissao,
  DocumentoAdmissional,
  ExameAdmissional,
  EventoAdmissao,
  SolicitacaoAcesso,
  StatusVaga,
  StatusCandidatura,
  TipoScore,
  CanalMensagem,
  StatusMensagem,
  StatusEntrevista,
  OrigemAvaliacao,
  RecomendacaoPainel,
  PapelUsuario,
} from '@prisma/client';
