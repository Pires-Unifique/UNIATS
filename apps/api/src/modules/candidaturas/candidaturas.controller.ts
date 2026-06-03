import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { PrismaService } from '../../prisma/prisma.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Endpoint agregado de candidatura para a UI — devolve currículo + scores +
 * entrevistas em uma só request. Mantém o frontend simples.
 */
@Controller('api/candidaturas')
@UseGuards(ThrottlerGuard)
export class CandidaturasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async detalhe(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    const c = await this.prisma.candidatura.findUnique({
      where: { id },
      include: {
        candidato: {
          select: {
            id: true,
            nome_completo: true,
            email: true,
            telefone: true,
            cidade: true,
            estado: true,
            linkedin_url: true,
            consentimento_lgpd_em: true,
            consentimento_gravacao_em: true,
            excluido_em: true,
          },
        },
        curriculo: {
          select: {
            id: true,
            candidato_id: true,
            candidatura_id: true,
            arquivo_sha256: true,
            resumo: true,
            experiencias: true,
            formacoes: true,
            competencias: true,
            idiomas: true,
            certificacoes: true,
            anos_experiencia: true,
            parser_versao: true,
            processado_em: true,
            atualizado_em: true,
          },
        },
        scores: {
          orderBy: { criado_em: 'desc' },
          select: {
            tipo: true,
            valor: true,
            justificativa: true,
            evidencias: true,
            modelo: true,
            prompt_versao: true,
            revisado_por: true,
            revisado_em: true,
            criado_em: true,
          },
        },
        entrevistas: {
          orderBy: { agendada_para: 'desc' },
          select: {
            id: true,
            agendada_para: true,
            duracao_estimada_min: true,
            status: true,
            bot_status: true,
            meet_url: true,
            iniciada_em: true,
            finalizada_em: true,
          },
        },
        vaga: {
          select: {
            id: true,
            titulo: true,
            status: true,
          },
        },
      },
    });
    if (!c) throw new NotFoundException(`Candidatura ${id} não existe.`);
    // BigInt → string para serialização JSON (gupy_id não é serializável nativamente).
    return { ...c, gupy_id: c.gupy_id.toString() };
  }
}
