import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AnaliseService, type FiltroInterno } from './analise.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Painel analítico do DHO — funil de recrutamento e métricas AGREGADAS de toda
 * a operação. Por ser visão consolidada (não escopada a uma vaga), é restrito à
 * área 'recrutamento' (admin incluso). Gestor não vê o painel global.
 */
@Controller('api/analise')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('recrutamento')
export class AnaliseController {
  constructor(private readonly service: AnaliseService) {}

  @Get('painel')
  async painel(
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('vagaId') vagaId?: string,
    @Query('recrutadorId') recrutadorId?: string,
  ) {
    const f: FiltroInterno = {};

    if (de) f.de = this.parseData(de, 'de');
    if (ate) f.ate = this.parseData(ate, 'ate', true);
    if (f.de && f.ate && f.de > f.ate) {
      throw new BadRequestException('"de" não pode ser maior que "ate".');
    }
    if (vagaId) {
      if (!UUID_REGEX.test(vagaId)) {
        throw new BadRequestException('vagaId inválido.');
      }
      f.vagaId = vagaId;
    }
    if (recrutadorId) {
      if (!UUID_REGEX.test(recrutadorId)) {
        throw new BadRequestException('recrutadorId inválido.');
      }
      f.recrutadorId = recrutadorId;
    }

    return this.service.painel(f);
  }

  @Get('filtros')
  async filtros() {
    return this.service.filtros();
  }

  /** Aceita `YYYY-MM-DD` ou ISO completo. `fimDoDia` empurra para 23:59:59. */
  private parseData(valor: string, campo: string, fimDoDia = false): Date {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`"${campo}" inválido (use YYYY-MM-DD).`);
    }
    if (fimDoDia && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  }
}
