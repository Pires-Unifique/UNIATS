'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type {
  DashboardDTO,
  EntrevistaHojeDTO,
  FunilEtapaDTO,
  VagaResumoDashboardDTO,
} from '@uniats/shared';

import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatarPct } from '@/lib/format';

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InicioPage() {
  const { usuario, podeVerTudo, apenasGestaoAcessos } = useAuth();

  // Início é o pouso padrão pós-login, mas quem SÓ gere acessos não participa
  // dos processos — vai direto para a tela de Usuários (mesma regra de Vagas).
  useEffect(() => {
    if (apenasGestaoAcessos) {
      window.location.replace('/configuracoes/usuarios');
    }
  }, [apenasGestaoAcessos]);

  const [dados, setDados] = useState<DashboardDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    api<DashboardDTO>('/api/dashboard')
      .then((d) => {
        if (!cancelado) setDados(d);
      })
      .catch((err) => {
        if (cancelado) return;
        setErro(
          err instanceof ApiError ? err.message : 'Falha ao carregar o painel.',
        );
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const primeiroNome = usuario?.nome?.split(' ')[0] ?? '';
  const dataHoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const escopoMeu = dados?.escopo !== 'global';

  const proxima = dados?.entrevistasHoje.find(
    (e) => e.status === 'AGENDADA' && new Date(e.agendadaPara) > new Date(),
  );

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-grafite-900">
            {saudacao()}
            {primeiroNome ? `, ${primeiroNome}` : ''} 👋
          </h1>
          <p className="text-sm text-grafite-400 mt-0.5">
            {dataHoje.charAt(0).toUpperCase() + dataHoje.slice(1)}
            {dados && !escopoMeu
              ? ' · visão geral — nenhuma vaga atribuída a você como recrutador'
              : ''}
          </p>
        </div>
        {podeVerTudo && (
          <Link href="/vagas/publicar" className="btn-primary text-sm">
            ➕ Publicar vaga
          </Link>
        )}
      </div>

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">
          {erro}
        </div>
      )}

      {!dados && !erro && (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      )}

      {dados && (
        <div className="space-y-4">
          {/* Indicadores */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile
              label={escopoMeu ? 'Vagas com você' : 'Vagas publicadas'}
              valor={dados.vagas.publicadas}
              sub={
                dados.vagas.semCandidatura > 0
                  ? `${dados.vagas.semCandidatura} sem candidatura`
                  : 'todas com candidatos'
              }
              tom={dados.vagas.semCandidatura > 0 ? 'alerta' : 'ok'}
            />
            <Tile
              label="Entrevistas hoje"
              valor={dados.entrevistasHoje.length}
              sub={
                proxima
                  ? `próxima às ${horaLocal(proxima.agendadaPara)}`
                  : 'nenhuma por vir'
              }
            />
            <Tile
              label="Aguardando candidato"
              valor={dados.aguardandoCandidato.total}
              sub={
                dados.aguardandoCandidato.ha24h > 0
                  ? `${dados.aguardandoCandidato.ha24h} há mais de 24h`
                  : 'nenhuma atrasada'
              }
              tom={dados.aguardandoCandidato.ha24h > 0 ? 'alerta' : 'neutro'}
            />
            <Tile
              label="Novos candidatos · 7d"
              valor={dados.novosCandidatos.total7d}
              sub={
                dados.novosCandidatos.variacaoSemana != null
                  ? `${dados.novosCandidatos.variacaoSemana >= 0 ? '▲' : '▼'} ${formatarPct(Math.abs(dados.novosCandidatos.variacaoSemana), 0)} vs semana anterior`
                  : 'sem base de comparação'
              }
              tom={
                dados.novosCandidatos.variacaoSemana == null
                  ? 'neutro'
                  : dados.novosCandidatos.variacaoSemana >= 0
                    ? 'ok'
                    : 'alerta'
              }
              spark={dados.novosCandidatos.porDia}
            />
            <Tile
              label="Análises prontas"
              valor={dados.analisesProntas}
              sub={
                dados.analisesProntas > 0 ? 'não visualizadas ✨' : 'tudo visto'
              }
            />
          </div>

          {/* Agenda de hoje + Precisa de você */}
          <div className="grid lg:grid-cols-3 gap-4 items-start">
            <section className="card overflow-hidden lg:col-span-2">
              <CardHead titulo="🗓️ Agenda de hoje">
                <Link
                  href="/entrevistas"
                  className="text-xs text-unifique-700 dark:text-unifique-400 hover:underline"
                >
                  Ver agenda completa →
                </Link>
              </CardHead>
              {dados.entrevistasHoje.length === 0 ? (
                <p className="p-4 text-sm text-grafite-400">
                  Nenhuma entrevista hoje.
                </p>
              ) : (
                <ul className="divide-y divide-grafite-100">
                  {dados.entrevistasHoje.map((e) => (
                    <LinhaEntrevista key={e.id} e={e} />
                  ))}
                </ul>
              )}
            </section>

            <section className="card overflow-hidden">
              <CardHead titulo="⚡ Precisa de você" />
              <Pendencias dados={dados} />
            </section>
          </div>

          {/* Vagas com mais movimento + Funil */}
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <section className="card overflow-hidden">
              <CardHead
                titulo={
                  escopoMeu
                    ? '📋 Suas vagas com mais movimento'
                    : '📋 Vagas com mais movimento'
                }
              >
                <Link
                  href="/vagas"
                  className="text-xs text-unifique-700 dark:text-unifique-400 hover:underline"
                >
                  Todas as vagas →
                </Link>
              </CardHead>
              <VagasTop vagas={dados.vagasTop} />
            </section>

            <section className="card overflow-hidden">
              <CardHead
                titulo={
                  escopoMeu
                    ? '📊 Seu funil · últimos 30 dias'
                    : '📊 Funil · últimos 30 dias'
                }
              >
                {podeVerTudo && (
                  <Link
                    href="/analise"
                    className="text-xs text-unifique-700 dark:text-unifique-400 hover:underline"
                  >
                    Análise completa →
                  </Link>
                )}
              </CardHead>
              <Funil funil={dados.funil30d} taxaNoShow={dados.taxaNoShow30d} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Blocos ----------

function CardHead({
  titulo,
  children,
}: {
  titulo: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-grafite-100 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-grafite-900">{titulo}</h2>
      {children}
    </div>
  );
}

function Tile({
  label,
  valor,
  sub,
  tom = 'neutro',
  spark,
}: {
  label: string;
  valor: number;
  sub?: string;
  tom?: 'neutro' | 'ok' | 'alerta';
  spark?: Array<{ dia: string; total: number }>;
}) {
  return (
    <div className="card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-grafite-400">
        {label}
      </p>
      <p className="text-3xl font-semibold text-grafite-900 tabular-nums mt-0.5">
        {valor}
      </p>
      {sub && (
        <p
          className={clsx(
            'text-xs mt-0.5',
            tom === 'ok' && 'text-emerald-600 dark:text-emerald-400',
            tom === 'alerta' && 'text-amber-600 dark:text-amber-400',
            tom === 'neutro' && 'text-grafite-400',
          )}
        >
          {sub}
        </p>
      )}
      {spark && <Sparkline dados={spark} />}
    </div>
  );
}

/** Mini-tendência dos últimos 14 dias (decorativa — valores no tile). */
function Sparkline({ dados }: { dados: Array<{ dia: string; total: number }> }) {
  if (dados.length < 2) return null;
  const W = 120;
  const H = 28;
  const max = Math.max(...dados.map((d) => d.total), 1);
  const pts = dados.map(
    (d, i) =>
      [
        (i / (dados.length - 1)) * W,
        H - 3 - (d.total / max) * (H - 6),
      ] as const,
  );
  const linha = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [fimX, fimY] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-7 mt-1 text-unifique-600 dark:text-unifique-400"
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon
        points={`0,${H} ${linha} ${W},${H}`}
        fill="currentColor"
        opacity={0.1}
      />
      <polyline
        points={linha}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={fimX} cy={fimY} r={2.5} fill="currentColor" />
    </svg>
  );
}

function LinhaEntrevista({ e }: { e: EntrevistaHojeDTO }) {
  const encerrada =
    e.status === 'FINALIZADA' ||
    e.status === 'CANCELADA' ||
    e.status === 'NAO_COMPARECEU';
  return (
    <li
      className={clsx(
        'flex items-center gap-3 px-4 py-3',
        encerrada && 'opacity-60',
      )}
    >
      <div className="w-14 shrink-0">
        <p className="text-sm font-semibold text-grafite-900 tabular-nums">
          {horaLocal(e.agendadaPara)}
        </p>
        <p className="text-[11px] text-grafite-400">{e.duracaoMin} min</p>
      </div>
      <div className="min-w-0 flex-1">
        {e.candidaturaId ? (
          <Link
            href={`/candidaturas/${e.candidaturaId}`}
            className="text-sm font-medium text-grafite-900 hover:underline block truncate"
          >
            {e.candidatoNome}
          </Link>
        ) : (
          <p className="text-sm font-medium text-grafite-900 truncate">
            {e.candidatoNome}
          </p>
        )}
        <p className="text-xs text-grafite-400 truncate">
          {e.vagaTitulo ?? '—'}
        </p>
      </div>
      <StatusBadge status={e.status} />
      {e.temAnalise ? (
        <Link href={`/entrevistas/${e.id}`} className="btn-soft text-xs">
          Ver análise
        </Link>
      ) : e.meetUrl && !encerrada ? (
        <a
          href={e.meetUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-soft text-xs"
        >
          Entrar na call
        </a>
      ) : (
        <Link href={`/entrevistas/${e.id}`} className="btn-ghost text-xs">
          Abrir →
        </Link>
      )}
    </li>
  );
}

function Pendencias({ dados }: { dados: DashboardDTO }) {
  const p = dados.pendencias;
  const todas: Array<{
    qtd: number;
    texto: string;
    detalhe: string;
    tom: 'bad' | 'warn' | 'info';
    href?: string;
  }> = [
    {
      qtd: p.enquetesSemResposta24h,
      texto: 'Enquetes sem resposta há +24h',
      detalhe: 'candidato ainda não votou nos horários',
      tom: 'bad',
      href: '/vagas?pendencia=enquete_sem_resposta',
    },
    {
      qtd: p.entrevistasSemParecer,
      texto: 'Entrevistas sem parecer final',
      detalhe: 'finalizadas nos últimos 60 dias',
      tom: 'warn',
      href: '/entrevistas?pendencia=sem_parecer',
    },
    {
      qtd: p.candidaturasParadas,
      texto: 'Candidaturas paradas há +7 dias',
      detalhe: 'aprovadas na triagem, sem entrevista',
      tom: 'warn',
      href: '/vagas?pendencia=candidaturas_paradas',
    },
    {
      qtd: p.noShows7d,
      texto: 'No-shows para reagendar',
      detalhe: 'últimos 7 dias',
      tom: 'bad',
      href: '/entrevistas?status=NAO_COMPARECEU',
    },
    {
      qtd: p.vagasSemCandidatura,
      texto: 'Vagas no ar sem candidatura',
      detalhe: 'publicadas há mais de 14 dias',
      tom: 'info',
      href: '/vagas?pendencia=sem_candidatura',
    },
  ];
  const linhas = todas.filter((l) => l.qtd > 0);

  if (linhas.length === 0) {
    return (
      <p className="p-4 text-sm text-grafite-400">Nada pendente — tudo em dia ✅</p>
    );
  }

  return (
    <ul className="divide-y divide-grafite-100">
      {linhas.map((l) => (
        <li key={l.texto} className="flex items-center gap-3 px-4 py-3">
          <span
            className={clsx(
              'w-8 h-8 shrink-0 rounded-lg grid place-items-center text-sm font-bold tabular-nums',
              l.tom === 'bad' &&
                'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
              l.tom === 'warn' &&
                'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
              l.tom === 'info' &&
                'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
            )}
          >
            {l.qtd}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-grafite-900">{l.texto}</p>
            <p className="text-[11px] text-grafite-400">{l.detalhe}</p>
          </div>
          {l.href && (
            <Link
              href={l.href as Route}
              className="text-xs font-medium text-unifique-700 dark:text-unifique-400 hover:underline shrink-0"
            >
              Ver →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function ScoreChip({ valor }: { valor: number | null }) {
  if (valor == null) return <span className="text-grafite-400">—</span>;
  const cls =
    valor >= 85 ? 'badge-green' : valor >= 70 ? 'badge-yellow' : 'badge-gray';
  return <span className={clsx(cls, 'tabular-nums')}>{valor}</span>;
}

function VagasTop({ vagas }: { vagas: VagaResumoDashboardDTO[] }) {
  if (vagas.length === 0) {
    return (
      <p className="p-4 text-sm text-grafite-400">
        Nenhuma vaga publicada no seu escopo.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-grafite-50 text-grafite-600">
        <tr>
          <th className="text-left font-medium px-4 py-2 text-xs uppercase tracking-wide">
            Vaga
          </th>
          <th className="text-right font-medium px-4 py-2 text-xs uppercase tracking-wide">
            Cand.
          </th>
          <th className="text-right font-medium px-4 py-2 text-xs uppercase tracking-wide">
            Dias
          </th>
          <th className="text-right font-medium px-4 py-2 text-xs uppercase tracking-wide">
            Top score
          </th>
          <th />
        </tr>
      </thead>
      <tbody>
        {vagas.map((v) => (
          <tr
            key={v.id}
            className="border-t border-grafite-100 hover:bg-grafite-50"
          >
            <td className="px-4 py-2.5">
              <p className="font-medium text-grafite-900">{v.titulo}</p>
              {v.cidade && (
                <p className="text-[11px] text-grafite-400">{v.cidade}</p>
              )}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">
              {v.candidaturas}
            </td>
            <td
              className={clsx(
                'px-4 py-2.5 text-right tabular-nums',
                v.diasAberta != null && v.diasAberta > 30
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : undefined,
              )}
            >
              {v.diasAberta ?? '—'}
            </td>
            <td className="px-4 py-2.5 text-right">
              <ScoreChip valor={v.topScore} />
            </td>
            <td className="px-2 py-2.5 text-right">
              <Link
                href={`/vagas/${v.id}/ranking`}
                className="text-xs font-medium text-unifique-700 dark:text-unifique-400 hover:underline whitespace-nowrap"
              >
                Ranking →
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Rampa sequencial do funil: claro (topo) → escuro (fundo), azul da marca.
const CORES_FUNIL = [
  'bg-unifique-200',
  'bg-unifique-300',
  'bg-unifique-400',
  'bg-unifique-500',
  'bg-unifique-600',
  'bg-unifique-800',
];

function Funil({
  funil,
  taxaNoShow,
}: {
  funil: FunilEtapaDTO[];
  taxaNoShow: number | null;
}) {
  const maxTotal = funil[0]?.total ?? 0;
  if (maxTotal === 0) {
    return (
      <p className="p-4 text-sm text-grafite-400">
        Sem candidaturas nos últimos 30 dias.
      </p>
    );
  }
  const contratados = funil[funil.length - 1]?.total ?? 0;
  return (
    <div>
      <div className="p-4 space-y-2.5">
        {funil.map((etapa, i) => (
          <div key={etapa.etapa} className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs text-grafite-600">
              {etapa.rotulo}
            </span>
            <span className="flex-1 min-w-0">
              <span
                className={clsx(
                  'block h-3 rounded-r',
                  CORES_FUNIL[i] ?? CORES_FUNIL[CORES_FUNIL.length - 1],
                )}
                style={{
                  width: `${Math.max((etapa.total / maxTotal) * 100, etapa.total > 0 ? 2 : 0)}%`,
                  minWidth: etapa.total > 0 ? 4 : 0,
                }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold text-grafite-900 tabular-nums">
              {etapa.total}
            </span>
          </div>
        ))}
      </div>
      <p className="px-4 py-2.5 border-t border-grafite-100 text-xs text-grafite-400">
        Conversão geral {formatarPct(contratados / maxTotal)} · No-show{' '}
        {formatarPct(taxaNoShow)}
      </p>
    </div>
  );
}
