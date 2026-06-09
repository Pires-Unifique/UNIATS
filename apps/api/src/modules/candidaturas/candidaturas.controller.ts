import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
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
            gupy_id: true, // jobId na Gupy — necessário p/ listar/mover etapas
            titulo: true,
            status: true,
            // Gestor/líder da vaga — sugerido como participante (líder técnico)
            // no agendamento da entrevista para checar a disponibilidade dele.
            gestor: { select: { nome: true, email: true } },
            recrutador: { select: { nome: true, email: true } },
          },
        },
      },
    });
    if (!c) throw new NotFoundException(`Candidatura ${id} não existe.`);
    // BigInt → string para serialização JSON (gupy_id não é serializável nativamente).
    return {
      ...c,
      gupy_id: c.gupy_id.toString(),
      vaga: { ...c.vaga, gupy_id: c.vaga.gupy_id.toString() },
    };
  }

  /**
   * Registra (ou revoga) o consentimento de GRAVAÇÃO de voz/vídeo do candidato.
   * Dado sensível — exige consentimento específico (separado do consentimento
   * geral). Sem ele, o bot de gravação/transcrição não pode entrar na entrevista.
   */
  @Post(':id/consentimento-gravacao')
  async consentimentoGravacao(
    @Param('id') id: string,
    @Body() body: { consentir?: boolean },
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    if (typeof body?.consentir !== 'boolean') {
      throw new BadRequestException('consentir (boolean) é obrigatório.');
    }
    const cand = await this.prisma.candidatura.findUnique({
      where: { id },
      select: { candidato_id: true },
    });
    if (!cand) throw new NotFoundException(`Candidatura ${id} não existe.`);
    const candidato = await this.prisma.candidato.update({
      where: { id: cand.candidato_id },
      data: {
        consentimento_gravacao_em: body.consentir ? new Date() : null,
      },
      select: { consentimento_gravacao_em: true },
    });
    return { consentimento_gravacao_em: candidato.consentimento_gravacao_em };
  }
}
