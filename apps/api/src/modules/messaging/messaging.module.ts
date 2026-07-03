import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EnqueteService } from './enquete.service.js';
import { MensagemProcessor } from './processors/mensagem.processor.js';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { SendGridWebhookController } from './webhooks/sendgrid-webhook.controller.js';
import { WahaWebhookController } from './webhooks/waha-webhook.controller.js';
import { WhatsappPacerService } from './whatsapp-pacer.service.js';

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
  imports: [AuthModule],
  controllers: [
    MessagingController,
    WahaWebhookController,
    SendGridWebhookController,
  ],
  providers: [
    MessagingService,
    TemplatesService,
    MensagemProcessor,
    EnqueteService,
    WhatsappPacerService,
  ],
  exports: [
    MessagingService,
    TemplatesService,
    EnqueteService,
    // Pacer exportado para a tela WhatsApp (seção Sistema) exibir cap/janela.
    WhatsappPacerService,
  ],
})
export class MessagingModule {}
