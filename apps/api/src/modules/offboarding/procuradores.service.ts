import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@uniats/db';
import type { ProcuradorDTO } from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Catálogo de PROCURADORES — pessoas cadastradas pelo DHO que podem assinar como
 * REPRESENTANTE_EMPRESA na via FÍSICA do offboarding (em nome da Unifique).
 */
@Injectable()
export class ProcuradoresService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(q?: string, incluirInativos = false): Promise<ProcuradorDTO[]> {
    const procuradores = await this.prisma.procurador.findMany({
      where: {
        excluido_em: null,
        ...(incluirInativos ? {} : { ativo: true }),
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      take: 200,
    });
    return procuradores.map(toDTO);
  }

  async criar(input: {
    nome: string;
    email?: string | null;
    documento?: string | null;
    cargo?: string | null;
    observacao?: string | null;
  }): Promise<ProcuradorDTO> {
    const p = await this.prisma.procurador.create({
      data: {
        nome: input.nome.trim(),
        email: input.email?.trim() || null,
        documento: input.documento?.trim() || null,
        cargo: input.cargo?.trim() || null,
        observacao: input.observacao?.trim() || null,
      },
    });
    return toDTO(p);
  }

  async atualizar(
    id: string,
    input: Partial<{
      nome: string;
      email: string | null;
      documento: string | null;
      cargo: string | null;
      observacao: string | null;
      ativo: boolean;
    }>,
  ): Promise<ProcuradorDTO> {
    const data: Prisma.ProcuradorUpdateInput = {};
    if (input.nome !== undefined) data.nome = input.nome.trim();
    if (input.email !== undefined) data.email = input.email?.trim() || null;
    if (input.documento !== undefined) data.documento = input.documento?.trim() || null;
    if (input.cargo !== undefined) data.cargo = input.cargo?.trim() || null;
    if (input.observacao !== undefined) data.observacao = input.observacao?.trim() || null;
    if (input.ativo !== undefined) data.ativo = input.ativo;
    try {
      const p = await this.prisma.procurador.update({ where: { id }, data });
      return toDTO(p);
    } catch {
      throw new NotFoundException(`Procurador ${id} não encontrado.`);
    }
  }

  /** Soft-delete (mantém histórico de assinaturas que apontam p/ ele). */
  async remover(id: string): Promise<{ ok: true }> {
    try {
      await this.prisma.procurador.update({
        where: { id },
        data: { excluido_em: new Date(), ativo: false },
      });
      return { ok: true };
    } catch {
      throw new NotFoundException(`Procurador ${id} não encontrado.`);
    }
  }
}

function toDTO(p: {
  id: string;
  nome: string;
  email: string | null;
  documento: string | null;
  cargo: string | null;
  ativo: boolean;
  observacao: string | null;
  criado_em: Date;
  atualizado_em: Date;
}): ProcuradorDTO {
  return {
    id: p.id,
    nome: p.nome,
    email: p.email,
    documento: p.documento,
    cargo: p.cargo,
    ativo: p.ativo,
    observacao: p.observacao,
    criado_em: p.criado_em.toISOString(),
    atualizado_em: p.atualizado_em.toISOString(),
  };
}
