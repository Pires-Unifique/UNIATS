import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { traduzirTipoContrato } from '../gupy/mappers/gupy.mapper.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Escopo de leitura por ÁREA: quem tem 'admin' ou 'recrutamento' enxerga TODAS
 * as vagas; os demais (ex.: gestor) só as vagas em que são o gestor (gestor_id).
 * Retorna o fragmento `where` a mesclar (ou null = sem restrição).
 */
function escopoPorArea(
  usuario: UsuarioAutenticado,
): { gestor_id: string } | null {
  if (usuario.areas.includes('admin') || usuario.areas.includes('recrutamento')) {
    return null;
  }
  return { gestor_id: usuario.id };
}

/**
 * Monta { nome, email } a partir do que a Gupy mandou no payload. Usado como
 * fallback quando a vaga não tem recrutador/gestor INTERNO (usuário SSO) ligado
 * — caso comum em vagas só sincronizadas, não criadas pelo nosso app.
 */
function pessoaDoPayload(
  nome: unknown,
  email: unknown,
): { nome: string; email: string } | null {
  const n = typeof nome === 'string' ? nome.trim() : '';
  const e = typeof email === 'string' ? email.trim() : '';
  if (!n && !e) return null;
  return { nome: n || e, email: e };
}

/** Lê uma string não-vazia do payload da Gupy (senão null). */
function strDoPayload(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/**
 * Read API local — frontend usa para listar vagas JÁ SINCRONIZADAS, com
 * contagens de candidaturas. Diferente de `/api/gupy/vagas` (passthrough
 * direto da Gupy), aqui retornamos só o que está no nosso banco.
 */
@Controller('api/vagas')
@UseGuards(ThrottlerGuard, AuthGuard)
export class VagasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limite') limiteStr?: string,
  ) {
    let limite = 50;
    if (limiteStr) {
      const n = Number(limiteStr);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        throw new BadRequestException('limite deve estar entre 1 e 200.');
      }
      limite = n;
    }
    const where: Record<string, unknown> = { excluido_em: null };
    if (status) where.status = status;
    // Busca livre casa título OU código interno da vaga (jobCode da Gupy).
    if (q) {
      where.OR = [
        { titulo: { contains: q, mode: 'insensitive' } },
        { codigo: { contains: q, mode: 'insensitive' } },
      ];
    }
    // Gestor/visualizador: restringe às vagas dele.
    const escopo = escopoPorArea(usuario);
    if (escopo) where.gestor_id = escopo.gestor_id;

    const [vagas, totais] = await Promise.all([
      this.prisma.vaga.findMany({
        where,
        // Vagas com mais candidaturas primeiro; depois por publicação (NULLS por último).
        orderBy: [
          { candidaturas: { _count: 'desc' } },
          { data_publicacao: { sort: 'desc', nulls: 'last' } },
          { criado_em: 'desc' },
        ],
        take: limite,
        select: {
          id: true,
          gupy_id: true,
          codigo: true,
          titulo: true,
          departamento: true,
          unidade: true,
          cidade: true,
          estado: true,
          remoto: true,
          status: true,
          data_publicacao: true,
          atualizado_em: true,
          _count: { select: { candidaturas: true } },
        },
      }),
      this.prisma.candidatura.groupBy({
        by: ['vaga_id'],
        _count: { _all: true },
      }),
    ]);

    // BigInt → string para serialização JSON
    const itens = vagas.map((v) => ({
      ...v,
      gupy_id: v.gupy_id.toString(),
      qtdCandidaturas: v._count.candidaturas,
    }));

    void totais; // unused — agregação já está em `_count`
    return { total: itens.length, itens };
  }

  @Get(':id')
  async obter(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    // Mescla o escopo no where: vaga de outro gestor → findFirst retorna null →
    // 404 (mesma resposta de "não existe", para não vazar a existência da vaga).
    const escopo = escopoPorArea(usuario);
    const v = await this.prisma.vaga.findFirst({
      where: { id, ...(escopo ?? {}) },
      include: {
        _count: { select: { candidaturas: true } },
      },
    });
    if (!v) throw new NotFoundException(`Vaga ${id} não existe.`);
    // Recrutador/gestor vêm do próprio payload da Gupy (recruiterName/managerName).
    // Ainda não há vagas criadas pelo sistema, então não usamos a relação interna.
    const payload = (v.gupy_payload ?? {}) as Record<string, unknown>;
    return {
      ...v,
      tipo_contrato: traduzirTipoContrato(v.tipo_contrato),
      recrutador: pessoaDoPayload(payload.recruiterName, payload.recruiterEmail),
      gestor: pessoaDoPayload(payload.managerName, payload.managerEmail),
      // Local: usa o que está na coluna; senão cai no payload (vagas antigas
      // foram sincronizadas antes de mapearmos addressCity/addressState).
      cidade: v.cidade ?? strDoPayload(payload.addressCity),
      estado:
        v.estado ??
        strDoPayload(payload.addressStateShortName) ??
        strDoPayload(payload.addressState),
      gupy_id: v.gupy_id.toString(),
      qtdCandidaturas: v._count.candidaturas,
    };
  }

  /**
   * Lista as candidaturas (candidatos) de uma vaga — leitura direta do banco,
   * SEM depender de score/ranking. Usado para exibir os candidatos na vaga
   * antes da classificação por IA.
   */
  @Get(':id/candidaturas')
  async candidaturas(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('limite') limiteStr?: string,
    @Query('q') q?: string,
    @Query('incluirReprovados') incluirReprovados?: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    let limite = 200;
    if (limiteStr) {
      const n = Number(limiteStr);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        throw new BadRequestException('limite deve estar entre 1 e 500.');
      }
      limite = n;
    }

    // Mesmo escopo da leitura da vaga: gestor não acessa candidatos de vaga alheia.
    const escopo = escopoPorArea(usuario);
    const vaga = await this.prisma.vaga.findFirst({
      where: { id, ...(escopo ?? {}) },
      select: { id: true, titulo: true, gupy_id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${id} não existe.`);

    const busca = q?.trim();
    const where: Record<string, unknown> = { vaga_id: id };
    // Por padrão, esconde candidatos REPROVADOS/DESISTENTES da listagem.
    if (incluirReprovados !== 'true') {
      where.status = { notIn: ['REPROVADO', 'DESISTENTE'] };
    }
    if (busca) {
      const contem = { contains: busca, mode: 'insensitive' as const };
      where.candidato = {
        OR: [
          { nome_completo: contem },
          { email: contem },
          { cidade: contem },
        ],
      };
    }

    const cands = await this.prisma.candidatura.findMany({
      where,
      orderBy: [{ inscrito_em: 'desc' }, { criado_em: 'desc' }],
      take: limite,
      select: {
        id: true,
        status: true,
        etapa_gupy: true,
        inscrito_em: true,
        candidato: {
          select: {
            nome_completo: true,
            email: true,
            telefone: true,
            cidade: true,
            estado: true,
          },
        },
        curriculo: { select: { anos_experiencia: true } },
        scores: {
          where: { tipo: { in: ['CONSOLIDADO', 'RANKING_CV'] } },
          select: { tipo: true, valor: true, justificativa: true },
          orderBy: { criado_em: 'desc' },
        },
      },
    });

    const itens = cands.map((c) => {
      const consolidado = c.scores.find((s) => s.tipo === 'CONSOLIDADO');
      const rankingCv = c.scores.find((s) => s.tipo === 'RANKING_CV');
      // Nota IA exibida = melhor disponível: CONSOLIDADO (preferido) e, na sua
      // ausência, RANKING_CV. Candidaturas que têm só o RANKING_CV (estado
      // parcial conhecido na base) tinham nota mas apareciam como "sem nota" —
      // o que escondia a avaliação dos demais usuários. O fallback corrige isso
      // sem mudar a regra de "pendente" (que continua olhando o CONSOLIDADO).
      const notaIA = consolidado ?? rankingCv;
      return {
        candidaturaId: c.id,
        candidatoNome: c.candidato.nome_completo,
        email: c.candidato.email,
        telefone: c.candidato.telefone,
        cidade: c.candidato.cidade,
        estado: c.candidato.estado,
        status: c.status,
        etapaGupy: c.etapa_gupy,
        inscritoEm: c.inscrito_em,
        anosExperiencia: c.curriculo?.anos_experiencia ?? null,
        temCurriculo: c.curriculo != null,
        score: notaIA ? Number(notaIA.valor) : null,
        justificativa: (rankingCv ?? consolidado)?.justificativa ?? null,
      };
    });

    // Classificados (com score) primeiro, do maior para o menor; demais depois.
    itens.sort((a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });

    return {
      vaga: { id: vaga.id, titulo: vaga.titulo, gupyId: vaga.gupy_id.toString() },
      total: itens.length,
      itens,
    };
  }
}
