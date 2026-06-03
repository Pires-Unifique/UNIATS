'use client';

import { useState } from 'react';

import { DisponibilidadePicker } from '@/components/DisponibilidadePicker';
import { api, ApiError } from '@/lib/api';
import { graphEnabled, type SlotLivre } from '@/lib/graph';

interface Props {
  candidaturaId: string;
  /** Indica se o candidato consentiu gravação — bot só roda com isso. */
  consentimentoGravacao: boolean;
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
 * O recrutador pode puxar os horários LIVRES da própria agenda (Microsoft Graph,
 * popup sob demanda) e escolher um — preenche data/hora e duração sem digitar.
 * O link de vídeo (Google Meet ou Teams) é colado manualmente nesta fase.
 */
export function AgendarEntrevistaModal({
  candidaturaId,
  consentimentoGravacao,
  onClose,
  onAgendada,
}: Props) {
  const [agendadaPara, setAgendadaPara] = useState('');
  const [duracao, setDuracao] = useState(30);
  const [meetUrl, setMeetUrl] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarPicker, setMostrarPicker] = useState(false);

  function aplicarSlot(slots: SlotLivre[]) {
    const s = slots[0];
    if (!s) return;
    setAgendadaPara(s.inicio.slice(0, 16)); // "YYYY-MM-DDTHH:mm" p/ datetime-local
    setDuracao(minutosEntre(s.inicio, s.fim));
  }

  const urlValida = /^https:\/\//.test(meetUrl);
  const dataValida = Boolean(agendadaPara) && !Number.isNaN(new Date(agendadaPara).getTime());
  const pode = urlValida && dataValida && duracao >= 5 && duracao <= 240 && !salvando;

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
          meetUrl,
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
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
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

        {!consentimentoGravacao && (
          <div className="badge-yellow mb-3 px-3 py-2 w-full justify-start">
            Sem consentimento de gravação: a entrevista é agendada, mas o bot de
            gravação não poderá entrar até o candidato consentir.
          </div>
        )}

        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setMostrarPicker(true)}
          >
            📅 Buscar horários da minha agenda
          </button>
          <span className="text-xs text-grafite-400">
            {graphEnabled()
              ? 'Escolha um horário livre e preencha data/hora automaticamente.'
              : 'Agenda ainda não configurada (ver infra/app registration).'}
          </span>
        </div>

        <label className="block mb-3">
          <span className="text-xs text-grafite-400">Data e hora</span>
          <input
            type="datetime-local"
            className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
            value={agendadaPara}
            onChange={(e) => setAgendadaPara(e.target.value)}
          />
        </label>

        <label className="block mb-3">
          <span className="text-xs text-grafite-400">Duração (min)</span>
          <input
            type="number"
            min={5}
            max={240}
            className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
            value={duracao}
            onChange={(e) => setDuracao(Number(e.target.value))}
          />
        </label>

        <label className="block mb-3">
          <span className="text-xs text-grafite-400">
            Link da reunião (Google Meet ou Teams — HTTPS)
          </span>
          <input
            type="url"
            className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            placeholder="https://meet.google.com/… ou https://teams.microsoft.com/…"
          />
          {meetUrl && !urlValida && (
            <span className="text-xs text-red-600">O link deve começar com https://</span>
          )}
        </label>

        {erro && (
          <div className="badge-red mb-2 px-3 py-2 w-full justify-start">
            {erro}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
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

      {mostrarPicker && (
        <DisponibilidadePicker
          maxSlots={1}
          onUsar={aplicarSlot}
          onClose={() => setMostrarPicker(false)}
        />
      )}
    </>
  );
}
