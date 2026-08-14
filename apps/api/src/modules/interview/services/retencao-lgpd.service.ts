import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@collab/db';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { MARCADOR_PURGADO } from '../../lgpd/retencao.constants.js';
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
        // Apaga o BLOB primeiro. Se isso falhar, o catch abaixo preserva
        // `audio_url` — zerar a referência antes de remover o objeto deixaria
        // o áudio no bucket sem nenhum ponteiro para encontrá-lo (foi o que
        // acontecia enquanto `deleteObject` não existia). Blob ausente conta
        // como sucesso, então o retry do dia seguinte converge.
        await this.storage.deleteObject(e.audio_url);
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
        // Mantém audio_url intacto de propósito: a entrevista volta na janela
        // do próximo cron e tentamos de novo.
        this.logger.warn(
          `Falha ao apagar áudio da entrevista ${e.id} (segue pendente): ${(err as Error).message}`,
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
            texto_completo: MARCADOR_PURGADO,
            segmentos: {} as unknown as object,
            // Motores/fusão guardam o MESMO conteúdo bruto da conversa e
            // nasceram depois desta rotina — sem limpá-los, a retenção de 12
            // meses zerava só a via antiga e o diálogo continuava legível em
            // `texto_fundido` (que é justamente o que a tela exibe).
            // Colunas Json? exigem Prisma.DbNull para virar NULL no banco.
            whisper_segmentos: Prisma.DbNull,
            texto_fundido: null,
            segmentos_fundidos: Prisma.DbNull,
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
