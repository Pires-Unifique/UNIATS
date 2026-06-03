import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { CurriculoService } from './curriculo.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Endpoints REST para inspeção e reprocessamento de currículos.
 * Autorização real (Azure AD + RBAC) será aplicada quando o módulo de auth subir;
 * por ora, ThrottlerGuard reduz superfície de abuso.
 */
@Controller('api/curriculos')
@UseGuards(ThrottlerGuard)
export class CurriculoController {
  constructor(private readonly service: CurriculoService) {}

  @Get(':candidaturaId')
  async obter(@Param('candidaturaId') candidaturaId: string) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId deve ser um UUID válido.');
    }
    return this.service.buscarPorCandidatura(candidaturaId);
  }

  @Post(':candidaturaId/reprocessar')
  async reprocessar(@Param('candidaturaId') candidaturaId: string) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId deve ser um UUID válido.');
    }
    return this.service.reprocessar(candidaturaId);
  }
}
