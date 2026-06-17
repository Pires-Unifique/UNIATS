import axios from 'axios';

import type { Segmento } from './teams-meeting.js';

export interface CallbackPayload {
  entrevistaId: string;
  texto: string;
  segmentos: Segmento[];
  entrou: boolean;
  legendasLigadas: boolean;
}

/**
 * Devolve a transcrição capturada para a API (callback interno, rede privada).
 * A API valida o segredo, persiste `Transcricao` (provider=playwright) e dispara
 * a ATA via Claude — mesmo pipeline do Graph.
 */
export async function enviarTranscricao(
  baseUrl: string,
  secret: string,
  payload: CallbackPayload,
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/internal/playwright/transcript`;
  await axios.post(url, payload, {
    headers: { 'x-playwright-secret': secret },
    timeout: 30_000,
  });
}
