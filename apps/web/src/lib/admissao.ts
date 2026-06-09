// Constantes de apresentação da Admissão (runtime).
//
// Ficam aqui (e não importadas de @uniats/shared) porque a web resolve o
// shared pelo SOURCE via path do tsconfig, e o source usa extensões `.js`
// nos re-exports — o webpack do Next só lida bem com IMPORTS DE TIPO desse
// pacote (que são apagados). Importar VALORES de lá quebra o bundling.
import type { StatusAdmissao } from '@uniats/shared';

// Ordem canônica das etapas (CANCELADA fica fora do fluxo linear).
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
];

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
