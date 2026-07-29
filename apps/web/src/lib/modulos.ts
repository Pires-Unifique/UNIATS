/**
 * Módulos do produto visíveis nesta fase.
 *
 * O primeiro lançamento do Collab foca em **Recrutamento & Seleção**. Admissão
 * e Administração de Pessoas (alteração contratual + offboarding) estão
 * implementados, testados e com as rotas de API no lugar — só ficam FORA da
 * navegação até a fase seguinte, porque dependem de integrações que ainda rodam
 * em modo simulado (Senior, Autentique, abertura de chamado no TI).
 *
 * Para reativar: mude o módulo para `true` aqui. Nada mais precisa mudar — a
 * sidebar e o guarda de rota leem deste mapa.
 */
export type ModuloProduto = 'recrutamento' | 'admissao' | 'pessoas' | 'sistema';

export const MODULOS_HABILITADOS: Record<ModuloProduto, boolean> = {
  recrutamento: true,
  sistema: true,
  admissao: false,
  pessoas: false,
};

export function moduloHabilitado(modulo: ModuloProduto | undefined): boolean {
  if (!modulo) return true;
  return MODULOS_HABILITADOS[modulo];
}

/**
 * Prefixos de rota de cada módulo desligado. Serve para o guarda de navegação:
 * digitar a URL na mão de um módulo oculto devolve o usuário para o início, em
 * vez de abrir uma tela que a equipe ainda não deve usar.
 */
const PREFIXOS_POR_MODULO: Record<ModuloProduto, string[]> = {
  recrutamento: [],
  sistema: [],
  admissao: ['/admissao'],
  // `/cargos` NÃO entra aqui: o catálogo de cargos é do fluxo de publicar vaga
  // (Recrutamento). A página pública `/offboarding/auto/[token]` fica fora do
  // grupo (authed) e segue funcionando — link já enviado a um colaborador não
  // deve quebrar; sem a tela de convites, novos links não são gerados.
  pessoas: ['/alteracao-contratual', '/offboarding'],
};

export function rotaDeModuloOculto(path: string | null): boolean {
  if (!path) return false;
  return (Object.keys(MODULOS_HABILITADOS) as ModuloProduto[]).some(
    (m) =>
      !MODULOS_HABILITADOS[m] &&
      PREFIXOS_POR_MODULO[m].some((p) => path === p || path.startsWith(`${p}/`)),
  );
}
