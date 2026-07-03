'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WahaQrDTO, WahaStatusDTO } from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { formatarDataHora } from '@/lib/format';

/** Poll do status (ms). Leve: 1 GET no WAHA via nossa API. */
const POLL_STATUS_MS = 10_000;
/** Renovação do QR (ms) — o código expira sozinho no WhatsApp. */
const POLL_QR_MS = 20_000;

const ESTADOS: Record<string, { rotulo: string; classe: string }> = {
  WORKING: { rotulo: 'Conectado', classe: 'badge-green' },
  SCAN_QR_CODE: { rotulo: 'Aguardando pareamento', classe: 'badge-yellow' },
  STARTING: { rotulo: 'Iniciando…', classe: 'badge-yellow' },
  STOPPED: { rotulo: 'Parado', classe: 'badge-red' },
  FAILED: { rotulo: 'Falha na sessão', classe: 'badge-red' },
  NAO_CONFIGURADO: { rotulo: 'Não configurado', classe: 'badge-gray' },
  INDISPONIVEL: { rotulo: 'WAHA indisponível', classe: 'badge-red' },
};

export default function WhatsappPage() {
  const [status, setStatus] = useState<WahaStatusDTO | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  // Evita sobrepor busca de QR quando a anterior ainda não voltou.
  const buscandoQr = useRef(false);

  const carregarStatus = useCallback(async () => {
    try {
      const s = await api<WahaStatusDTO>('/api/sistema/waha/status');
      setStatus(s);
      setErro(null);
      if (s.status !== 'SCAN_QR_CODE') setQr(null);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao consultar o status.');
    }
  }, []);

  const carregarQr = useCallback(async () => {
    if (buscandoQr.current) return;
    buscandoQr.current = true;
    try {
      const r = await api<WahaQrDTO>('/api/sistema/waha/qr');
      setQr(r.image);
    } catch {
      // QR indisponível (ex.: estado mudou entre polls) — o status manda.
      setQr(null);
    } finally {
      buscandoQr.current = false;
    }
  }, []);

  // Poll do status.
  useEffect(() => {
    void carregarStatus();
    const timer = setInterval(() => void carregarStatus(), POLL_STATUS_MS);
    return () => clearInterval(timer);
  }, [carregarStatus]);

  // Busca/renova o QR enquanto o estado pedir pareamento.
  useEffect(() => {
    if (status?.status !== 'SCAN_QR_CODE') return;
    void carregarQr();
    const timer = setInterval(() => void carregarQr(), POLL_QR_MS);
    return () => clearInterval(timer);
  }, [status?.status, carregarQr]);

  async function atualizarAgora() {
    setAtualizando(true);
    await carregarStatus();
    setAtualizando(false);
  }

  async function reiniciar() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Reiniciar a sessão do WhatsApp? Envios em andamento podem atrasar até reconectar.',
      )
    ) {
      return;
    }
    setErro(null);
    setReiniciando(true);
    try {
      await api('/api/sistema/waha/restart', { method: 'POST' });
      await carregarStatus();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao reiniciar a sessão.');
    } finally {
      setReiniciando(false);
    }
  }

  const estado = ESTADOS[status?.status ?? ''] ?? {
    rotulo: status?.status ?? 'Carregando…',
    classe: 'badge-gray',
  };

  return (
    <div>
      <PageHeader
        titulo="WhatsApp"
        subtitulo="Conexão usada para conversar com candidatos (mensagens, enquetes de horário, arquivos). Se a sessão cair, os envios param — aqui você acompanha o estado e resolve o pareamento sem acessar o servidor."
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-grafite-900">Sessão do WhatsApp</h2>
            <span className={`${estado.classe} px-2.5 py-0.5`}>{estado.rotulo}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-soft text-xs"
              disabled={atualizando}
              onClick={() => void atualizarAgora()}
            >
              {atualizando ? 'Atualizando…' : 'Atualizar'}
            </button>
            {status?.configurado && (
              <button
                type="button"
                className="btn-soft-danger text-xs"
                disabled={reiniciando}
                onClick={() => void reiniciar()}
              >
                {reiniciando ? 'Reiniciando…' : 'Reiniciar sessão'}
              </button>
            )}
          </div>
        </div>

        {status && !status.configurado && (
          <p className="text-sm text-grafite-500">
            WAHA não configurado neste ambiente (defina WAHA_BASE_URL e
            WAHA_API_KEY). Em dev, suba o serviço do docker-compose.
          </p>
        )}

        {status?.configurado && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-grafite-400">Número</dt>
            <dd className="text-grafite-700">
              {status.numero
                ? `${formatarNumeroWhatsapp(status.numero)}${status.nome_exibicao ? ` · "${status.nome_exibicao}"` : ''}`
                : '—'}
            </dd>
            <dt className="text-grafite-400">Sessão</dt>
            <dd className="text-grafite-700">
              {status.sessao}
              {status.engine ? ` · engine ${status.engine}` : ''}
            </dd>
            <dt className="text-grafite-400">Webhook</dt>
            <dd className="text-grafite-700">
              {status.ultimo_webhook_em ? (
                <>
                  último evento <code className="text-xs bg-grafite-100 rounded px-1">{status.ultimo_webhook_evento}</code>{' '}
                  em {formatarDataHora(status.ultimo_webhook_em)}
                </>
              ) : (
                'nenhum evento recebido ainda'
              )}
            </dd>
            {status.pacing && (
              <>
                <dt className="text-grafite-400">Envios hoje</dt>
                <dd className="text-grafite-700">
                  {status.pacing.enviadas_hoje}
                  {status.pacing.cap_diario != null && (
                    <> / {status.pacing.cap_diario} (teto diário)</>
                  )}
                  {' · '}janela {status.pacing.janela}{' '}
                  {status.pacing.dentro_janela ? (
                    <span className="badge-green px-2 py-0.5 text-xs">aberta</span>
                  ) : (
                    <span className="badge-gray px-2 py-0.5 text-xs">
                      fechada — envios aguardam
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>
        )}
      </div>

      {status?.status === 'SCAN_QR_CODE' && (
        <div className="card p-4 mt-4">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            <div className="flex-1 min-w-0 space-y-2">
              <h2 className="font-semibold text-grafite-900">Parear aparelho</h2>
              <p className="text-sm text-grafite-600">
                Escaneie o QR ao lado com o WhatsApp do número oficial:{' '}
                <strong>
                  Configurações → Dispositivos conectados → Conectar um aparelho
                </strong>
                .
              </p>
              <p className="text-xs text-grafite-400">
                O código expira e é renovado automaticamente a cada{' '}
                {POLL_QR_MS / 1000} segundos enquanto esta tela estiver aberta.
                Assim que parear, o status muda para “Conectado”.
              </p>
            </div>
            <div className="bg-[#fff] border border-grafite-200 rounded-lg p-3 shrink-0">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR code de pareamento do WhatsApp" width={192} height={192} />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-xs text-grafite-400">
                  Carregando QR…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "554791234455@c.us" → "+55 47 9123-4455" (best effort; cai no cru se não casar). */
function formatarNumeroWhatsapp(chatId: string): string {
  const digitos = chatId.split('@')[0] ?? chatId;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  if (!m) return digitos;
  return `+55 ${m[1]} ${m[2]}-${m[3]}`;
}
