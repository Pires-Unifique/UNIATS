'use client';

import { useState } from 'react';

import { DisponibilidadePicker } from '@/components/DisponibilidadePicker';
import { api, ApiError } from '@/lib/api';
import { type SlotLivre } from '@/lib/graph';

interface Props {
  candidaturaId: string;
  /** Indica se o candidato consentiu gravação — bot só roda com isso. */
  consentimentoGravacao: boolean;
  /** Gestor/líder da vaga — sugerido como participante (líder técnico). */
  gestorEmail?: string | null;
  gestorNome?: string | null;
  /** Pré-seleciona um horário (ex.: o escolhido pelo candidato na enquete). */
  slotInicial?: { inicio: string; fim: string };
  onClose: () => void;
  onAgendada: () => void;
}

function minutosEntre(inicioIso: string, fimIso: string): number {
  const ms = new Date(fimIso).getTime() - new Date(inicioIso).getTime();
  const min = Math.round(ms / 60_000);
  return min >= 5 && min <= 240 ? min : 30;
}

/**
 * Formulário de agendamento de entrevista. Reusa POST /api/entrevistas.
 * O horário é escolhido DIRETO na agenda (Microsoft Graph) embutida — a grade
 * conecta sozinha, mostra livre/ocupado e permite convidar líderes técnicos
 * (a disponibilidade deles entra no cálculo). A sala pode ser gerada
 * automaticamente no Teams ou informada manualmente por link.
 */
export function AgendarEntrevistaModal({
  candidaturaId,
  consentimentoGravacao,
  gestorEmail,
  gestorNome,
  slotInicial,
  onClose,
  onAgendada,
}: Props) {
  const [agendadaPara, setAgendadaPara] = useState(
    slotInicial ? slotInicial.inicio.slice(0, 16) : '',
  );
  const [duracao, setDuracao] = useState(
    slotInicial ? minutosEntre(slotInicial.inicio, slotInicial.fim) : 30,
  );
  const [meetUrl, setMeetUrl] = useState('');
  // Sala: gerar automaticamente no Teams (padrão) ou informar um link manual.
  const [modoSala, setModoSala] = useState<'gerar' | 'link'>('gerar');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Marcado por padrão: o convite já comunica que aceitar a reunião = consentir
  // com a gravação. Só aparece quando ainda não há consentimento registrado.
  const [registrarConsentimento, setRegistrarConsentimento] = useState(true);

  // Seleção vinda da agenda embutida (maxSlots=1 → um único horário).
  function aplicarSelecao(slots: SlotLivre[]) {
    const s = slots[0];
    if (!s) {
      setAgendadaPara('');
      return;
    }
    setAgendadaPara(s.inicio.slice(0, 16)); // "YYYY-MM-DDTHH:mm"
    setDuracao(minutosEntre(s.inicio, s.fim));
  }

  const urlValida = /^https:\/\//.test(meetUrl);
  const dataValida =
    Boolean(agendadaPara) && !Number.isNaN(new Date(agendadaPara).getTime());
  // "gerar" não exige link; "link" exige https.
  const salaValida = modoSala === 'gerar' || urlValida;
  const pode = salaValida && dataValida && !salvando;

  async function agendar() {
    setSalvando(true);
    setErro(null);
    try {
      await api('/api/entrevistas', {
        method: 'POST',
        body: {
          candidaturaId,
          agendadaPara: new Date(agendadaPara).toISOString(),
          duracaoEstimadaMin: duracao,
          // "gerar" → omite o meetUrl e o backend cria a sala no Teams.
          meetUrl: modoSala === 'link' ? meetUrl : undefined,
          consentirGravacao: !consentimentoGravacao && registrarConsentimento,
        },
      });
      onAgendada();
      onClose();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao agendar.');
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[92vh] w-full max-w-3xl flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-grafite-900">
            Agendar entrevista
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-grafite-400 hover:text-grafite-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {consentimentoGravacao ? (
            <div className="badge-green w-full justify-start px-3 py-2">
              Consentimento de gravação registrado — o bot poderá gravar a
              entrevista.
            </div>
          ) : (
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-grafite-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={registrarConsentimento}
                onChange={(e) => setRegistrarConsentimento(e.target.checked)}
              />
              <span>
                O candidato foi informado no convite e{' '}
                <strong>concorda com a gravação</strong> da entrevista por vídeo
                (necessário para o bot de gravação/transcrição). Desmarque se
                ainda não há consentimento — a entrevista é agendada, mas o bot só
                poderá entrar depois de registrar o consentimento.
              </span>
            </label>
          )}

          {/* Agenda embutida — escolha o horário e convide os líderes técnicos */}
          <div>
            <div className="mb-1 text-xs font-medium text-grafite-700">
              Escolha o horário na agenda
            </div>
            <DisponibilidadePicker
              inline
              maxSlots={1}
              permitirConvidar
              gestorEmail={gestorEmail}
              gestorNome={gestorNome}
              onChange={aplicarSelecao}
            />
          </div>

          {/* Sala da reunião: gerar no Teams ou informar link manualmente */}
          <div>
            <div className="mb-1 text-xs font-medium text-grafite-700">
              Sala da reunião
            </div>
            <div className="flex flex-col gap-1.5 text-sm text-grafite-700">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="modoSala"
                  className="mt-0.5"
                  checked={modoSala === 'gerar'}
                  onChange={() => setModoSala('gerar')}
                />
                <span>
                  <strong>Gerar automaticamente no Teams</strong> — cria a reunião,
                  bloqueia a agenda e envia o convite ao candidato.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="modoSala"
                  className="mt-0.5"
                  checked={modoSala === 'link'}
                  onChange={() => setModoSala('link')}
                />
                <span>Informar um link manualmente (Google Meet ou Teams)</span>
              </label>
            </div>
            {modoSala === 'link' && (
              <label className="mt-2 block">
                <span className="text-xs text-grafite-400">
                  Link da reunião (HTTPS)
                </span>
                <input
                  type="url"
                  className="mt-1 w-full rounded-md border border-grafite-200 px-2 py-1.5 text-sm"
                  value={meetUrl}
                  onChange={(e) => setMeetUrl(e.target.value)}
                  placeholder="https://meet.google.com/… ou https://teams.microsoft.com/…"
                />
                {meetUrl && !urlValida && (
                  <span className="text-xs text-red-600">
                    O link deve começar com https://
                  </span>
                )}
              </label>
            )}
          </div>

          {erro && (
            <div className="badge-red w-full justify-start px-3 py-2">{erro}</div>
          )}
        </div>

        <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
          <span className="text-xs text-grafite-400">
            {dataValida
              ? `Horário escolhido · ${duracao} min`
              : 'Selecione um horário na agenda'}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-soft" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!pode}
              onClick={() => void agendar()}
            >
              {salvando ? 'Agendando…' : 'Agendar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
