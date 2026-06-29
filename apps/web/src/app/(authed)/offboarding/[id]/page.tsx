'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type {
  ItemEncerramentoDTO,
  ProcuradorDTO,
  SolicitacaoOffboardingDetalheDTO,
} from '@uniats/shared';

import { MotivoModal } from '@/components/MotivoModal';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError, baixarArquivo } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  BADGE_ITEM_ENCERRAMENTO,
  BADGE_STATUS_OFFBOARDING,
  ROTULO_FORMA_ASSINATURA,
  ROTULO_ORIGEM_OFFBOARDING,
  ROTULO_STATUS_OFFBOARDING,
  ROTULO_TIPO_DESLIGAMENTO,
} from '@/lib/offboarding';

function dt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}
function dia(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
}

export default function OffboardingDetalhePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { areas } = useAuth();
  const isDho = areas.includes('dho') || areas.includes('admin');

  const [s, setS] = useState<SolicitacaoOffboardingDetalheDTO | null>(null);
  const [procuradores, setProcuradores] = useState<ProcuradorDTO[]>([]);
  const [procuradorSel, setProcuradorSel] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState(false);
  // Modal de motivo (recusa/cancelamento) — substitui o window.prompt.
  const [modalMotivo, setModalMotivo] = useState<null | 'recusar' | 'cancelar'>(null);
  const [uploadando, setUploadando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setS(await api<SolicitacaoOffboardingDetalheDTO>(`/api/offboarding/${id}`));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar.');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    void (async () => {
      try {
        setProcuradores(await api<ProcuradorDTO[]>('/api/offboarding/procuradores'));
      } catch {
        /* lista vazia até cadastrar */
      }
    })();
  }, []);

  const executar = useCallback(
    async (path: string, body?: unknown) => {
      setAcao(true);
      setErro(null);
      try {
        await api(`/api/offboarding/${id}${path}`, { method: 'POST', body: body ?? {} });
        await carregar();
      } catch (err) {
        setErro(err instanceof ApiError ? err.message : 'Falha na ação.');
      } finally {
        setAcao(false);
      }
    },
    [id, carregar],
  );

  const enviarDocAssinado = useCallback(
    async (file: File) => {
      setUploadando(true);
      setErro(null);
      try {
        const form = new FormData();
        form.append('arquivo', file);
        await api(`/api/offboarding/${id}/documento-assinado`, {
          method: 'POST',
          body: form,
        });
        await carregar();
      } catch (err) {
        setErro(err instanceof ApiError ? err.message : 'Falha no upload.');
      } finally {
        setUploadando(false);
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

  const integracoes = s.itens_encerramento.filter((i) => i.categoria === 'INTEGRACAO');
  const checklist = s.itens_encerramento.filter((i) => i.categoria === 'CHECKLIST');
  const repFisica = s.forma_assinatura === 'FISICA';

  return (
    <div>
      <Link
        href={'/offboarding' as Route}
        className="text-sm text-unifique-700 hover:underline"
      >
        ← Voltar
      </Link>

      <PageHeader
        titulo={s.colaborador_nome}
        subtitulo={`Matrícula ${s.colaborador_matricula} · ${ROTULO_ORIGEM_OFFBOARDING[s.origem]} · ${ROTULO_TIPO_DESLIGAMENTO[s.tipo_desligamento]}`}
        acoes={
          <span className={BADGE_STATUS_OFFBOARDING[s.status]}>
            {ROTULO_STATUS_OFFBOARDING[s.status]}
          </span>
        }
      />

      {erro && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
          {erro}
        </div>
      )}

      {/* Recusa visível ao solicitante */}
      {s.status === 'RECUSADO' && (
        <div className="card p-4 mb-4 text-sm bg-red-50 border-red-200 text-red-700">
          <strong>Solicitação recusada</strong>
          {s.recusado_por_nome ? ` por ${s.recusado_por_nome}` : ''}
          {s.recusado_em ? ` em ${dt(s.recusado_em)}` : ''}.
          {s.motivo_recusa ? <div className="mt-1">Motivo: {s.motivo_recusa}</div> : null}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Dados do desligamento */}
          <div className="card p-5 text-sm space-y-1.5">
            <h2 className="text-sm font-semibold text-grafite-700 mb-2">
              Desligamento
            </h2>
            <Linha rotulo="Motivo" valor={s.motivo} />
            <Linha
              rotulo="Aviso prévio"
              valor={
                s.cumpre_aviso_previo
                  ? `Sim — ${s.aviso_previo_dias ?? '—'} dia(s)`
                  : 'Não'
              }
            />
            <Linha rotulo="Forma de assinatura" valor={ROTULO_FORMA_ASSINATURA[s.forma_assinatura]} />
            <Linha rotulo="E-mail pessoal" valor={s.email_pessoal} />
            <Linha rotulo="WhatsApp pessoal" valor={s.whatsapp_pessoal} />
          </div>

          {/* Snapshot demissional do Senior */}
          {s.senior_snapshot && (
            <div className="card p-5 text-sm">
              <h2 className="text-sm font-semibold text-grafite-700 mb-3">
                Dados demissionais (Senior)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                <Linha rotulo="Cargo" valor={s.senior_snapshot.cargo} />
                <Linha rotulo="Filial/Unidade" valor={s.senior_snapshot.filial} />
                <Linha rotulo="Centro de custo" valor={s.senior_snapshot.centro_custo} />
                <Linha rotulo="Admissão" valor={dia(s.senior_snapshot.data_admissao)} />
                <Linha rotulo="Término de cumprimento" valor={dia(s.senior_snapshot.data_termino_cumprimento)} />
                <Linha rotulo="Prazo de homologação" valor={dia(s.senior_snapshot.prazo_homologacao)} />
                <Linha rotulo="Liderança imediata" valor={s.senior_snapshot.lideranca_imediata} />
                <Linha rotulo="Escala" valor={s.senior_snapshot.escala_trabalho} />
                <Linha rotulo="Presencial/Home" valor={s.senior_snapshot.presencial_ou_home} />
                <Linha rotulo="Situação atual" valor={s.senior_snapshot.situacao_atual} />
              </div>
            </div>
          )}

          {/* Assinaturas */}
          {s.assinaturas.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-grafite-700 mb-3">Assinaturas</h2>
              <ul className="space-y-2 text-sm">
                {s.assinaturas.map((a) => (
                  <li key={a.id} className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">
                        {a.papel === 'COLABORADOR' ? 'Colaborador' : 'Representante da empresa'}
                      </span>{' '}
                      — {a.nome}
                      {a.email ? ` (${a.email})` : ''}
                      {a.representante_origem ? (
                        <span className="text-grafite-400"> · {a.representante_origem}</span>
                      ) : null}
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

          {/* Etapas de encerramento */}
          {s.itens_encerramento.length > 0 && (
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-grafite-700">
                Etapas de encerramento
              </h2>

              {integracoes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-grafite-400 mb-2">
                    Integrações (TI / benefícios / ponto)
                  </p>
                  <ul className="space-y-2">
                    {integracoes.map((i) => (
                      <li key={i.id} className="flex items-center justify-between text-sm">
                        <span className="text-grafite-700">{i.titulo}</span>
                        <div className="flex items-center gap-2">
                          <span className={BADGE_ITEM_ENCERRAMENTO[i.status]}>{i.status}</span>
                          {i.status === 'FALHA' && (
                            <button
                              className="btn-soft text-xs"
                              disabled={acao}
                              onClick={() =>
                                void executar(`/itens/${i.chave}`, { executar_integracao: true })
                              }
                            >
                              Reexecutar
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {checklist.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-grafite-400 mb-2">
                    Checklist do líder
                  </p>
                  <ul className="space-y-1.5">
                    {checklist.map((i) => (
                      <ItemChecklist
                        key={i.id}
                        item={i}
                        disabled={acao || s.status !== 'EM_ENCERRAMENTO'}
                        onResponder={(body) => void executar(`/itens/${i.chave}`, body)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-grafite-700 mb-3">Histórico</h2>
            <ul className="space-y-2 text-sm">
              {s.eventos.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="text-grafite-400 whitespace-nowrap">{dt(e.criado_em)}</span>
                  <span className="text-grafite-700">
                    {e.observacao ?? ROTULO_STATUS_OFFBOARDING[e.para_status]}
                    {e.autor_nome ? (
                      <span className="text-grafite-400"> — {e.autor_nome}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Lateral: situação + ações */}
        <div className="space-y-4 h-fit">
          <div className="card p-5 text-sm space-y-1.5">
            <h2 className="text-sm font-semibold text-grafite-700 mb-2">Situação atual</h2>
            <Linha rotulo="Unidade" valor={s.unidade_atual} />
            <Linha rotulo="Centro de custo" valor={s.centro_custo_atual} />
            <Linha rotulo="Cargo" valor={s.cargo_atual} />
            <Linha rotulo="Solicitante" valor={s.solicitante_nome} />
            {s.aprovado_gestor_por_nome && (
              <Linha rotulo="Aprov. gestor" valor={`${s.aprovado_gestor_por_nome} · ${dt(s.aprovado_gestor_em)}`} />
            )}
            {s.aprovado_dho_por_nome && (
              <Linha rotulo="Aprov. DHO" valor={`${s.aprovado_dho_por_nome} · ${dt(s.aprovado_dho_em)}`} />
            )}
          </div>

          <div className="card p-5 space-y-2">
            <h2 className="text-sm font-semibold text-grafite-700 mb-1">Ações</h2>

            {s.status === 'RASCUNHO' && (
              <button
                className="btn-primary w-full"
                disabled={acao}
                onClick={() => void executar('/submeter')}
              >
                {s.origem === 'EMPREGADOR'
                  ? 'Enviar para aprovações'
                  : 'Gerar documento e enviar p/ assinatura'}
              </button>
            )}

            {s.status === 'AGUARDANDO_APROVACAO_GESTOR' && isDho && (
              <>
                <button
                  className="btn-primary w-full"
                  disabled={acao}
                  onClick={() => void executar('/aprovar-gestor')}
                >
                  Aprovar (gestor do CC)
                </button>
                <button
                  className="btn-soft w-full"
                  disabled={acao}
                  onClick={() => setModalMotivo('recusar')}
                >
                  Recusar
                </button>
              </>
            )}

            {s.status === 'AGUARDANDO_APROVACAO_DHO' && isDho && (
              <>
                <button
                  className="btn-primary w-full"
                  disabled={acao}
                  onClick={() => void executar('/aprovar-dho')}
                >
                  Aprovar (DHO) e gerar documento
                </button>
                <button
                  className="btn-soft w-full"
                  disabled={acao}
                  onClick={() => setModalMotivo('recusar')}
                >
                  Recusar
                </button>
              </>
            )}

            {s.status === 'AGUARDANDO_ASSINATURAS' && (
              <>
                {s.documento_url && (
                  <button
                    className="btn-soft w-full"
                    onClick={() =>
                      void baixarArquivo(
                        `/api/offboarding/${id}/documento`,
                        `termo-desligamento-${s.colaborador_matricula}.html`,
                      )
                    }
                  >
                    Baixar termo (PDF/HTML)
                  </button>
                )}
                {isDho && repFisica && (
                  <>
                    <p className="text-xs text-grafite-400">
                      Assinatura física: anexe o termo assinado, indique o
                      procurador e valide as assinaturas para liberar o encerramento.
                    </p>

                    {/* 1) Upload do documento assinado */}
                    <label className="btn-soft w-full cursor-pointer text-center">
                      {uploadando
                        ? 'Enviando…'
                        : s.documento_assinado_url
                          ? 'Substituir documento assinado'
                          : 'Anexar documento assinado'}
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        className="hidden"
                        disabled={uploadando}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void enviarDocAssinado(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {s.documento_assinado_url && (
                      <button
                        className="text-xs text-unifique-700 hover:underline"
                        onClick={() =>
                          void baixarArquivo(
                            `/api/offboarding/${id}/documento-assinado`,
                            s.documento_assinado_nome ?? 'termo-assinado',
                          )
                        }
                      >
                        ✓ {s.documento_assinado_nome ?? 'documento anexado'} — baixar
                      </button>
                    )}

                    {/* 2) Procurador que assinou como representante */}
                    <select
                      className="inp"
                      value={procuradorSel}
                      onChange={(e) => setProcuradorSel(e.target.value)}
                    >
                      <option value="">Procurador (representante)…</option>
                      {procuradores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                          {p.cargo ? ` — ${p.cargo}` : ''}
                        </option>
                      ))}
                    </select>

                    {/* 3) Validar assinaturas → libera o encerramento */}
                    <button
                      className="btn-primary w-full"
                      disabled={acao || !s.documento_assinado_url || !procuradorSel}
                      onClick={() =>
                        void executar('/validar-assinaturas', { procurador_id: procuradorSel })
                      }
                    >
                      Validar assinaturas e liberar encerramento
                    </button>
                    {!s.documento_assinado_url && (
                      <p className="text-xs text-grafite-400">
                        Anexe o documento assinado para habilitar a validação.
                      </p>
                    )}
                  </>
                )}

                {isDho && !repFisica && (
                  <>
                    <p className="text-xs text-grafite-400">
                      Assinatura digital (modo simulado): registre as assinaturas
                      (com o Autentique ligado, o webhook faz isso).
                    </p>
                    <button
                      className="btn-soft w-full"
                      disabled={acao}
                      onClick={() => void executar('/assinar', { papel: 'COLABORADOR' })}
                    >
                      Marcar assinado — Colaborador
                    </button>
                    <button
                      className="btn-soft w-full"
                      disabled={acao}
                      onClick={() => void executar('/assinar', { papel: 'REPRESENTANTE_EMPRESA' })}
                    >
                      Marcar assinado — Representante
                    </button>
                  </>
                )}
              </>
            )}

            {s.status === 'ASSINADO' && isDho && (
              <>
                {s.assinaturas_validadas_por_nome && (
                  <p className="text-xs text-green-700">
                    ✓ Assinaturas validadas por {s.assinaturas_validadas_por_nome}
                    {s.assinaturas_validadas_em ? ` em ${dt(s.assinaturas_validadas_em)}` : ''}.
                  </p>
                )}
                {s.documento_assinado_url && (
                  <button
                    className="btn-soft w-full"
                    onClick={() =>
                      void baixarArquivo(
                        `/api/offboarding/${id}/documento-assinado`,
                        s.documento_assinado_nome ?? 'termo-assinado',
                      )
                    }
                  >
                    Baixar documento assinado
                  </button>
                )}
                {s.documento_url && (
                  <button
                    className="btn-soft w-full"
                    onClick={() =>
                      void baixarArquivo(
                        `/api/offboarding/${id}/documento`,
                        `termo-desligamento-${s.colaborador_matricula}.html`,
                      )
                    }
                  >
                    Baixar termo gerado
                  </button>
                )}
                <button
                  className="btn-primary w-full"
                  disabled={acao}
                  onClick={() => void executar('/iniciar-encerramento')}
                >
                  Iniciar encerramento
                </button>
              </>
            )}

            {s.status === 'EM_ENCERRAMENTO' && (
              <button
                className="btn-primary w-full"
                disabled={acao}
                onClick={() => void executar('/concluir')}
              >
                Concluir offboarding
              </button>
            )}

            {!['CONCLUIDO', 'CANCELADO', 'RECUSADO'].includes(s.status) && (
              <button
                className="btn-ghost w-full text-red-600"
                disabled={acao}
                onClick={() => setModalMotivo('cancelar')}
              >
                Cancelar solicitação
              </button>
            )}
          </div>
        </div>
      </div>

      {modalMotivo && (
        <MotivoModal
          titulo={modalMotivo === 'recusar' ? 'Recusar solicitação' : 'Cancelar solicitação'}
          descricao={
            modalMotivo === 'recusar'
              ? 'O motivo ficará visível para o solicitante.'
              : 'Esta ação encerra a solicitação. Informe o motivo.'
          }
          label={modalMotivo === 'recusar' ? 'Motivo da recusa' : 'Motivo do cancelamento'}
          confirmarLabel={modalMotivo === 'recusar' ? 'Recusar' : 'Cancelar solicitação'}
          perigo
          carregando={acao}
          onClose={() => setModalMotivo(null)}
          onConfirmar={async (motivo) => {
            await executar(`/${modalMotivo}`, { motivo });
            setModalMotivo(null);
          }}
        />
      )}
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

/** Item booleano do checklist (Sim/Não/N.A.). */
function ItemChecklist({
  item,
  disabled,
  onResponder,
}: {
  item: ItemEncerramentoDTO;
  disabled: boolean;
  onResponder: (body: Record<string, unknown>) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="text-grafite-700">{item.titulo}</span>
      <div className="flex items-center gap-1.5">
        {item.status !== 'PENDENTE' ? (
          <span className={BADGE_ITEM_ENCERRAMENTO[item.status]}>
            {item.status === 'CONCLUIDO'
              ? item.resposta_bool === false
                ? 'Não'
                : 'Sim'
              : item.status === 'NAO_APLICAVEL'
                ? 'N/A'
                : item.status}
          </span>
        ) : null}
        <button
          className="btn-soft text-xs"
          disabled={disabled}
          onClick={() => onResponder({ resposta_bool: true })}
        >
          Sim
        </button>
        <button
          className="btn-soft text-xs"
          disabled={disabled}
          onClick={() => onResponder({ resposta_bool: false })}
        >
          Não
        </button>
        <button
          className="btn-ghost text-xs"
          disabled={disabled}
          onClick={() => onResponder({ nao_aplicavel: true })}
        >
          N/A
        </button>
      </div>
    </li>
  );
}
