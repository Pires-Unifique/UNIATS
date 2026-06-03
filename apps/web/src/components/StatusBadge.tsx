import clsx from 'clsx';

const mapa: Record<string, string> = {
  // Vagas
  PUBLICADA: 'badge-green',
  RASCUNHO: 'badge-gray',
  PAUSADA: 'badge-yellow',
  ENCERRADA: 'badge-gray',
  CANCELADA: 'badge-red',

  // Candidaturas
  EM_ANALISE: 'badge-blue',
  TRIAGEM_IA: 'badge-yellow',
  APROVADO_TRIAGEM: 'badge-green',
  ENTREVISTA_AGENDADA: 'badge-blue',
  ENTREVISTA_REALIZADA: 'badge-blue',
  APROVADO: 'badge-green',
  REPROVADO: 'badge-red',
  DESISTENTE: 'badge-gray',
  CONTRATADO: 'badge-green',

  // Entrevistas
  AGENDADA: 'badge-blue',
  EM_ANDAMENTO: 'badge-yellow',
  FINALIZADA: 'badge-green',
  NAO_COMPARECEU: 'badge-red',

  // Mensagens
  PENDENTE: 'badge-gray',
  ENVIADO: 'badge-blue',
  ENTREGUE: 'badge-blue',
  LIDO: 'badge-green',
  RESPONDIDO: 'badge-green',
  FALHADO: 'badge-red',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = mapa[status] ?? 'badge-gray';
  return <span className={clsx(cls)}>{status.replace(/_/g, ' ').toLowerCase()}</span>;
}
