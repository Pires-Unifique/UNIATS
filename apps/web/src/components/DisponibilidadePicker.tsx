'use client';

import { useMemo, useState } from 'react';

import {
  emailAgendaFixo,
  graphEnabled,
  obterDisponibilidade,
  type SlotLivre,
} from '@/lib/graph';

interface Props {
  /** Quantos horários o recrutador deve escolher (= nº de variáveis opcao_N). */
  maxSlots: number;
  /**
   * E-mails extras (líderes técnicos/gestor) cuja agenda também é checada — só
   * sobram os horários livres para o recrutador E todos eles.
   */
  participantes?: string[];
  onUsar: (slots: SlotLivre[]) => void;
  onClose: () => void;
}

const HORA_INICIO = 7;
const HORA_FIM = 19;

/**
 * Lê a agenda do recrutador (Microsoft Graph, delegado) e mostra os horários
 * LIVRES para ele apenas CLICAR e selecionar — sem digitar nada. Os escolhidos
 * voltam para o convite (variáveis opcao_1..N).
 */
export function DisponibilidadePicker({
  maxSlots,
  participantes = [],
  onUsar,
  onClose,
}: Props) {
  const habilitado = graphEnabled();
  const [duracaoMin, setDuracaoMin] = useState(30);
  const [diasUteis, setDiasUteis] = useState(7);
  const [slots, setSlots] = useState<SlotLivre[]>([]);
  const [sel, setSel] = useState<string[]>([]); // por `inicio`
  const [carregando, setCarregando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    setCarregando(true);
    setErro(null);
    setSel([]);
    try {
      const livres = await obterDisponibilidade(
        {
          duracaoMin,
          diasUteis,
          horaInicio: HORA_INICIO,
          horaFim: HORA_FIM,
        },
        participantes,
      );
      setSlots(livres);
      setBuscou(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao ler a agenda.');
    } finally {
      setCarregando(false);
    }
  }

  function toggle(inicio: string) {
    setSel((s) => {
      if (s.includes(inicio)) return s.filter((x) => x !== inicio);
      if (s.length >= maxSlots) return s; // respeita o limite
      return [...s, inicio];
    });
  }

  // Agrupa por dia para exibição.
  const porDia = useMemo(() => {
    const m = new Map<string, SlotLivre[]>();
    for (const s of slots) {
      const dia = s.inicio.slice(0, 10);
      const arr = m.get(dia) ?? [];
      arr.push(s);
      m.set(dia, arr);
    }
    return [...m.entries()];
  }, [slots]);

  function confirmar() {
    const escolhidos = sel
      .map((i) => slots.find((s) => s.inicio === i))
      .filter((s): s is SlotLivre => Boolean(s));
    onUsar(escolhidos);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-grafite-900">
            Horários livres na minha agenda
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

        {!habilitado ? (
          <div className="badge-yellow px-3 py-2 w-full justify-start">
            Integração com a agenda ainda não configurada. Peça à infra um
            <strong className="mx-1">app registration</strong>no Entra ID (tipo SPA,
            redirect <code>http://localhost:3000</code>, permissão delegada
            <code className="mx-1">Calendars.Read</code>) e preencha
            <code className="mx-1">NEXT_PUBLIC_AZURE_AD_CLIENT_ID</code>/
            <code>NEXT_PUBLIC_AZURE_AD_TENANT_ID</code>. Detalhes em
            <code className="ml-1">docs/agendamento-teams.md</code>.
          </div>
        ) : (
          <>
            {/* Controles */}
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <label className="block">
                <span className="text-xs text-grafite-400">Duração</span>
                <select
                  className="mt-1 block border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={duracaoMin}
                  onChange={(e) => setDuracaoMin(Number(e.target.value))}
                >
                  <option value={30}>30 minutos</option>
                  <option value={60}>1 hora</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-grafite-400">Período</span>
                <select
                  className="mt-1 block border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={diasUteis}
                  onChange={(e) => setDiasUteis(Number(e.target.value))}
                >
                  <option value={5}>Próximos 5 dias úteis</option>
                  <option value={7}>Próximos 7 dias úteis</option>
                  <option value={10}>Próximos 10 dias úteis</option>
                </select>
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={carregando}
                onClick={() => void buscar()}
              >
                {carregando
                  ? 'Lendo agenda…'
                  : buscou
                    ? 'Atualizar'
                    : 'Conectar minha agenda'}
              </button>
              <span className="text-xs text-grafite-400">
                07h–19h · escolha até {maxSlots}
                {emailAgendaFixo() && (
                  <> · agenda consultada: <strong>{emailAgendaFixo()}</strong></>
                )}
                {participantes.length > 0 && (
                  <>
                    {' '}
                    · checando também:{' '}
                    <strong>{participantes.join(', ')}</strong>
                  </>
                )}
              </span>
            </div>

            {erro && (
              <div className="badge-red mb-3 px-3 py-2 w-full justify-start">
                {erro}
              </div>
            )}

            {/* Slots */}
            {buscou && slots.length === 0 && !erro && (
              <p className="text-sm text-grafite-400">
                Nenhum horário livre encontrado no período. Tente ampliar o período.
              </p>
            )}

            {porDia.length > 0 && (
              <div className="space-y-3 mb-4">
                {porDia.map(([dia, lista]) => (
                  <div key={dia}>
                    <div className="text-xs uppercase text-grafite-400 mb-1">
                      {lista[0].rotulo.split(' · ')[0]}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {lista.map((s) => {
                        const ativo = sel.includes(s.inicio);
                        const hora = s.rotulo.split(' · ')[1] ?? s.rotulo;
                        return (
                          <button
                            key={s.inicio}
                            type="button"
                            onClick={() => toggle(s.inicio)}
                            className={
                              'px-2.5 py-1 rounded-md text-xs border transition-colors ' +
                              (ativo
                                ? 'border-unifique-500 bg-unifique-600 text-[#fff]'
                                : 'border-grafite-200 bg-white text-grafite-700 hover:bg-grafite-100')
                            }
                          >
                            {hora}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-grafite-400">
                {sel.length}/{maxSlots} selecionados
              </span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={sel.length === 0}
                  onClick={confirmar}
                >
                  Usar horários selecionados
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
