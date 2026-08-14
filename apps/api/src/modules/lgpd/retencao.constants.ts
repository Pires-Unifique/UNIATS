/**
 * Marcador gravado no lugar de um texto apagado pela retenção LGPD.
 *
 * Além de sinalizar na tela que o conteúdo foi removido por política (e não
 * perdido), é ele que dá IDEMPOTÊNCIA às varreduras: a query do próximo sweep
 * exclui as linhas que já carregam o marcador, então reprocessar a mesma janela
 * não gera update nem linha de auditoria duplicada.
 *
 * Só mude este valor junto de um backfill — linhas antigas com o texto anterior
 * voltariam a ser varridas todas as noites.
 */
export const MARCADOR_PURGADO = '[retencao_lgpd: conteudo removido]';
