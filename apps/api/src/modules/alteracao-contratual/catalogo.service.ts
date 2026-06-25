import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@uniats/db';
import type {
  CargoDTO,
  CentroCustoDTO,
  ColaboradorDTO,
  UnidadeDTO,
} from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import { SeniorProvider } from './providers/senior.provider.js';

/** Linha do CSV de cargos (SharePoint). */
export interface CargoCsvRow {
  codigo?: string | null;
  titulo: string;
  senioridade?: string | null;
  descricao?: string | null;
}

/**
 * Catálogo do módulo de alteração contratual:
 *  - CARGOS: tabela própria (seed via CSV + criação manual + restrições de lotação);
 *  - COLABORADORES / CENTROS DE CUSTO: espelho do Senior;
 *  - UNIDADES/FILIAIS: espelho do Senior (view) — o UNIIT não expõe unidades.
 *
 * As buscas leem do espelho local (rápido/concorrente). O `sincronizar*` puxa da
 * fonte externa via provider (em modo desabilitado, não traz nada — ver providers).
 */
@Injectable()
export class CatalogoService {
  private readonly logger = new Logger(CatalogoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly senior: SeniorProvider,
  ) {}

  // ---------------- CARGOS ----------------

  async listarCargos(q?: string, incluirInativos = false): Promise<CargoDTO[]> {
    const cargos = await this.prisma.cargo.findMany({
      where: {
        excluido_em: null,
        ...(incluirInativos ? {} : { ativo: true }),
        ...(q
          ? {
              OR: [
                { titulo: { contains: q, mode: 'insensitive' } },
                { codigo: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { titulo: 'asc' },
      take: 200,
    });
    return cargos.map(cargoToDTO);
  }

  async criarCargo(input: {
    titulo: string;
    codigo?: string | null;
    senioridade?: string | null;
    descricao?: string | null;
  }): Promise<CargoDTO> {
    const cargo = await this.prisma.cargo.create({
      data: {
        titulo: input.titulo.trim(),
        codigo: input.codigo?.trim() || null,
        senioridade: input.senioridade?.trim() || null,
        descricao: input.descricao?.trim() || null,
        origem: 'manual',
      },
    });
    return cargoToDTO(cargo);
  }

  async atualizarCargo(
    id: string,
    input: Partial<{
      titulo: string;
      codigo: string | null;
      senioridade: string | null;
      descricao: string | null;
      ativo: boolean;
    }>,
  ): Promise<CargoDTO> {
    const data: Prisma.CargoUpdateInput = {};
    if (input.titulo !== undefined) data.titulo = input.titulo.trim();
    if (input.codigo !== undefined) data.codigo = input.codigo?.trim() || null;
    if (input.senioridade !== undefined)
      data.senioridade = input.senioridade?.trim() || null;
    if (input.descricao !== undefined)
      data.descricao = input.descricao?.trim() || null;
    if (input.ativo !== undefined) data.ativo = input.ativo;
    try {
      const cargo = await this.prisma.cargo.update({ where: { id }, data });
      return cargoToDTO(cargo);
    } catch {
      throw new NotFoundException(`Cargo ${id} não encontrado.`);
    }
  }

  /**
   * Importa (upsert) o catálogo de cargos a partir do CSV do SharePoint.
   * Chave: `codigo` quando houver; senão, `titulo`. Idempotente.
   */
  async importarCargosCsv(
    rows: CargoCsvRow[],
  ): Promise<{ criados: number; atualizados: number }> {
    let criados = 0;
    let atualizados = 0;
    for (const row of rows) {
      const titulo = row.titulo?.trim();
      if (!titulo) continue;
      const codigo = row.codigo?.trim() || null;
      const existente = codigo
        ? await this.prisma.cargo.findUnique({ where: { codigo } })
        : await this.prisma.cargo.findFirst({ where: { titulo } });
      if (existente) {
        await this.prisma.cargo.update({
          where: { id: existente.id },
          data: {
            titulo,
            senioridade: row.senioridade?.trim() || null,
            descricao: row.descricao?.trim() || null,
            excluido_em: null,
          },
        });
        atualizados++;
      } else {
        await this.prisma.cargo.create({
          data: {
            codigo,
            titulo,
            senioridade: row.senioridade?.trim() || null,
            descricao: row.descricao?.trim() || null,
            origem: 'csv',
          },
        });
        criados++;
      }
    }
    this.logger.log(
      `Importação de cargos: ${criados} criados, ${atualizados} atualizados.`,
    );
    return { criados, atualizados };
  }

  /** Define as lotações permitidas de um cargo (substitui as existentes). */
  async definirLotacoesCargo(
    cargoId: string,
    lotacoes: Array<{ unidadeId?: string | null; centroCustoId?: string | null }>,
  ): Promise<{ total: number }> {
    const cargo = await this.prisma.cargo.findUnique({ where: { id: cargoId } });
    if (!cargo) throw new NotFoundException(`Cargo ${cargoId} não encontrado.`);
    await this.prisma.$transaction([
      this.prisma.cargoLotacao.deleteMany({ where: { cargo_id: cargoId } }),
      this.prisma.cargoLotacao.createMany({
        data: lotacoes
          .filter((l) => l.unidadeId || l.centroCustoId)
          .map((l) => ({
            cargo_id: cargoId,
            unidade_id: l.unidadeId ?? null,
            centro_custo_id: l.centroCustoId ?? null,
          })),
        skipDuplicates: true,
      }),
    ]);
    const total = await this.prisma.cargoLotacao.count({
      where: { cargo_id: cargoId },
    });
    return { total };
  }

  // ---------------- COLABORADORES (espelho Senior) ----------------

  async buscarColaboradores(q?: string): Promise<ColaboradorDTO[]> {
    const colaboradores = await this.prisma.colaborador.findMany({
      where: {
        ativo: true,
        ...(q
          ? {
              OR: [
                { nome: { contains: q, mode: 'insensitive' } },
                { matricula: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        unidade: { select: { nome: true } },
        centro_custo: { select: { nome: true } },
      },
      orderBy: { nome: 'asc' },
      take: 50,
    });
    return colaboradores.map(colaboradorToDTO);
  }

  // ---------------- UNIDADES / FILIAIS (espelho Senior) ----------------

  async listarUnidades(q?: string): Promise<UnidadeDTO[]> {
    const unidades = await this.prisma.unidade.findMany({
      where: {
        ativo: true,
        ...(q ? { nome: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { nome: 'asc' },
      take: 200,
    });
    return unidades.map(unidadeToDTO);
  }

  // ---------------- CENTROS DE CUSTO (espelho Senior) ----------------

  async listarCentrosCusto(q?: string): Promise<CentroCustoDTO[]> {
    const centros = await this.prisma.centroCusto.findMany({
      where: {
        ativo: true,
        ...(q ? { nome: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { nome: 'asc' },
      take: 200,
    });
    return centros.map(centroToDTO);
  }

  // ---------------- SYNC (puxa das fontes externas) ----------------

  async sincronizarUnidades(): Promise<{ total: number }> {
    // Unidades/filiais vêm da view do Senior (o UNIIT não as expõe).
    const lista = await this.senior.listarUnidades();
    for (const u of lista) {
      await this.prisma.unidade.upsert({
        where: { externo_id: u.externo_id },
        create: {
          externo_id: u.externo_id,
          codigo: u.codigo ?? null,
          nome: u.nome,
          cidade: u.cidade ?? null,
          estado: u.estado ?? null,
          ativo: u.ativo ?? true,
          sincronizado_em: new Date(),
        },
        update: {
          codigo: u.codigo ?? null,
          nome: u.nome,
          cidade: u.cidade ?? null,
          estado: u.estado ?? null,
          ativo: u.ativo ?? true,
          sincronizado_em: new Date(),
        },
      });
    }
    return { total: lista.length };
  }

  async sincronizarCentrosCusto(): Promise<{ total: number }> {
    const lista = await this.senior.listarCentrosCusto();
    for (const c of lista) {
      await this.prisma.centroCusto.upsert({
        where: { senior_id: c.senior_id },
        create: {
          senior_id: c.senior_id,
          codigo: c.codigo ?? null,
          nome: c.nome,
          ativo: c.ativo ?? true,
          sincronizado_em: new Date(),
        },
        update: {
          codigo: c.codigo ?? null,
          nome: c.nome,
          ativo: c.ativo ?? true,
          sincronizado_em: new Date(),
        },
      });
    }
    return { total: lista.length };
  }

  async sincronizarColaboradores(): Promise<{ total: number }> {
    const lista = await this.senior.listarColaboradores();
    if (lista.length === 0) return { total: 0 };

    // Resolve códigos externos → ids do espelho (mapas em memória).
    const unidades = await this.prisma.unidade.findMany({
      select: { id: true, externo_id: true, codigo: true },
    });
    const centros = await this.prisma.centroCusto.findMany({
      select: { id: true, senior_id: true },
    });
    const unidadePorCodigo = new Map<string, string>();
    for (const u of unidades) {
      if (u.codigo) unidadePorCodigo.set(u.codigo, u.id);
      unidadePorCodigo.set(u.externo_id, u.id);
    }
    const centroPorSeniorId = new Map(centros.map((c) => [c.senior_id, c.id]));

    for (const col of lista) {
      const unidade_id = col.unidade_externo_id
        ? (unidadePorCodigo.get(col.unidade_externo_id) ?? null)
        : null;
      const centro_custo_id = col.centro_custo_senior_id
        ? (centroPorSeniorId.get(col.centro_custo_senior_id) ?? null)
        : null;
      await this.prisma.colaborador.upsert({
        where: { matricula: col.matricula },
        create: {
          matricula: col.matricula,
          senior_id: col.senior_id ?? null,
          nome: col.nome,
          email: col.email ?? null,
          cpf_hash: col.cpf_hash ?? null,
          unidade_id,
          centro_custo_id,
          cargo_atual: col.cargo_atual ?? null,
          lider_matricula: col.lider_matricula ?? null,
          lider_nome: col.lider_nome ?? null,
          ativo: col.ativo ?? true,
          sincronizado_em: new Date(),
        },
        update: {
          senior_id: col.senior_id ?? null,
          nome: col.nome,
          email: col.email ?? null,
          cpf_hash: col.cpf_hash ?? null,
          unidade_id,
          centro_custo_id,
          cargo_atual: col.cargo_atual ?? null,
          lider_matricula: col.lider_matricula ?? null,
          lider_nome: col.lider_nome ?? null,
          ativo: col.ativo ?? true,
          sincronizado_em: new Date(),
        },
      });
    }
    return { total: lista.length };
  }
}

// ---------------- mappers ----------------

function cargoToDTO(c: {
  id: string;
  codigo: string | null;
  titulo: string;
  senioridade: string | null;
  descricao: string | null;
  ativo: boolean;
  origem: string;
  criado_em: Date;
  atualizado_em: Date;
}): CargoDTO {
  return {
    id: c.id,
    codigo: c.codigo,
    titulo: c.titulo,
    senioridade: c.senioridade,
    descricao: c.descricao,
    ativo: c.ativo,
    origem: c.origem,
    criado_em: c.criado_em.toISOString(),
    atualizado_em: c.atualizado_em.toISOString(),
  };
}

function unidadeToDTO(u: {
  id: string;
  externo_id: string;
  codigo: string | null;
  nome: string;
  cidade: string | null;
  estado: string | null;
  ativo: boolean;
}): UnidadeDTO {
  return {
    id: u.id,
    externo_id: u.externo_id,
    codigo: u.codigo,
    nome: u.nome,
    cidade: u.cidade,
    estado: u.estado,
    ativo: u.ativo,
  };
}

function centroToDTO(c: {
  id: string;
  senior_id: string;
  codigo: string | null;
  nome: string;
  ativo: boolean;
}): CentroCustoDTO {
  return {
    id: c.id,
    senior_id: c.senior_id,
    codigo: c.codigo,
    nome: c.nome,
    ativo: c.ativo,
  };
}

function colaboradorToDTO(c: {
  id: string;
  matricula: string;
  nome: string;
  email: string | null;
  unidade_id: string | null;
  centro_custo_id: string | null;
  cargo_atual: string | null;
  lider_matricula: string | null;
  lider_nome: string | null;
  ativo: boolean;
  unidade?: { nome: string } | null;
  centro_custo?: { nome: string } | null;
}): ColaboradorDTO {
  return {
    id: c.id,
    matricula: c.matricula,
    nome: c.nome,
    email: c.email,
    unidade_id: c.unidade_id,
    unidade_nome: c.unidade?.nome ?? null,
    centro_custo_id: c.centro_custo_id,
    centro_custo_nome: c.centro_custo?.nome ?? null,
    cargo_atual: c.cargo_atual,
    lider_matricula: c.lider_matricula,
    lider_nome: c.lider_nome,
    ativo: c.ativo,
  };
}
