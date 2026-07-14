-- Watchdog do WAHA: novo tipo de notificação para alertar ADMINS quando a sessão
-- WhatsApp trava em "WORKING zumbi" (conectada, mas sem emitir eventos — nenhum
-- webhook chega e o status não muda, então ninguém percebe).
-- Aditiva: só adiciona um valor ao enum existente. Não altera dados existentes.

-- AlterEnum
ALTER TYPE "tipo_notificacao" ADD VALUE 'WHATSAPP_INSTAVEL';
