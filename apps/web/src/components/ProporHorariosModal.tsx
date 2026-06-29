'use client';

import { useState } from 'react';

import { DisponibilidadePicker } from '@/components/DisponibilidadePicker';
import { api, ApiError } from '@/lib/api';
import { type SlotLivre } from '@/lib/graph';

interface Props {
  candidaturaId: string;
  /** Gestor/líder da vaga — pode ser convidado p/ a agenda considerar a disponibilidade dele. */
  gestorEmail?: string | null;
  gestorNome?: string | null;
  onClose: () => void;
  onEnviada: () => void;
}

const MAX_OPCOES = 5;

/**
 * Propõe horários ao candidato via ENQUETE do WhatsApp. O recrutador escolhe
 * 2–5 horários livres na agenda (estilo Teams) e envia — o candidato vota e a
 * escolha volta automaticamente (webhook poll.vote) para o recrutador agendar.
 */
export function ProporHorariosModal({
  candidaturaId,
  gestorEmail,
  gestorNome,
  onClose,
  onEnviada,
}: Props) {
  const [slots, setSlots] = useState<SlotLivre[]>([]);
  // Convidados (gestor incluído + extras) — pré-reservamos a agenda deles também.
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pode = slots.length >= 2 && slots.length <= MAX_OPCOES && !enviando;

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      await api('/api/mensagens/enquete-horarios', {
        method: 'POST',
        body: {
          candidaturaId,
          opcoes: slots.map((s) => ({
            rotulo: s.rotulo,
            inicio: s.inicio,
            fim: s.fim,
          })),
          // Participantes convidados → suas agendas também são pré-reservadas e
          // eles entram na reunião ao confirmar.
          participantes,
        },
      });
      onEnviada();
      onClose();
    } catch (err) {
      setErro(
        err instanceof ApiError ? err.message : 'Falha ao enviar a enquete.',
      );
      setEnviando(false);
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
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-grafite-900">
            Propor horários ao candidato
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
        <p className="mb-3 text-xs text-grafite-400">
          Escolha de 2 a {MAX_OPCOES} horários livres. Enviamos uma{' '}
          <strong>enquete no WhatsApp</strong> e o candidato vota — a escolha
          aparece aqui automaticamente para você agendar.
        </p>

        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <DisponibilidadePicker
            inline
            maxSlots={MAX_OPCOES}
            permitirConvidar
            gestorEmail={gestorEmail}
            gestorNome={gestorNome}
            onChange={setSlots}
            onParticipantesChange={setParticipantes}
          />
        </div>

        {erro && (
          <div className="badge-red mt-2 w-full justify-start px-3 py-2">
            {erro}
          </div>
        )}

        <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
          <span className="text-xs text-grafite-400">
            {slots.length < 2
              ? 'Selecione ao menos 2 horários'
              : `${slots.length} horário(s) na enquete`}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-soft" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!pode}
              onClick={() => void enviar()}
            >
              {enviando ? 'Enviando…' : 'Enviar enquete no WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
