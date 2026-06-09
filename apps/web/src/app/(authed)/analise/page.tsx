'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OpcoesFiltroDTO, PainelAnaliseDTO } from '@uniats/shared';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import {
  formatarDias,
  formatarNumero,
  formatarPct,
  truncar,
} from '@/lib/format';

// Paleta Unifique (laranja → grafite) para os estágios do funil.
const CORES_FUNIL = [
  '#ea580c',
  '#f97316',
  '#fb923c',
  '#fdba74',
  '#3f3f46',
  '#16a34a',
];
const CORES_ENTREVISTA: Record<string, string> = {
  FINALIZADA: '#16a34a',
  AGENDADA: '#0284c7',
  EM_ANDAMENTO: '#d97706',
  NAO_COMPARECEU: '#dc2626',
  CANCELADA: '#71717a',
};

function isoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AnalisePage() {
  const hoje = useMemo(() => new Date(), []);
  const noventaDiasAtras = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d;
  }, []);

  const [de, setDe] = useState<string>(isoDia(noventaDiasAtras));
  const [ate, setAte] = useState<string>(isoDia(hoje));
  const [vagaId, setVagaId] = useState<string>('');
  const [recrutadorId, setRecrutadorId] = useState<string>('');

  const [opcoes, setOpcoes] = useState<OpcoesFiltroDTO | null>(null);
  const [painel, setPainel] = useState<PainelAnaliseDTO | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<OpcoesFiltroDTO>('/api/analise/filtros')
      .then(setOpcoes)
      .catch(() => setOpcoes({ recrutadores: [], vagas: [] }));
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await api<PainelAnaliseDTO>('/api/analise/painel', {
        query: {
          de: de || undefined,
          ate: ate || undefined,
          vagaId: vagaId || undefined,
          recrutadorId: recrutadorId || undefined,
        },
      });
      setPainel(resp);
    } catch (err) {
      setPainel(null);
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar o painel.');
    } finally {
      setCarregando(false);
    }
  }, [de, ate, vagaId, recrutadorId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function aplicarPreset(dias: number | null) {
    if (dias == null) {
      setDe('');
      setAte('');
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() - dias);
    setDe(isoDia(d));
    setAte(isoDia(new Date()));
  }

  return (
    <div>
      <PageHeader
        titulo="Painel analítico"
        subtitulo="Funil de recrutamento e métricas de gestão para o DHO."
      />

      {/* Filtros */}
      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <Campo label="De">
          <input
            type="date"
            className="input"
            value={de}
            max={ate || undefined}
            onChange={(e) => setDe(e.target.value)}
          />
        </Campo>
        <Campo label="Até">
          <input
            type="date"
            className="input"
            value={ate}
            min={de || undefined}
            onChange={(e) => setAte(e.target.value)}
          />
        </Campo>
        <Campo label="Vaga">
          <select
            className="input min-w-[12rem]"
            value={vagaId}
            onChange={(e) => setVagaId(e.target.value)}
          >
            <option value="">Todas as vagas</option>
            {opcoes?.vagas.map((v) => (
              <option key={v.id} value={v.id}>
                {truncar(v.titulo, 48)}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Recrutador">
          <select
            className="input min-w-[12rem]"
            value={recrutadorId}
            onChange={(e) => setRecrutadorId(e.target.value)}
          >
            <option value="">Todos</option>
            {opcoes?.recrutadores.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </Campo>
        <div className="flex gap-1 ml-auto">
          {[
            { l: '30d', d: 30 },
            { l: '90d', d: 90 },
            { l: '12m', d: 365 },
            { l: 'Tudo', d: null },
          ].map((p) => (
            <button
              key={p.l}
              type="button"
              className="btn-ghost text-xs px-2 py-1"
              onClick={() => aplicarPreset(p.d)}
            >
              {p.l}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {carregando && !painel ? (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      ) : !painel ? (
        <EmptyState
          titulo="Sem dados"
          descricao="Ajuste os filtros ou importe candidaturas para ver as métricas."
        />
      ) : (
        <div className={carregando ? 'opacity-60 transition-opacity' : ''}>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Kpi titulo="Candidaturas" valor={formatarNumero(painel.resumo.totalCandidaturas)} />
            <Kpi titulo="Contratados" valor={formatarNumero(painel.resumo.contratados)} />
            <Kpi
              titulo="Conversão geral"
              valor={formatarPct(painel.resumo.taxaConversaoGeral)}
              hint="contratados ÷ inscritos"
            />
            <Kpi
              titulo="Time-to-hire"
              valor={formatarDias(painel.resumo.tempoMedioContratacaoDias)}
              hint="inscrição → contratação"
            />
            <Kpi titulo="Entrevistas" valor={formatarNumero(painel.resumo.totalEntrevistas)} />
            <Kpi
              titulo="No-show"
              valor={formatarPct(painel.resumo.taxaNoShow)}
              hint="faltas ÷ (faltas + realizadas)"
              alerta={(painel.resumo.taxaNoShow ?? 0) >= 0.2}
            />
            <Kpi
              titulo="Vagas c/ candidatura"
              valor={formatarNumero(painel.resumo.totalVagasComCandidatura)}
            />
            <Kpi
              titulo="Agendadas (futuro)"
              valor={formatarNumero(painel.entrevistas.agendadasFuturas)}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Funil */}
            <Secao titulo="Funil de recrutamento">
              <ResponsiveContainer width="100%" height={260}>
                <FunnelChart>
                  <Tooltip
                    formatter={(v: number) => [formatarNumero(v), 'Candidaturas']}
                  />
                  <Funnel
                    dataKey="value"
                    data={painel.funil.map((etapa, i) => ({
                      name: etapa.rotulo,
                      value: etapa.total,
                      fill: CORES_FUNIL[i % CORES_FUNIL.length],
                    }))}
                    isAnimationActive={false}
                  >
                    <LabelList
                      position="right"
                      fill="#1f1f23"
                      stroke="none"
                      dataKey="name"
                      className="text-xs"
                    />
                    <LabelList
                      position="left"
                      fill="#1f1f23"
                      stroke="none"
                      dataKey="value"
                      className="text-xs font-medium"
                    />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
              <table className="w-full text-xs mt-2">
                <tbody>
                  {painel.funil.map((etapa) => (
                    <tr key={etapa.etapa} className="border-t border-grafite-100">
                      <td className="py-1 text-grafite-600">{etapa.rotulo}</td>
                      <td className="py-1 text-right tabular-nums font-medium">
                        {formatarNumero(etapa.total)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-grafite-400 w-20">
                        {etapa.taxaConversao == null
                          ? '—'
                          : `${formatarPct(etapa.taxaConversao, 0)} ↧`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Secao>

            {/* Entrevistas */}
            <Secao titulo="Entrevistas">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={painel.entrevistas.porStatus.map((s) => ({
                    status: s.status.replace(/_/g, ' ').toLowerCase(),
                    statusRaw: s.status,
                    total: s.total,
                  }))}
                  margin={{ top: 8, right: 8, left: -20, bottom: 8 }}
                >
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [formatarNumero(v), 'Entrevistas']} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {painel.entrevistas.porStatus.map((s) => (
                      <Cell
                        key={s.status}
                        fill={CORES_ENTREVISTA[s.status] ?? '#71717a'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {painel.entrevistas.porStatus.length === 0 && (
                <p className="text-xs text-grafite-400">Nenhuma entrevista no período.</p>
              )}
            </Secao>

            {/* Tempos por etapa */}
            <Secao titulo="Tempos médios por etapa">
              <div className="space-y-2">
                {painel.tempos.map((t) => (
                  <div
                    key={t.marco}
                    className="flex items-center justify-between border-b border-grafite-100 pb-2 last:border-0"
                  >
                    <div>
                      <div className="text-sm text-grafite-800">{t.rotulo}</div>
                      <div className="text-xs text-grafite-400">
                        amostra: {formatarNumero(t.amostra)}
                      </div>
                    </div>
                    <div className="text-lg font-semibold text-grafite-900 tabular-nums">
                      {formatarDias(t.mediaDias)}
                    </div>
                  </div>
                ))}
              </div>
            </Secao>

            {/* Por recrutador */}
            <Secao titulo="Volume por recrutador">
              {painel.porRecrutador.length === 0 ? (
                <p className="text-xs text-grafite-400">Sem dados no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-grafite-500 text-xs uppercase">
                    <tr>
                      <th className="text-left font-medium py-1">Recrutador</th>
                      <th className="text-right font-medium py-1">Cand.</th>
                      <th className="text-right font-medium py-1">Contr.</th>
                      <th className="text-right font-medium py-1">Conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {painel.porRecrutador.map((r) => (
                      <tr
                        key={r.recrutadorId ?? 'sem'}
                        className="border-t border-grafite-100"
                      >
                        <td className="py-1.5">{r.nome}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatarNumero(r.candidaturas)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatarNumero(r.contratados)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-grafite-500">
                          {formatarPct(r.taxaConversao, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Secao>
          </div>

          {/* Por vaga */}
          <Secao titulo="Qualidade e volume por vaga" className="mt-4">
            {painel.porVaga.length === 0 ? (
              <p className="text-xs text-grafite-400">Sem dados no período.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-grafite-500 text-xs uppercase">
                  <tr>
                    <th className="text-left font-medium py-1">Vaga</th>
                    <th className="text-right font-medium py-1">Candidaturas</th>
                    <th className="text-right font-medium py-1">Contratados</th>
                    <th className="text-right font-medium py-1">Score médio</th>
                  </tr>
                </thead>
                <tbody>
                  {painel.porVaga.map((v) => (
                    <tr key={v.vagaId} className="border-t border-grafite-100">
                      <td className="py-1.5">{truncar(v.titulo, 60)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatarNumero(v.candidaturas)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatarNumero(v.contratados)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {v.scoreMedio == null ? (
                          <span className="text-grafite-400">—</span>
                        ) : (
                          <span className="font-medium">{v.scoreMedio.toFixed(1)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Secao>

          {/* Observações / limitações */}
          {painel.observacoes.length > 0 && (
            <div className="mt-4 text-xs text-grafite-400 space-y-1">
              <p className="font-medium text-grafite-500">Sobre as métricas</p>
              <ul className="list-disc list-inside space-y-0.5">
                {painel.observacoes.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-grafite-500">{label}</span>
      {children}
    </label>
  );
}

function Secao({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-4 ${className ?? ''}`}>
      <h2 className="text-sm font-semibold text-grafite-700 mb-3">{titulo}</h2>
      {children}
    </section>
  );
}

function Kpi({
  titulo,
  valor,
  hint,
  alerta,
}: {
  titulo: string;
  valor: string;
  hint?: string;
  alerta?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-grafite-500">{titulo}</div>
      <div
        className={`text-2xl font-semibold mt-1 tabular-nums ${
          alerta ? 'text-red-600' : 'text-grafite-900'
        }`}
      >
        {valor}
      </div>
      {hint && <div className="text-[11px] text-grafite-400 mt-0.5">{hint}</div>}
    </div>
  );
}
