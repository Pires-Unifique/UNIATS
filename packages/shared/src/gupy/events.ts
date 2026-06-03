import { z } from 'zod';
import {
  CandidaturaGupySchema,
  VagaGupySchema,
} from './schemas.js';

/**
 * Eventos de webhook da Gupy que ativamos no MVP.
 * Mantemos `event` como literal para fazer discriminated union.
 */

export const WebhookGupyEventoEnum = z.enum([
  'application.created',
  'application.moved',
  'application.hired',
  'application.rejected',
  'job.published',
  'job.updated',
]);

export type WebhookGupyEvento = z.infer<typeof WebhookGupyEventoEnum>;

const baseWebhook = z.object({
  event: WebhookGupyEventoEnum,
  // Gupy envia um id único por entrega — usado para idempotência.
  // Em algumas integrações o header também traz; preferimos o que estiver presente.
  eventId: z.string().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export const WebhookApplicationSchema = baseWebhook.extend({
  event: z.enum([
    'application.created',
    'application.moved',
    'application.hired',
    'application.rejected',
  ]),
  data: CandidaturaGupySchema,
});

export const WebhookJobSchema = baseWebhook.extend({
  event: z.enum(['job.published', 'job.updated']),
  data: VagaGupySchema,
});

export const WebhookGupySchema = z.discriminatedUnion('event', [
  WebhookApplicationSchema.shape.event instanceof z.ZodLiteral
    ? (WebhookApplicationSchema as any)
    : (WebhookApplicationSchema as any),
  WebhookJobSchema as any,
]);

// Versão "permissiva" — primeiro parse só para extrair o `event`,
// e depois o schema específico. Mais robusto do que discriminatedUnion
// quando o payload tem variações sutis.
export const WebhookGupyInvolucroSchema = z
  .object({
    event: WebhookGupyEventoEnum,
    eventId: z.string().optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    data: z.unknown(),
  })
  .passthrough();

export type WebhookGupyInvolucro = z.infer<typeof WebhookGupyInvolucroSchema>;
