'use client';

import { useState } from 'react';

import { DisponibilidadePicker } from '@/components/DisponibilidadePicker';
import { api, ApiError } from '@/lib/api';
import { graphEnabled, type SlotLivre } from '@/lib/graph';

interface Props {
  candidaturaId: string;
  /** Indica se o candidato consentiu gravação — bot só roda com isso. */
  consentimentoGravacao: boolean;
  /** Gestor/líder da vaga — sugerido como participante (líder técnico). */
  gestorEmail?: string | null;
  gestorNome?: string | null;
  onClose: () => void;
  onAgendada: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  gestorEmail,
  gestorNome,
  onClose,
  onAgendada,
}: Props) {
  const [agendadaPara, setAgendadaPara] = useState('');
  const [duracao, setDuracao] = useState(30);
  const [meetUrl, setMeetUrl] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarPicker, setMostrarPicker] = useState(false);
  // Marcado por padrão: o convite já comunica que aceitar a reunião = consentir
  // com a gravação. Só aparece quando ainda não há consentimento registrado.
  const [registrarConsentimento, setRegistrarConsentimento] = useState(true);

  // Participantes (líderes técnicos): o gestor da vaga vem pré-sugerido e o
  // recrutador pode adicionar outros e-mails. A agenda de TODOS é checada no
  // picker — só sobram horários livres para todo mundo.
  const temGestor = Boolean(gestorEmail && EMAIL_REGEX.test(gestorEmail));
  const [incluirGestor, setIncluirGestor] = useState(true);
  const [extras, setExtras] = useState<string[]>([]);
  const [novoEmail, setNovoEmail] = useState('');

  const participantes: string[] = [
    ...(temGestor && incluirGestor ? [gestorEmail!.trim()] : []),
    ...extras,
  ];

  function adicionarExtra() {
    const e = novoEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(e)) return;
    const jaExiste =
      extras.some((x) => x.toLowerCase() === e) ||
      (temGestor && gestorEmail!.toLowerCase() === e);
    if (!jaExiste) setExtras((prev) => [...prev, novoEmail.trim()]);
    setNovoEmail('');
  }

  function removerExtra(email: string) {
    setExtras((prev) => prev.filter((x) => x !== email));
  }

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

        {consentimentoGravacao ? (
          <div className="badge-green mb-3 px-3 py-2 w-full justify-start">
            Consentimento de gravação registrado — o bot poderá gravar a entrevista.
          </div>
        ) : (
          <label className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-grafite-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={registrarConsentimento}
              onChange={(e) => setRegistrarConsentimento(e.target.checked)}
            />
            <span>
              O candidato foi informado no convite e{' '}
              <strong>concorda com a gravação</strong> da entrevista por vídeo
              (necessário para o bot de gravação/transcrição). Desmarque se ainda
              não há consentimento — a entrevista é agendada, mas o bot só poderá
              entrar depois de registrar o consentimento.
            </span>
          </label>
        )}

        {/* Participantes (líderes técnicos) — agenda checada junto com a do recrutador */}
        <div className="mb-3 rounded-md border border-grafite-200 p-3">
          <div className="text-xs font-medium text-grafite-700 mb-2">
            Participantes (líderes técnicos)
          </div>
          {temGestor && (
            <label className="flex items-start gap-2 text-sm text-grafite-700 mb-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={incluirGestor}
                onChange={(e) => setIncluirGestor(e.target.checked)}
              />
              <span>
                Incluir gestor da vaga
                {gestorNome ? ` — ${gestorNome}` : ''}{' '}
                <span className="text-grafite-400">({gestorEmail})</span>
              </span>
            </label>
          )}

          {extras.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {extras.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-md bg-grafite-100 px-2 py-0.5 text-xs text-grafite-700"
                >
                  {email}
                  <button
                    type="button"
                    onClick={() => removerExtra(email)}
                    className="text-grafite-400 hover:text-red-600"
                    aria-label={`Remover ${email}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="email"
              className="flex-1 border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
              value={novoEmail}
              onChange={(e) => setNovoEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  adicionarExtra();
                }
              }}
              placeholder="adicionar e-mail (ex.: lider@unifique.com.br)"
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!EMAIL_REGEX.test(novoEmail.trim())}
              onClick={adicionarExtra}
            >
              Adicionar
            </button>
          </div>
          <p className="text-xs text-grafite-400 mt-2">
            A disponibilidade de todos os participantes é checada junto com a sua
            ao buscar horários — só aparecem horários livres para todo mundo.
          </p>
        </div>

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
          participantes={participantes}
          onUsar={aplicarSlot}
          onClose={() => setMostrarPicker(false)}
        />
      )}
    </>
  );
}
