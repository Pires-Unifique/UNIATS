'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  WahaPacingConfigDTO,
  WahaQrDTO,
  WahaStatusDTO,
} from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { formatarDataHora } from '@/lib/format';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

  // Configurações de envio (pacing anti-banimento) — editáveis aqui.
  const [cfg, setCfg] = useState<WahaPacingConfigDTO | null>(null);
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  const [cfgOk, setCfgOk] = useState<string | null>(null);

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

  // Config de envio (uma vez, sem poll — quem edita é esta própria tela).
  useEffect(() => {
    api<WahaPacingConfigDTO>('/api/sistema/waha/config')
      .then(setCfg)
      .catch((err) =>
        setErro(err instanceof ApiError ? err.message : 'Falha ao carregar as configurações.'),
      );
  }, []);

  async function salvarCfg() {
    if (!cfg) return;
    setErro(null);
    setCfgOk(null);
    setSalvandoCfg(true);
    try {
      const { padrao_ambiente: _ignorado, ...payload } = cfg;
      const salvo = await api<WahaPacingConfigDTO>('/api/sistema/waha/config', {
        method: 'PUT',
        body: payload,
      });
      setCfg(salvo);
      setCfgOk('Configurações salvas — valem para os próximos envios.');
      await carregarStatus();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar as configurações.');
    } finally {
      setSalvandoCfg(false);
    }
  }

  async function restaurarCfg() {
    setErro(null);
    setCfgOk(null);
    setSalvandoCfg(true);
    try {
      const padrao = await api<WahaPacingConfigDTO>('/api/sistema/waha/config', {
        method: 'DELETE',
      });
      setCfg(padrao);
      setCfgOk('Configurações restauradas ao padrão do ambiente.');
      await carregarStatus();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao restaurar o padrão.');
    } finally {
      setSalvandoCfg(false);
    }
  }

  function alternarDia(dia: number) {
    setCfg((c) =>
      c
        ? {
            ...c,
            janela_dias: c.janela_dias.includes(dia)
              ? c.janela_dias.filter((d) => d !== dia)
              : [...c.janela_dias, dia].sort((a, b) => a - b),
          }
        : c,
    );
  }

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

      {/* Configurações de envio (pacing anti-banimento) */}
      {cfg && (
        <div className="card p-4 mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-grafite-900">Configurações de envio</h2>
              {cfg.padrao_ambiente ? (
                <span className="badge-gray px-2 py-0.5 text-xs">padrão do ambiente</span>
              ) : (
                <span className="badge-blue px-2 py-0.5 text-xs">personalizada</span>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-grafite-600">
              <input
                type="checkbox"
                className="accent-unifique-600"
                checked={cfg.pacing}
                onChange={(e) => setCfg({ ...cfg, pacing: e.target.checked })}
              />
              Pacing ativo (janela, teto e intervalo entre envios)
            </label>
          </div>

          <p className="text-xs text-grafite-400">
            Proteções contra banimento do número. Número novo/frio: comece com
            teto ~30–50/dia e suba aos poucos por semana conforme o número
            “esquenta”.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CampoCfg label="Teto diário (0 = sem teto)">
              <input
                type="number"
                min={0}
                max={5000}
                className="inp"
                value={cfg.cap_diario}
                disabled={!cfg.pacing}
                onChange={(e) =>
                  setCfg({ ...cfg, cap_diario: Number(e.target.value) })
                }
              />
            </CampoCfg>
            <CampoCfg label="Janela — abre às (hora)">
              <input
                type="number"
                min={0}
                max={23}
                className="inp"
                value={cfg.janela_inicio}
                disabled={!cfg.pacing}
                onChange={(e) =>
                  setCfg({ ...cfg, janela_inicio: Number(e.target.value) })
                }
              />
            </CampoCfg>
            <CampoCfg label="Janela — fecha às (hora)">
              <input
                type="number"
                min={1}
                max={24}
                className="inp"
                value={cfg.janela_fim}
                disabled={!cfg.pacing}
                onChange={(e) =>
                  setCfg({ ...cfg, janela_fim: Number(e.target.value) })
                }
              />
            </CampoCfg>
          </div>

          <div>
            <span className="block text-sm font-medium text-grafite-700 mb-2">
              Dias de envio
            </span>
            <div className="flex flex-wrap gap-2">
              {DIAS_SEMANA.map((rotulo, dia) => {
                const marcado = cfg.janela_dias.includes(dia);
                return (
                  <label
                    key={rotulo}
                    className={`inline-flex items-center gap-1.5 border rounded-md px-2.5 py-1 text-sm cursor-pointer transition-colors ${
                      marcado
                        ? 'border-unifique-200 bg-unifique-50 text-unifique-700 dark:bg-unifique-500/15 dark:text-unifique-300 dark:border-unifique-500/40'
                        : 'border-grafite-200 text-grafite-600 hover:bg-grafite-100'
                    } ${!cfg.pacing ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-unifique-600"
                      checked={marcado}
                      disabled={!cfg.pacing}
                      onChange={() => alternarDia(dia)}
                    />
                    {rotulo}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CampoCfg label="Intervalo entre envios — mín (s)">
              <input
                type="number"
                min={0}
                max={3600}
                className="inp"
                value={Math.round(cfg.jitter_min_ms / 1000)}
                disabled={!cfg.pacing}
                onChange={(e) =>
                  setCfg({ ...cfg, jitter_min_ms: Number(e.target.value) * 1000 })
                }
              />
            </CampoCfg>
            <CampoCfg label="Intervalo entre envios — máx (s)">
              <input
                type="number"
                min={0}
                max={3600}
                className="inp"
                value={Math.round(cfg.jitter_max_ms / 1000)}
                disabled={!cfg.pacing}
                onChange={(e) =>
                  setCfg({ ...cfg, jitter_max_ms: Number(e.target.value) * 1000 })
                }
              />
            </CampoCfg>
            <label className="flex items-end gap-2 text-sm text-grafite-600 pb-2.5">
              <input
                type="checkbox"
                className="accent-unifique-600"
                checked={cfg.salvar_contato}
                disabled={!cfg.pacing}
                onChange={(e) => setCfg({ ...cfg, salvar_contato: e.target.checked })}
              />
              Salvar candidato na agenda antes do 1º contato
            </label>
          </div>

          {cfgOk && (
            <div className="badge-green w-full justify-start px-3 py-2">{cfgOk}</div>
          )}

          <div className="flex items-center justify-end gap-2">
            {!cfg.padrao_ambiente && (
              <button
                type="button"
                className="btn-ghost text-sm"
                disabled={salvandoCfg}
                onClick={() => void restaurarCfg()}
              >
                Restaurar padrão do ambiente
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={salvandoCfg}
              onClick={() => void salvarCfg()}
            >
              {salvandoCfg ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      )}

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

function CampoCfg({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-grafite-700 mb-1">{label}</span>
      {children}
    </label>
  );
}

/** "554791234455@c.us" → "+55 47 9123-4455" (best effort; cai no cru se não casar). */
function formatarNumeroWhatsapp(chatId: string): string {
  const digitos = chatId.split('@')[0] ?? chatId;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digitos);
  if (!m) return digitos;
  return `+55 ${m[1]} ${m[2]}-${m[3]}`;
}
