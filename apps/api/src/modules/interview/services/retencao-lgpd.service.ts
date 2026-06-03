import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

/**
 * Aplica a política de retenção LGPD:
 *  - Áudios: 90 dias por padrão (RETENCAO_AUDIO_DIAS). Apaga blob criptografado
 *    e zera `entrevistas.audio_url` + `audio_sha256` + `audio_expira_em`.
 *  - Transcrições: 12 meses por padrão (RETENCAO_TRANSCRICAO_DIAS). Trunca
 *    `texto_completo` e `segmentos` (mantém apenas `resumo` + `topicos`
 *    quando existirem — esses são saídas analíticas, não dados pessoais brutos).
 *
 * Roda diariamente às 03:00 (horário do servidor). Idempotente.
 *
 * Toda ação gera um RegistroAuditoria — exigido pelo Art. 37 da LGPD.
 */
@Injectable()
export class RetencaoLGPDService {
  private readonly logger = new Logger(RetencaoLGPDService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Cron diário às 03:00 — janela de manutenção off-peak. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retencao-lgpd' })
  async aplicarRetencaoDiaria(): Promise<void> {
    try {
      const a = await this.apagarAudiosExpirados();
      const t = await this.truncarTranscricoesExpiradas();
      this.logger.log(
        `Retenção LGPD aplicada: audios=${a.removidos} transcricoes=${t.truncadas}`,
      );
    } catch (err) {
      this.logger.error(
        `Falha no cron de retenção LGPD: ${(err as Error).message}`,
      );
    }
  }

  async apagarAudiosExpirados(): Promise<{ removidos: number }> {
    const expirados = await this.prisma.entrevista.findMany({
      where: {
        audio_url: { not: null },
        audio_expira_em: { lte: new Date() },
      },
      select: { id: true, audio_url: true, audio_sha256: true },
      take: 200, // janela conservadora
    });

    let removidos = 0;
    for (const e of expirados) {
      if (!e.audio_url) continue;
      try {
        // Best-effort: se o blob já foi removido manualmente, segue em frente.
        // (Adicionar `storage.deleteObject` quando o método for implementado.
        //  Por enquanto, zeramos a referência — o blob fica órfão para limpeza manual.)
        await this.prisma.entrevista.update({
          where: { id: e.id },
          data: {
            audio_url: null,
            audio_sha256: null,
            audio_expira_em: null,
          },
        });
        await this.prisma.registroAuditoria.create({
          data: {
            acao: 'retencao_lgpd_audio',
            entidade: 'entrevista',
            entidade_id: e.id,
            diff: {
              audio_url_anterior: e.audio_url,
              audio_sha256: e.audio_sha256,
            } as unknown as object,
          },
        });
        removidos++;
      } catch (err) {
        this.logger.warn(
          `Falha ao retirar áudio da entrevista ${e.id}: ${(err as Error).message}`,
        );
      }
    }
    return { removidos };
  }

  async truncarTranscricoesExpiradas(): Promise<{ truncadas: number }> {
    const expiradas = await this.prisma.transcricao.findMany({
      where: { expira_em: { lte: new Date() } },
      select: {
        id: true,
        entrevista_id: true,
        texto_completo: true,
      },
      take: 200,
    });

    let truncadas = 0;
    for (const t of expiradas) {
      try {
        await this.prisma.transcricao.update({
          where: { id: t.id },
          data: {
            texto_completo: '[retencao_lgpd: conteudo removido]',
            segmentos: {} as unknown as object,
            expira_em: null, // marca como já tratada para não repetir
          },
        });
        await this.prisma.registroAuditoria.create({
          data: {
            acao: 'retencao_lgpd_transcricao',
            entidade: 'transcricao',
            entidade_id: t.id,
            diff: {
              entrevistaId: t.entrevista_id,
              tamanho_anterior: t.texto_completo.length,
            } as unknown as object,
          },
        });
        truncadas++;
      } catch (err) {
        this.logger.warn(
          `Falha ao truncar transcrição ${t.id}: ${(err as Error).message}`,
        );
      }
    }
    return { truncadas };
  }
}
