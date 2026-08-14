import { Logger, UnauthorizedException } from '@nestjs/common';

/**
 * Janela anti-replay para webhooks (REQ-API-008).
 *
 * Assinatura válida não impede reenvio: quem capturou uma entrega legítima pode
 * reproduzi-la depois, e o HMAC continua conferindo. A defesa é rejeitar evento
 * velho.
 *
 * ┌─ REGRA QUE DECIDE ONDE USAR ────────────────────────────────────────────┐
 * │ Só vale para timestamp COBERTO PELA ASSINATURA — dentro do corpo        │
 * │ assinado, ou concatenado a ele antes de assinar. Validar um timestamp   │
 * │ que o atacante pode reescrever não protege de nada: ele reenvia o       │
 * │ payload antigo com a data de agora e passa igual.                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * É a SEGUNDA camada. A primeira é a unicidade de `webhooks_recebidos`
 * (provider, external_id), que já barra o reenvio idêntico. Esta janela cobre o
 * que sobra: entrega antiga cujo registro de idempotência já foi expurgado.
 *
 * SOBRE O TIMESTAMP AUSENTE — os schemas tratam o campo como opcional porque
 * nenhum dos provedores garante o campo em TODO tipo de evento. Recusar por
 * ausência sem ter observado os payloads reais derrubaria a ingestão inteira
 * (no WhatsApp, silenciosamente). Então o padrão é: valida quando vem, alerta
 * quando falta. Depois de confirmar nos logs que o campo sempre chega, ligue
 * WEBHOOK_REPLAY_STRICT=true e a ausência passa a ser recusa — sem mexer em
 * código.
 */

/** 5 minutos — o padrão pedido pelo checklist de desenvolvimento seguro. */
export const TOLERANCIA_REPLAY_PADRAO_MS = 5 * 60 * 1000;

const logger = new Logger('AntiReplay');

export interface OpcoesJanela {
  /** Tolerância em ms. Default: 5 min. */
  toleranciaMs?: number;
  /** Recusa quando o timestamp não vem (WEBHOOK_REPLAY_STRICT). */
  estrito?: boolean;
}

export function assertDentroDaJanela(
  timestampMs: number | null | undefined,
  origem: string,
  opts: OpcoesJanela = {},
): void {
  const { toleranciaMs = TOLERANCIA_REPLAY_PADRAO_MS, estrito = false } = opts;

  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    if (estrito) {
      throw new UnauthorizedException(
        `Webhook ${origem} sem timestamp — recusado (modo estrito).`,
      );
    }
    logger.warn(
      `Webhook ${origem} sem timestamp: janela anti-replay não aplicada. ` +
        'A idempotência por external_id segue valendo.',
    );
    return;
  }

  // Valor absoluto de propósito: relógio adiantado no remetente é tão suspeito
  // quanto evento velho, e um timestamp muito no futuro estenderia a validade
  // do payload capturado por todo esse tempo.
  if (Math.abs(Date.now() - timestampMs) > toleranciaMs) {
    throw new UnauthorizedException(
      `Webhook ${origem} fora da janela aceitável (replay?).`,
    );
  }
}
