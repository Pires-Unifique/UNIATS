'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  emailAgendaFixo,
  graphEnabled,
  obterGradeDisponibilidade,
  type GradeAgenda,
  type SlotLivre,
} from '@/lib/graph';

interface Props {
  /** Quantos horários podem ser escolhidos. 1 = troca a seleção a cada clique. */
  maxSlots: number;
  /**
   * E-mails extras já fixos (controle externo). Quando `permitirConvidar` é true,
   * a própria agenda gerencia os convidados e este prop é ignorado.
   */
  participantes?: string[];
  /** Mostra, na própria agenda, a opção de convidar outras pessoas. */
  permitirConvidar?: boolean;
  /** Gestor/líder da vaga — sugerido como convidado (líder técnico). */
  gestorEmail?: string | null;
  gestorNome?: string | null;
  /**
   * Inline = embutido (sem overlay/confirmar); reporta a seleção via onChange.
   * Popup (padrão) = modal com Cancelar/Usar e onUsar no confirmar.
   */
  inline?: boolean;
  /** Disparado a cada mudança de seleção (principal no modo inline). */
  onChange?: (slots: SlotLivre[]) => void;
  /** Reporta os convidados (gestor incluído + extras) — p/ pré-reservar a agenda deles. */
  onParticipantesChange?: (emails: string[]) => void;
  onUsar?: (slots: SlotLivre[]) => void;
  onClose?: () => void;
}

const HORA_INICIO = 7;
const HORA_FIM = 19;
const DIAS_UTEIS = 10;
const PASSO = 30; // minutos por célula
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Visão de agenda estilo Teams (Microsoft Graph, delegado): uma TABELA de
 * horários — dias nas colunas, blocos de 30 min nas linhas — mostrando livre e
 * ocupado. A agenda é lida automaticamente ao abrir. A duração escolhida define
 * quantas células consecutivas um clique seleciona (30 min = 1, 1 h = 2).
 */
