'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { SolicitacaoAlteracaoDetalheDTO } from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  BADGE_STATUS_ALTERACAO,
  ROTULO_STATUS_ALTERACAO,
  ROTULO_TIPO_ALTERACAO,
} from '@/lib/alteracao-contratual';

function dt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}
function dia(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function AlteracaoDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { areas } = useAuth();
  const isDho = areas.includes('dho') || areas.includes('admin');

  const [s, setS] = useState<SolicitacaoAlteracaoDetalheDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setS(await api<SolicitacaoAlteracaoDetalheDTO>(`/api/alteracao-contratual/${id}`));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar.');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const executar = useCallback(
    async (path: string, body?: unknown) => {
      setAcao(true);
      setErro(null);
      try {
        await api(`/api/alteracao-contratual/${id}${path}`, {
          method: 'POST',
          body: body ?? {},
        });
        await carregar();
      } catch (err) {
        setErro(err instanceof ApiError ? err.message : 'Falha na ação.');
      } finally {
        setAcao(false);
      }
    },
    [id, carregar],
  );

  if (erro && !s) {
    return (
      <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">
        {erro}
      </div>
    );
  }
  if (!s) return <div className="p-8 text-sm text-grafite-400">Carregando…</div>;

  return (
    <div>
      <Link
        href={'/alteracao-contratual' as Route}
        className="text-sm text-unifique-700 hover:underline"
      >
        ← Voltar
      </Link>

      <PageHeader
        titulo={s.colaborador_nome}
        subtitulo={`Matrícula ${s.colaborador_matricula} · aplicar em ${dia(s.data_aplicacao)}`}
        acoes={
          <span className={BADGE_STATUS_ALTERACAO[s.status]}>
            {ROTULO_STATUS_ALTERACAO[s.status]}
          </span>
        }
      />

      {erro && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Alterações */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-grafite-700 mb-3">Alterações</h2>
            <ul className="space-y-2">
              {s.itens.map((i) => (
                <li key={i.id} className="text-sm flex items-center gap-2">
                  <span className="badge-blue">{ROTULO_TIPO_ALTERACAO[i.tipo]}</span>
                  <span className="text-grafite-500">{i.valor_anterior ?? '—'}</span>
                  <span className="text-grafite-400">→</span>
                  <span className="font-medium text-grafite-800">{i.valor_novo}</span>
                </li>
              ))}
            </ul>
            {s.razoes && (
              <p className="text-sm text-grafite-600 mt-4">
                <span className="font-medium">Razões:</span> {s.razoes}
              </p>
            )}
          </div>

          {/* Assinaturas */}
          {s.assinaturas.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-grafite-700 mb-3">
                Assinaturas
              </h2>
              <ul className="space-y-2 text-sm">
                {s.assinaturas.map((a) => (
                  <li key={a.id} className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">{a.papel}</span> — {a.nome}
                      {a.email ? ` (${a.email})` : ''}
                    </span>
                    <span
                      className={
                        a.status === 'ASSINADA'
                          ? 'badge-green'
                          : a.status === 'RECUSADA'
                            ? 'badge-red'
                            : 'badge-yellow'
                      }
                    >
                      {a.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timeline */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-grafite-700 mb-3">Histórico</h2>
            <ul className="space-y-2 text-sm">
              {s.eventos.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="text-grafite-400 whitespace-nowrap">
                    {dt(e.criado_em)}
                  </span>
                  <span className="text-grafite-700">
                    {e.observacao ?? ROTULO_STATUS_ALTERACAO[e.para_status]}
                    {e.autor_nome ? (
                      <span className="text-grafite-400"> — {e.autor_nome}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Lateral: situação atual + ações */}
        <div className="space-y-4 h-fit">
          <div className="card p-5 text-sm space-y-1.5">
            <h2 className="text-sm font-semibold text-grafite-700 mb-2">
              Situação atual
            </h2>
            <Linha rotulo="Unidade" valor={s.unidade_atual} />
            <Linha rotulo="Centro de custo" valor={s.centro_custo_atual} />
            <Linha rotulo="Cargo" valor={s.cargo_atual} />
            <Linha rotulo="Líder" valor={s.lider_atual} />
            <Linha rotulo="Solicitante" valor={s.solicitante_nome} />
          </div>

          <div className="card p-5 space-y-2">
            <h2 className="text-sm font-semibold text-grafite-700 mb-1">Ações</h2>

            {s.status === 'RASCUNHO' && (
              <button
                className="btn-primary w-full"
                disabled={acao}
                onClick={() => void executar('/submeter')}
              >
                Enviar para aprovação do DHO
              </button>
            )}

            {s.status === 'AGUARDANDO_APROVACAO_DHO' && isDho && (
              <>
                <button
                  className="btn-primary w-full"
                  disabled={acao}
                  onClick={() => void executar('/aprovar')}
                >
                  Aprovar e enviar p/ assinatura
                </button>
                <button
                  className="btn-secondary w-full"
                  disabled={acao}
                  onClick={() => {
                    const motivo = window.prompt('Motivo da recusa:');
                    if (motivo) void executar('/recusar', { motivo });
                  }}
                >
                  Recusar
                </button>
              </>
            )}

            {s.status === 'AGUARDANDO_ASSINATURAS' && isDho && (
              <>
                <p className="text-xs text-grafite-400">
                  Modo simulado: registre as assinaturas manualmente (com o
                  Autentique ligado, o webhook faz isso).
                </p>
                <button
                  className="btn-soft w-full"
                  disabled={acao}
                  onClick={() => void executar('/assinar', { papel: 'GESTOR' })}
                >
                  Marcar assinado — Gestor
                </button>
                <button
                  className="btn-soft w-full"
                  disabled={acao}
                  onClick={() => void executar('/assinar', { papel: 'DHO' })}
                >
                  Marcar assinado — DHO
                </button>
              </>
            )}

            {!['EXECUTADA', 'CANCELADA'].includes(s.status) && (
              <button
                className="btn-ghost w-full text-red-600"
                disabled={acao}
                onClick={() => {
                  const motivo = window.prompt('Motivo do cancelamento:');
                  if (motivo) void executar('/cancelar', { motivo });
                }}
              >
                Cancelar solicitação
              </button>
            )}

            {s.execucao && (
              <p className="text-xs text-grafite-400 pt-2 border-t border-grafite-100">
                Execução: {s.execucao.sucesso === true
                  ? `concluída em ${dt(s.execucao.executada_em)}`
                  : s.execucao.sucesso === false
                    ? `falhou — ${s.execucao.erro ?? 'erro'}`
                    : `agendada para ${dia(s.execucao.agendada_para)}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-grafite-400">{rotulo}</span>
      <span className="text-grafite-700 text-right">{valor || '—'}</span>
    </div>
  );
}
