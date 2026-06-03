/**
 * Catálogo de variáveis disponíveis para os templates de mensagem.
 *
 * É a fonte única usada pela UI para oferecer "botões" de variáveis (o leigo
 * clica e a variável é inserida na mensagem, sem digitar `{{ }}`) e para
 * mostrar rótulos amigáveis em vez do código técnico (slug).
 *
 * `autoPreenchida = true` → o sistema preenche o valor sozinho a partir da
 * candidatura (ver MessagingService.resolverContexto). As demais o recrutador
 * preenche na hora de enviar.
 */
export interface VariavelDisponivel {
  /** Nome técnico usado no template como {{slug}}. */
  slug: string;
  /** Rótulo amigável para o usuário leigo. */
  label: string;
  /** Explicação curta (vai no tooltip). */
  descricao: string;
  /** Preenchida automaticamente pelo sistema (não precisa digitar ao enviar). */
  autoPreenchida: boolean;
}

export const VARIAVEIS_DISPONIVEIS: readonly VariavelDisponivel[] = [
  {
    slug: 'candidato_nome',
    label: 'Nome do candidato',
    descricao: 'Preenchido automaticamente com o nome do candidato.',
    autoPreenchida: true,
  },
  {
    slug: 'vaga_titulo',
    label: 'Título da vaga',
    descricao: 'Preenchido automaticamente com o título da vaga.',
    autoPreenchida: true,
  },
  {
    slug: 'recrutador_nome',
    label: 'Nome do recrutador',
    descricao: 'Preenchido automaticamente com o nome do recrutador da vaga.',
    autoPreenchida: true,
  },
  {
    slug: 'link_confirmacao',
    label: 'Link de confirmação',
    descricao: 'Link para o candidato confirmar interesse. Você cola ao enviar.',
    autoPreenchida: false,
  },
  {
    slug: 'link_agendamento',
    label: 'Link de agendamento',
    descricao: 'Link para o candidato escolher um horário. Você cola ao enviar.',
    autoPreenchida: false,
  },
  {
    slug: 'data_hora',
    label: 'Data e hora',
    descricao: 'Data e hora da entrevista. Você preenche ao enviar.',
    autoPreenchida: false,
  },
  {
    slug: 'link_meet',
    label: 'Link da videochamada',
    descricao: 'Link do Google Meet ou Teams. Você cola ao enviar.',
    autoPreenchida: false,
  },
  {
    slug: 'mensagem_personalizada',
    label: 'Mensagem personalizada',
    descricao: 'Texto livre que você escreve para este candidato ao enviar.',
    autoPreenchida: false,
  },
  {
    slug: 'opcao_1',
    label: 'Opção de horário 1',
    descricao: 'Primeira opção de horário oferecida ao candidato.',
    autoPreenchida: false,
  },
  {
    slug: 'opcao_2',
    label: 'Opção de horário 2',
    descricao: 'Segunda opção de horário oferecida ao candidato.',
    autoPreenchida: false,
  },
  {
    slug: 'opcao_3',
    label: 'Opção de horário 3',
    descricao: 'Terceira opção de horário oferecida ao candidato.',
    autoPreenchida: false,
  },
] as const;