export function DisponibilidadePicker({
  maxSlots,
  participantes = [],
  permitirConvidar = false,
  gestorEmail,
  gestorNome,
  inline = false,
  onChange,
  onParticipantesChange,
  onUsar,
  onClose,
}: Props) {
  const habilitado = graphEnabled();
  const [duracaoMin, setDuracaoMin] = useState(30);
  const [grade, setGrade] = useState<GradeAgenda | null>(null);
  const [sel, setSel] = useState<string[]>([]); // por `inicio` do bloco
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Convidados gerenciados pela própria agenda (quando permitirConvidar).
  const temGestor = Boolean(gestorEmail && EMAIL_REGEX.test(gestorEmail));
  // Opt-in: o gestor só é convidado/pré-reservado se o recrutador marcar.
  const [incluirGestor, setIncluirGestor] = useState(false);
  const [extras, setExtras] = useState<string[]>([]);
  const [novoEmail, setNovoEmail] = useState('');

  const participantesEfetivos = permitirConvidar
    ? [...(temGestor && incluirGestor ? [gestorEmail!.trim()] : []), ...extras]
    : participantes;

  // Chave estável dos participantes para refazer a busca quando mudam.
  const participantesKey = participantesEfetivos
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');

  const span = Math.max(1, Math.round(duracaoMin / PASSO));

  const buscar = useCallback(async () => {
    const opts = {
      duracaoMin: PASSO,
      diasUteis: DIAS_UTEIS,
      horaInicio: HORA_INICIO,
      horaFim: HORA_FIM,
    };
    setErro(null);
    setSel([]);
    onChange?.([]);

    if (!graphEnabled()) return;
    setCarregando(true);
    try {
      const g = await obterGradeDisponibilidade(
        opts,
        participantesKey ? participantesKey.split('|') : [],
      );
      setGrade(g);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao ler a agenda.');
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantesKey]);

  // Conecta na agenda automaticamente ao abrir e quando os convidados mudam.
  useEffect(() => {
    void buscar();
  }, [buscar]);

  // Reporta os convidados (gestor incluído + extras) ao pai — p/ pré-reservar a
  // agenda deles além de checar a disponibilidade.
  useEffect(() => {
    onParticipantesChange?.(
      participantesEfetivos.map((e) => e.trim()).filter(Boolean),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantesKey]);

  function adicionarExtra() {
    const e = novoEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(e)) return;
    const jaExiste =
      extras.some((x) => x.toLowerCase() === e) ||
      (temGestor && gestorEmail!.toLowerCase() === e);
    if (!jaExiste) setExtras((prev) => [...prev, novoEmail.trim()]);
    setNovoEmail('');
  }

  // Índice início-da-célula → posição (dia, linha) para validar/seleção rápida.
  const posPorInicio = useMemo(() => {
    const m = new Map<string, { diaIdx: number; linha: number }>();
    if (!grade) return m;
    grade.dias.forEach((dia, diaIdx) =>
      dia.celulas.forEach((c, linha) => m.set(c.inicio, { diaIdx, linha })),
    );
    return m;
  }, [grade]);

  const ehInicioValido = useCallback(
    (diaIdx: number, linha: number): boolean => {
      if (!grade) return false;
      if (linha + span > grade.horarios.length) return false;
      const dia = grade.dias[diaIdx];
      for (let k = 0; k < span; k++) {
        if (dia.celulas[linha + k]?.status !== 'livre') return false;
      }
      return true;
    },
    [grade, span],
  );

  // Monta os SlotLivre a partir dos blocos selecionados (início + span células).
  const slotsDe = useCallback(
    (starts: string[]): SlotLivre[] => {
      if (!grade) return [];
      return starts
        .map((ini) => {
          const info = posPorInicio.get(ini);
          if (!info) return null;
          const dia = grade.dias[info.diaIdx];
          const c0 = dia.celulas[info.linha];
          const cN = dia.celulas[info.linha + span - 1] ?? c0;
          return {
            inicio: c0.inicio,
            fim: cN.fim,
            rotulo: `${dia.rotuloDia} · ${c0.inicio.slice(11, 16)}–${cN.fim.slice(11, 16)}`,
          };
        })
        .filter((s): s is SlotLivre => Boolean(s));
    },
    [grade, posPorInicio, span],
  );

  // Conjunto de células cobertas pela seleção (para destacar o bloco inteiro).
  const cobertas = useMemo(() => {
    const set = new Set<string>();
    if (!grade) return set;
    for (const ini of sel) {
      const info = posPorInicio.get(ini);
      if (!info) continue;
      const dia = grade.dias[info.diaIdx];
      for (let k = 0; k < span; k++) {
        const c = dia.celulas[info.linha + k];
        if (c) set.add(c.inicio);
      }
    }
    return set;
  }, [sel, grade, posPorInicio, span]);

  function toggle(inicio: string) {
    const info = posPorInicio.get(inicio);
    if (!info || !ehInicioValido(info.diaIdx, info.linha)) return;
    let next: string[];
    if (sel.includes(inicio)) next = sel.filter((x) => x !== inicio);
    else if (sel.length >= maxSlots) next = maxSlots === 1 ? [inicio] : sel;
    else next = [...sel, inicio];
    setSel(next);
    onChange?.(slotsDe(next));
  }

  function mudarDuracao(min: number) {
    setDuracaoMin(min);
    setSel([]); // os blocos mudam de tamanho — recomeça a seleção
    onChange?.([]);
  }

  const totalLivres = useMemo(() => {
    if (!grade) return 0;
    let n = 0;
    grade.dias.forEach((_, diaIdx) =>
      grade.horarios.forEach((_, linha) => {
        if (ehInicioValido(diaIdx, linha)) n++;
      }),
    );
    return n;
  }, [grade, ehInicioValido]);

  const slotsSelecionados = slotsDe(sel);

  const corpo = (
    <>
      {!habilitado ? (
        <div className="badge-yellow w-full justify-start px-3 py-2">
          Integração com a agenda ainda não configurada. Peça à infra um
          <strong className="mx-1">app registration</strong>no Entra ID (tipo SPA,
          permissão delegada<code className="mx-1">Calendars.Read</code>) e preencha
          <code className="mx-1">NEXT_PUBLIC_AZURE_AD_CLIENT_ID</code>/
          <code>NEXT_PUBLIC_AZURE_AD_TENANT_ID</code>.
        </div>
      ) : (
        <>
          {/* Convidar pessoas — a agenda passa a checar a disponibilidade delas */}
          {permitirConvidar && (
            <div className="mb-3 rounded-xl border border-grafite-200 p-3">
              <div className="mb-2 text-xs font-medium text-grafite-700">
                Convidar outras pessoas (líderes técnicos)
              </div>
              {temGestor && (
                <label className="mb-2 flex items-start gap-2 text-sm text-grafite-700">
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
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {extras.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 rounded-md bg-grafite-100 px-2 py-0.5 text-xs text-grafite-700"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() =>
                          setExtras((p) => p.filter((x) => x !== email))
                        }
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
                  className="flex-1 rounded-md border border-grafite-200 px-2 py-1.5 text-sm"
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      adicionarExtra();
                    }
                  }}
                  placeholder="convidar e-mail (ex.: lider@unifique.com.br)"
                />
                <button
                  type="button"
                  className="btn-soft text-xs"
                  disabled={!EMAIL_REGEX.test(novoEmail.trim())}
                  onClick={adicionarExtra}
                >
                  Convidar
                </button>
              </div>
            </div>
          )}

          {/* Controles: só duração (a agenda conecta sozinha) */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-grafite-200">
              {[30, 60].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => mudarDuracao(min)}
                  className={
                    'px-3 py-1.5 text-sm transition-colors ' +
                    (duracaoMin === min
                      ? 'bg-sky-600 text-white'
                      : 'bg-white text-grafite-600 hover:bg-grafite-50')
                  }
                >
                  {min === 30 ? '30 min' : '1 hora'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-soft text-xs"
              disabled={carregando}
              onClick={() => void buscar()}
            >
              {carregando ? 'Lendo agenda…' : 'Atualizar'}
            </button>
            <span className="text-xs text-grafite-400">
              {HORA_INICIO}h–{HORA_FIM}h
              {emailAgendaFixo() && (
                <> · <strong>{emailAgendaFixo()}</strong></>
              )}
            </span>
          </div>

          {/* Legenda */}
          <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-grafite-500">
            <Legenda
              cor="border-grafite-300 dark:border-[#3d3d3d]"
              rotulo="Livre"
              swatch="bg-white dark:bg-[#2d2d2d]"
            />
            <Legenda
              cor="border-[#479ef5]"
              rotulo="Selecionado"
              swatch="bg-[#479ef5]"
            />
            <Legenda
              cor="border-[#5b5fc7]"
              rotulo="Ocupado"
              swatch="bg-[#5b5fc7]"
            />
            {grade && (
              <span className="ml-auto">
                {totalLivres} horário(s) livre(s) para{' '}
                {duracaoMin === 30 ? '30 min' : '1 h'}
              </span>
            )}
          </div>

          {erro && (
            <div className="badge-red mb-3 w-full justify-start px-3 py-2">
              {erro}
            </div>
          )}

          {carregando && !grade && (
            <div className="rounded-md border border-dashed border-grafite-200 p-8 text-center text-sm text-grafite-400">
              Lendo a agenda…
            </div>
          )}

          {/* Grade estilo Teams — adapta ao tema (claro: fundo branco; escuro: grafite). */}
          {grade && grade.dias.length > 0 && (
            <div className="overflow-auto rounded-xl border border-grafite-200 bg-white dark:border-[#3d3d3d] dark:bg-[#1f1f1f]">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 border-b border-grafite-200 bg-grafite-50 px-2 py-1.5 dark:border-[#3d3d3d] dark:bg-[#2a2a2a]" />
                    {grade.dias.map((dia) => {
                      const [semana, data] = dia.rotuloDia.split(', ');
                      return (
                        <th
                          key={dia.data}
                          className="sticky top-0 z-10 min-w-[4.5rem] border-b border-l border-grafite-200 bg-grafite-50 px-2 py-1.5 text-center font-medium dark:border-[#3d3d3d] dark:bg-[#2a2a2a]"
                        >
                          <div className="capitalize text-grafite-900 dark:text-neutral-200">
                            {semana}
                          </div>
                          <div className="text-grafite-400 dark:text-neutral-500">{data}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {grade.horarios.map((hora, linha) => {
                    const horaCheia = hora.endsWith(':00');
                    // Divisória em toda linha: forte na hora cheia, suave no :30.
                    const sep =
                      linha === 0
                        ? ''
                        : horaCheia
                          ? 'border-t border-grafite-200 dark:border-[#454545]'
                          : 'border-t border-grafite-100 dark:border-[#363636]';
                    return (
                      <tr key={hora}>
                        <td
                          className={`sticky left-0 z-10 whitespace-nowrap border-r border-grafite-200 bg-white px-2 py-0 text-right align-top text-[10px] tabular-nums dark:border-[#3d3d3d] dark:bg-[#1f1f1f] ${horaCheia ? 'text-grafite-500 dark:text-neutral-400' : 'text-grafite-300 dark:text-neutral-600'}`}
                        >
                          {hora}
                        </td>
                        {grade.dias.map((dia, diaIdx) => {
                          const cel = dia.celulas[linha];
                          const livre = cel.status === 'livre';
                          const coberto = cobertas.has(cel.inicio);
                          const podeClicar =
                            coberto || ehInicioValido(diaIdx, linha);
                          return (
                            <td
                              key={dia.data}
                              className={`border-l border-grafite-100 p-0 dark:border-[#363636] ${sep}`}
                            >
                              <button
                                type="button"
                                disabled={!podeClicar}
                                onClick={() => toggle(cel.inicio)}
                                title={
                                  livre ? `${dia.rotuloDia} · ${hora}` : 'Ocupado'
                                }
                                className={
                                  'block h-6 w-full text-[10px] font-semibold leading-none transition-colors ' +
                                  (coberto
                                    ? 'bg-[#479ef5] text-white'
                                    : podeClicar
                                      ? 'bg-white text-transparent hover:bg-grafite-100 dark:bg-[#2a2a2a] dark:hover:bg-[#383838]'
                                      : livre
                                        ? 'bg-grafite-50 text-transparent dark:bg-[#232323]'
                                        : 'cursor-not-allowed bg-[#5b5fc7] text-transparent')
                                }
                              >
                                {coberto ? '✓' : ''}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {grade && grade.dias.length === 0 && !carregando && (
            <p className="text-sm text-grafite-400">
              Nenhum dia útil no período.
            </p>
          )}

          {/* Resumo da seleção */}
          {slotsSelecionados.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-grafite-500">
              <span>
                {sel.length}/{maxSlots} selecionado(s):
              </span>
              {slotsSelecionados.map((s) => (
                <span
                  key={s.inicio}
                  className="rounded bg-sky-50 px-2 py-0.5 text-sky-700"
                >
                  {s.rotulo}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );

  // Modo inline: só o corpo (o modal hospedeiro provê título e ações).
  if (inline) return <div>{corpo}</div>;

  // Modo popup: overlay + título + Cancelar/Usar.
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

        <div className="min-h-0 flex-1 overflow-auto">{corpo}</div>

        {habilitado && (
          <div className="mt-3 flex shrink-0 justify-end gap-2">
            <button type="button" className="btn-soft" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={sel.length === 0}
              onClick={() => {
                onUsar?.(slotsSelecionados);
                onClose?.();
              }}
            >
              Usar horário{maxSlots > 1 ? 's' : ''} selecionado
              {maxSlots > 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Legenda({
  cor,
  rotulo,
  swatch,
}: {
  cor: string;
  rotulo: string;
  /** Classes Tailwind do fundo do quadradinho (com variante dark:). */
  swatch: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-sm border ${cor} ${swatch}`} />
      {rotulo}
    </span>
  );
}
