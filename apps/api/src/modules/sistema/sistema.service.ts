import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { WahaQrDTO, WahaStatusDTO } from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { WhatsappPacerService } from '../messaging/whatsapp-pacer.service.js';
import { WahaClient } from '../waha/waha.client.js';

/** Saúde/operação do sistema (por ora, a sessão WhatsApp do WAHA). */
@Injectable()
export class SistemaService {
  private readonly logger = new Logger(SistemaService.name);

  constructor(
    private readonly waha: WahaClient,
    private readonly prisma: PrismaService,
    private readonly pacer: WhatsappPacerService,
  ) {}

  async statusWaha(): Promise<WahaStatusDTO> {
    const pacing = await this.pacer.statusDoDia();
    const base: WahaStatusDTO = {
      configurado: this.waha.configurado,
      sessao: this.waha.nomeSessao,
      status: 'NAO_CONFIGURADO',
      numero: null,
      nome_exibicao: null,
      engine: null,
      ultimo_webhook_em: null,
      ultimo_webhook_evento: null,
      pacing: pacing.pacing_ativo
        ? {
            enviadas_hoje: pacing.enviadas_hoje,
            cap_diario: pacing.cap_diario,
            janela: pacing.janela,
            dentro_janela: pacing.dentro_janela,
          }
        : null,
    };

    // Último evento recebido do WAHA (mostra se o webhook está chegando).
    const ultimoWebhook = await this.prisma.webhookRecebido.findFirst({
      where: { provider: 'waha' },
      orderBy: { recebido_em: 'desc' },
      select: { evento: true, recebido_em: true },
    });
    if (ultimoWebhook) {
      base.ultimo_webhook_em = ultimoWebhook.recebido_em.toISOString();
      base.ultimo_webhook_evento = ultimoWebhook.evento;
    }

    if (!this.waha.configurado) return base;

    try {
      const s = await this.waha.statusSessao();
      return {
        ...base,
        status: s.status,
        numero: s.me?.id ?? null,
        nome_exibicao: s.me?.pushName ?? null,
        engine: s.engine,
      };
    } catch (err) {
      // WAHA fora do ar ≠ erro da nossa API: o status é a informação.
      this.logger.warn(`Status WAHA indisponível: ${(err as Error).message}`);
      return { ...base, status: 'INDISPONIVEL' };
    }
  }

  async qrWaha(): Promise<WahaQrDTO> {
    if (!this.waha.configurado) {
      throw new ServiceUnavailableException(
        'WAHA não configurado neste ambiente (WAHA_BASE_URL/WAHA_API_KEY).',
      );
    }
    const base64 = await this.waha.qrPareamento();
    return { image: `data:image/png;base64,${base64}` };
  }

  async reiniciarWaha(autor: UsuarioAutenticado): Promise<{ ok: true }> {
    if (!this.waha.configurado) {
      throw new ServiceUnavailableException(
        'WAHA não configurado neste ambiente (WAHA_BASE_URL/WAHA_API_KEY).',
      );
    }
    await this.waha.reiniciarSessao();
    this.logger.log(`Sessão WAHA reiniciada por ${autor.email}.`);
    try {
      await this.prisma.registroAuditoria.create({
        data: {
          usuario_id: autor.chave_api ? null : autor.id,
          acao: 'waha_sessao_reiniciada',
          entidade: 'sistema',
          diff: { sessao: this.waha.nomeSessao },
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao auditar restart do WAHA: ${(err as Error).message}`);
    }
    return { ok: true };
  }
}
