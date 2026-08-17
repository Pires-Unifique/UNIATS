import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { REDACAO_CV_VERSAO } from './curriculo-para-ia.js';
import { RedacaoService } from './redacao.service.js';

/**
 * Calcula o espelho censurado do currículo — a versão que pode sair para IA.
 *
 * As colunas originais NÃO são tocadas: a decisão da área de segurança é manter
 * o currículo íntegro para leitura humana. Aqui só produzimos a cópia segura,
 * gravada em `ia_*`, que a fronteira (`curriculo-para-ia.ts`) consome.
 *
 * Roda uma vez por currículo, não a cada chamada de ranking — a Camada 2 é uma
 * chamada Claude, e o fluxo de ranking já tem custo e latência medidos.
 */
@Injectable()
export class CurriculoRedacaoService {
  private readonly logger = new Logger(CurriculoRedacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redacao: RedacaoService,
  ) {}

  /**
   * Preenche `ia_*` do currículo. Idempotente: se já está na versão atual,
   * não refaz (a menos que `forcar`).
   */
  async gerarEspelho(
    curriculoId: string,
    opts: { forcar?: boolean } = {},
  ): Promise<{ gerado: boolean; categorias: string[] }> {
    const cv = await this.prisma.curriculoProcessado.findUnique({
      where: { id: curriculoId },
      select: {
        id: true,
        resumo: true,
        experiencias: true,
        texto_normalizado: true,
        ia_redacao_versao: true,
      },
    });
    if (!cv) {
      throw new NotFoundException(`Currículo ${curriculoId} não existe.`);
    }
    if (!opts.forcar && cv.ia_redacao_versao === REDACAO_CV_VERSAO) {
      return { gerado: false, categorias: [] };
    }

    const experiencias = Array.isArray(cv.experiencias)
      ? (cv.experiencias as Array<Record<string, unknown>>)
      : [];

    // Um turno por trecho de texto livre. Reusa `redigirTurnos`, que já aplica
    // as duas camadas (regex + Claude semântico) numa chamada só para o lote —
    // censurar campo a campo multiplicaria as chamadas sem ganho.
    const turnos: Array<{ falante: string | null; texto: string }> = [];
    const indiceDescricao: number[] = [];

    experiencias.forEach((e, i) => {
      const d = typeof e.descricao === 'string' ? e.descricao : '';
      if (d.trim()) {
        indiceDescricao.push(i);
        turnos.push({ falante: null, texto: d });
      }
    });

    const temResumo = Boolean(cv.resumo?.trim());
    if (temResumo) turnos.push({ falante: null, texto: cv.resumo! });

    const temTexto = Boolean(cv.texto_normalizado?.trim());
    if (temTexto) turnos.push({ falante: null, texto: cv.texto_normalizado! });

    // Sem texto livre nenhum: grava o espelho vazio mesmo assim, para marcar a
    // versão e tirar o currículo da fila do backfill.
    if (!turnos.length) {
      await this.prisma.curriculoProcessado.update({
        where: { id: cv.id },
        data: {
          ia_experiencias: experiencias as unknown as object,
          ia_resumo: null,
          ia_texto: cv.texto_normalizado ?? null,
          ia_redacao_versao: REDACAO_CV_VERSAO,
          ia_categorias: [],
        },
      });
      return { gerado: true, categorias: [] };
    }

    // Fail-closed: se a censura falhar, propaga e o BullMQ re-tenta. Gravar um
    // espelho parcial seria pior que não ter espelho — a fronteira confia nele.
    const red = await this.redacao.redigirTurnos(turnos);

    let cursor = 0;
    const iaExperiencias = experiencias.map((e) => ({ ...e }));
    for (const i of indiceDescricao) {
      iaExperiencias[i].descricao = red.turnos[cursor++]?.texto ?? null;
    }
    const iaResumo = temResumo ? (red.turnos[cursor++]?.texto ?? null) : null;
    const iaTexto = temTexto ? (red.turnos[cursor++]?.texto ?? null) : null;

    await this.prisma.curriculoProcessado.update({
      where: { id: cv.id },
      data: {
        ia_experiencias: iaExperiencias as unknown as object,
        ia_resumo: iaResumo,
        ia_texto: iaTexto,
        ia_redacao_versao: REDACAO_CV_VERSAO,
        // Só as CATEGORIAS, nunca o valor ocultado (art. 37).
        ia_categorias: red.categorias,
      },
    });

    if (red.categorias.length) {
      this.logger.log(
        `Espelho do currículo ${cv.id}: categorias ocultadas = ${red.categorias.join(', ')}`,
      );
    }

    return { gerado: true, categorias: red.categorias };
  }
}
