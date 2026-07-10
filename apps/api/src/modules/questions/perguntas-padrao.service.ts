import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

interface CriarPadraoInput {
  pergunta: string;
  objetivo?: string;
  competencia?: string;
  categoria?: string;
  ordem?: number;
  criadoPor?: string;
}

interface AtualizarPadraoInput {
  pergunta?: string;
  objetivo?: string | null;
  competencia?: string | null;
  categoria?: string | null;
  ordem?: number;
  ativo?: boolean;
}

const SELECT_PADRAO = {
  id: true,
  pergunta: true,
  objetivo: true,
  competencia: true,
  categoria: true,
  ativo: true,
  ordem: true,
  criado_por: true,
  criado_em: true,
  atualizado_em: true,
} as const;

/**
 * Banco de perguntas PADRÃO do DHO (cultura, valores, disponibilidade…).
 * São templates globais: entram em TODA análise pós-reunião enquanto ativas.
 * A resposta guarda snapshot do texto, então editar/apagar aqui não altera o
 * histórico de entrevistas já analisadas.
 */
@Injectable()
export class PerguntasPadraoService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtros: { incluirInativas?: boolean } = {}) {
    return this.prisma.perguntaPadrao.findMany({
      where: filtros.incluirInativas ? {} : { ativo: true },
      orderBy: [{ ordem: 'asc' }, { criado_em: 'asc' }],
      select: SELECT_PADRAO,
    });
  }

  async criar(input: CriarPadraoInput) {
    const texto = (input.pergunta ?? '').trim();
    if (texto.length < 10 || texto.length > 600) {
      throw new BadRequestException(
        'pergunta deve ter entre 10 e 600 caracteres.',
      );
    }
    return this.prisma.perguntaPadrao.create({
      data: {
        pergunta: texto,
        objetivo: input.objetivo?.trim() || null,
        competencia: input.competencia?.trim() || null,
        categoria: input.categoria?.trim() || null,
        ordem: input.ordem ?? 0,
        criado_por: input.criadoPor ?? null,
      },
      select: SELECT_PADRAO,
    });
  }

  async atualizar(id: string, patch: AtualizarPadraoInput) {
    if (!Object.keys(patch).length) {
      throw new BadRequestException('Nada a atualizar.');
    }
    if (patch.pergunta != null) {
      const texto = patch.pergunta.trim();
      if (texto.length < 10 || texto.length > 600) {
        throw new BadRequestException(
          'pergunta deve ter entre 10 e 600 caracteres.',
        );
      }
      patch.pergunta = texto;
    }
    if (patch.ordem != null && (patch.ordem < 0 || patch.ordem > 100)) {
      throw new BadRequestException('ordem deve estar entre 0 e 100.');
    }
    try {
      return await this.prisma.perguntaPadrao.update({
        where: { id },
        data: {
          ...(patch.pergunta != null ? { pergunta: patch.pergunta } : {}),
          ...(patch.objetivo !== undefined
            ? { objetivo: patch.objetivo?.trim() || null }
            : {}),
          ...(patch.competencia !== undefined
            ? { competencia: patch.competencia?.trim() || null }
            : {}),
          ...(patch.categoria !== undefined
            ? { categoria: patch.categoria?.trim() || null }
            : {}),
          ...(patch.ordem != null ? { ordem: patch.ordem } : {}),
          ...(patch.ativo != null ? { ativo: patch.ativo } : {}),
        },
        select: SELECT_PADRAO,
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') {
        throw new NotFoundException(`Pergunta padrão ${id} não existe.`);
      }
      throw err;
    }
  }

  async deletar(id: string): Promise<void> {
    try {
      await this.prisma.perguntaPadrao.delete({ where: { id } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') {
        throw new NotFoundException(`Pergunta padrão ${id} não existe.`);
      }
      throw err;
    }
  }
}
