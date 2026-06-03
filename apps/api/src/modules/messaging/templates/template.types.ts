/**
 * Modelo de templates. Cada template tem um corpo por canal (WhatsApp = texto puro,
 * E-mail = texto + HTML opcional). Placeholders no formato {{nome}}.
 *
 * Versionar o template é importante para auditoria: ao alterar wording,
 * bump a versão e a coluna `template_codigo` em mensagens guarda "codigo@versao".
 */

/**
 * Códigos dos templates "de fábrica" (seed). Mantido apenas como referência
 * dos slugs conhecidos — os templates agora vivem no banco e o `codigo` é
 * uma `string` aberta (recrutadores podem criar novos).
 */
export type TemplateCodigoConhecido =
  | 'convite_triagem'
  | 'agendamento_entrevista'
  | 'comunicado_decisao'
  | 'lembrete_entrevista';

export type CanalSuportado = 'WHATSAPP' | 'EMAIL';

/**
 * Template no formato resolvido (já vindo do banco) que o renderer puro consome.
 * As variáveis são derivadas dos corpos via PLACEHOLDER_RE — não são declaradas.
 */
export interface TemplateResolvido {
  codigo: string;
  versao: string;
  whatsapp?: {
    corpo: string; // texto puro, sem HTML
  };
  email?: {
    assunto: string;
    texto: string; // text/plain
    html?: string; // opcional; gerado a partir do texto se ausente
  };
}

export type Variaveis = Record<string, string | number>;
