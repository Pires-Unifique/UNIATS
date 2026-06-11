'use client';

import { useMemo, useState } from 'react';

import {
  emailAgendaFixo,
  graphEnabled,
  obterGradeDisponibilidade,
  type GradeAgenda,
  type SlotLivre,
} from '@/lib/graph';

interface Props {
  /** Quantos horários o recrutador deve escolher (= nº de variáveis opcao_N). */
  maxSlots: number;
  /**
   * E-mails extras (líderes técnicos/gestor) cuja agenda também é checada — só
   * ficam livres os horários em que o recrutador E todos eles estão disponíveis.
   */
  participantes?: string[];
  onUsar: (slots: SlotLivre[]) => void;
  onClose: () => void;
}

const HORA_INICIO = 7;
const HORA_FIM = 19;

/**
 * Visão de agenda estilo Teams (delegado via Microsoft Graph): uma TABELA de
 * horários — dias nas colunas, horas nas linhas — mostrando livre e ocupado.
 * O recrutador clica nas células LIVRES para escolher; respeita `maxSlots`.
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
  const [grade, setGrade] = useState<GradeAgenda | null>(null);
  const [sel, setSel] = useState<string[]>([]); // por `inicio`
  const [carregando, setCarregando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    setCarregando(true);
    setErro(null);
    setSel([]);
    try {
      const g = await obterGradeDisponibilidade(
        {
          duracaoMin,
          diasUteis,
          horaInicio: HORA_INICIO,
          horaFim: HORA_FIM,
        },
        participantes,
      );
      setGrade(g);
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
      if (s.length >= maxSlots) {
        // No modo de 1 slot, clicar troca a seleção; com vários, respeita o teto.
        return maxSlots === 1 ? [inicio] : s;
      }
      return [...s, inicio];
    });
  }

  // Lookup início → SlotLivre, para montar a saída e exibir as escolhas.
  const livresPorInicio = useMemo(() => {
    const m = new Map<string, SlotLivre>();
    if (!grade) return m;
    for (const dia of grade.dias) {
      for (let i = 0; i < dia.celulas.length; i++) {
        const c = dia.celulas[i];
        if (c.status !== 'livre') continue;
        const hIni = c.inicio.slice(11, 16);
        const hFim = c.fim.slice(11, 16);
        m.set(c.inicio, {
          inicio: c.inicio,
          fim: c.fim,
          rotulo: `${dia.rotuloDia} · ${hIni}–${hFim}`,
        });
      }
    }
    return m;
  }, [grade]);

  const totalLivres = livresPorInicio.size;

  function confirmar() {
    const escolhidos = sel
      .map((i) => livresPorInicio.get(i))
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
        className="card flex max-h-[92vh] w-full max-w-5xl flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-grafite-900">
            Agenda — horários disponíveis
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
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs text-grafite-400">Duração</span>
                <select
                  className="mt-1 block rounded-md border border-grafite-200 px-2 py-1.5 text-sm"
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
                  className="mt-1 block rounded-md border border-grafite-200 px-2 py-1.5 text-sm"
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
                {HORA_INICIO}h–{HORA_FIM}h · escolha até {maxSlots}
                {emailAgendaFixo() && (
                  <> · agenda: <strong>{emailAgendaFixo()}</strong></>
                )}
                {participantes.length > 0 && (
                  <> · com <strong>{participantes.join(', ')}</strong></>
                )}
              </span>
            </div>

            {/* Legenda */}
            {grade && (
              <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-grafite-500">
                <Legenda cor="bg-emerald-100 border-emerald-200" rotulo="Livre" />
                <Legenda cor="bg-unifique-600 border-unifique-600" rotulo="Selecionado" />
                <Legenda cor="bg-grafite-100 border-grafite-200" rotulo="Ocupado" />
                <span className="ml-auto">
                  {totalLivres} horário(s) livre(s) no período
                </span>
              </div>
            )}

            {erro && (
              <div className="badge-red mb-3 w-full justify-start px-3 py-2">
                {erro}
              </div>
            )}

            {!buscou && !carregando && !erro && (
              <div className="rounded-md border border-dashed border-grafite-200 p-8 text-center text-sm text-grafite-400">
                Clique em <strong>Conectar minha agenda</strong> para ver a grade
                de horários (livres e ocupados) estilo Teams.
              </div>
            )}

            {buscou && grade && grade.dias.length === 0 && !erro && (
              <p className="text-sm text-grafite-400">
                Nenhum dia útil no período. Tente ampliar o período.
              </p>
            )}

            {/* Grade estilo Teams */}
            {grade && grade.dias.length > 0 && (
              <div className="overflow-auto rounded-md border border-grafite-100">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-20 bg-grafite-50 px-2 py-2" />
                      {grade.dias.map((dia) => {
                        const [semana, data] = dia.rotuloDia.split(', ');
                        return (
                          <th
                            key={dia.data}
                            className="sticky top-0 z-10 min-w-[5.5rem] border-l border-grafite-100 bg-grafite-50 px-2 py-2 text-center font-medium"
                          >
                            <div className="capitalize text-grafite-700">
                              {semana}
                            </div>
                            <div className="text-grafite-400">{data}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {grade.horarios.map((hora, linha) => (
                      <tr key={hora}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1 text-right tabular-nums text-grafite-400">
                          {hora}
                        </td>
                        {grade.dias.map((dia) => {
                          const cel = dia.celulas[linha];
                          const ativo = sel.includes(cel.inicio);
                          const livre = cel.status === 'livre';
                          return (
                            <td
                              key={dia.data}
                              className="border-l border-t border-grafite-100 p-0.5"
                            >
                              <button
                                type="button"
                                disabled={!livre}
                                onClick={() => toggle(cel.inicio)}
                                aria-pressed={ativo}
                                title={
                                  livre
                                    ? `${dia.rotuloDia} · ${hora}`
                                    : 'Ocupado'
                                }
                                className={
                                  'h-7 w-full rounded-sm border text-[10px] transition-colors ' +
                                  (ativo
                                    ? 'border-unifique-600 bg-unifique-600 text-white'
                                    : livre
                                      ? 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                      : 'cursor-not-allowed border-grafite-200 bg-grafite-100 text-transparent')
                                }
                              >
                                {ativo ? '✓' : ''}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Escolhas + ações */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-grafite-500">
                <span>
                  {sel.length}/{maxSlots} selecionado(s)
                </span>
                {sel
                  .map((i) => livresPorInicio.get(i))
                  .filter((s): s is SlotLivre => Boolean(s))
                  .map((s) => (
                    <span
                      key={s.inicio}
                      className="rounded bg-unifique-50 px-2 py-0.5 text-unifique-700"
                    >
                      {s.rotulo}
                    </span>
                  ))}
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={sel.length === 0}
                  onClick={confirmar}
                >
                  Usar horário{maxSlots > 1 ? 's' : ''} selecionado
                  {maxSlots > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Legenda({ cor, rotulo }: { cor: string; rotulo: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-sm border ${cor}`} />
      {rotulo}
    </span>
  );
}
