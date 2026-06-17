import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { QUEUE_NAMES } from '../../../queue/queue.module.js';

const BodySchema = z.object({
  entrevistaId: z.string().uuid(),
  texto: z.string().min(1),
  segmentos: z
    .array(
      z.object({
        inicio_ms: z.number().int().nonnegative(),
        falante: z.string(),
        texto: z.string(),
      }),
    )
    .default([]),
  entrou: z.boolean().optional(),
  legendasLigadas: z.boolean().optional(),
});

/**
 * Callback interno do bot Playwright (rede privada — fora de /api).
 *
 * Recebe a transcrição capturada das legendas, valida o segredo compartilhado e
 * enfileira a persistência (`PLAYWRIGHT_TRANSCRICAO`) — que grava `Transcricao`
 * (provider=playwright) e dispara a ATA via Claude, sem bloquear esta resposta.
 */
@Controller('internal/playwright')
export class PlaywrightCallbackController {
  private readonly logger = new Logger(PlaywrightCallbackController.name);
  private readonly secret?: string;

  constructor(
    config: ConfigService,
    @InjectQueue(QUEUE_NAMES.PLAYWRIGHT_TRANSCRICAO)
    private readonly fila: Queue,
  ) {
    this.secret = config.get<string>('PLAYWRIGHT_CALLBACK_SECRET');
  }

  @Post('transcript')
  @HttpCode(202)
  async receber(
    @Headers('x-playwright-secret') assinatura: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: string }> {
    if (!this.secret) {
      throw new ServiceUnavailableException(
        'PLAYWRIGHT_CALLBACK_SECRET não configurado — callback recusado.',
      );
    }
    this.verificarSegredo(assinatura);

    const dados = BodySchema.parse(body);
    await this.fila.add(
      'persistir',
      {
        entrevistaId: dados.entrevistaId,
        texto: dados.texto,
        segmentos: dados.segmentos,
      },
      { jobId: `playwright-transcricao-${dados.entrevistaId}` },
    );
    this.logger.log(
      `Transcrição Playwright recebida: entrevista=${dados.entrevistaId} ` +
        `segmentos=${dados.segmentos.length} chars=${dados.texto.length}`,
    );
    return { status: 'ok' };
  }

  private verificarSegredo(assinatura?: string): void {
    if (!assinatura) throw new UnauthorizedException('Segredo ausente.');
    const a = Buffer.from(assinatura);
    const b = Buffer.from(this.secret!);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Segredo inválido.');
    }
  }
}
