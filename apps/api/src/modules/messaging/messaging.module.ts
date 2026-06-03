import { Module } from '@nestjs/common';

import { MensagemProcessor } from './processors/mensagem.processor.js';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { SendGridWebhookController } from './webhooks/sendgrid-webhook.controller.js';
import { WahaWebhookController } from './webhooks/waha-webhook.controller.js';

/**
 * Camada 4a — Mensageria.
 *
 * Composição:
 *  - WAHA (WhatsApp HTTP API self-hosted) e SendGrid (e-mail).
 *  - Templates editáveis no banco (TemplatesService), com placeholders escapados.
 *  - Worker BullMQ na fila `mensagem`, fallback automático WhatsApp→Email.
 *  - Webhooks autenticados (HMAC para WAHA, ECDSA para SendGrid).
 *
 * Depende dos módulos globais WahaModule + SendGridModule.
 */
@Module({
  controllers: [
    MessagingController,
    WahaWebhookController,
    SendGridWebhookController,
  ],
  providers: [MessagingService, TemplatesService, MensagemProcessor],
  exports: [MessagingService, TemplatesService],
})
export class MessagingModule {}
