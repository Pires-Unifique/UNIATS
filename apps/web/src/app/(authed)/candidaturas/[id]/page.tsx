'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { AgendarEntrevistaModal } from '@/components/AgendarEntrevistaModal';
import { EnviarMensagemModal } from '@/components/EnviarMensagemModal';
import { ProporHorariosModal } from '@/components/ProporHorariosModal';
import { EsteiraGupy } from '@/components/EsteiraGupy';
import { PageHeader } from '@/components/PageHeader';
import { ScoreBadge } from '@/components/ScoreBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatarData, formatarDataHora } from '@/lib/format';

interface MensagemHistorico {
  id: string;
  canal: string;
  direcao: string;
  template_codigo: string | null;
  status: string;
  destino: string | null;
  enviado_em: string | null;
  lido_em: string | null;
  criado_em: string;
}

interface EnqueteHorario {
  id: string;
  status: string; // AGUARDANDO | RESPONDIDA | CANCELADA
  pergunta: string;
  opcoes: Array<{ rotulo: string; inicio: string; fim: string }>;
  opcao_escolhida: string | null;
  inicio_escolhido: string | null;
  fim_escolhido: string | null;
  respondido_em: string | null;
  criado_em: string;
}

interface Score {
  tipo: string;
  valor: number;
  justificativa: string;
  evidencias: any;
  modelo: string;
  prompt_versao: string | null;
  revisado_por: string | null;
  revisado_em: string | null;
  criado_em: string;
}

interface CandidaturaDetalhe {
  id: string;
  gupy_id: string;
  vaga_id: string;
  status: string;
  etapa_gupy: string | null;
  inscrito_em: string | null;
  vaga: {
    id: string;
    gupy_id: string;
    titulo: string;
    status: string;
    gestor: { nome: string; email: string } | null;
    recrutador: { nome: string; email: string } | null;
  };
  candidato: {
    id: string;
    nome_completo: string;
    email: string | null;
    telefone: string | null;
    cidade: string | null;
    estado: string | null;
    linkedin_url: string | null;
    consentimento_lgpd_em: string | null;
    consentimento_gravacao_em: string | null;
    excluido_em: string | null;
  };
  curriculo: {
    resumo: string | null;
    competencias: string[];
    experiencias: any;
    formacoes: any;
    idiomas: any;
    certificacoes: any;
    anos_experiencia: number | null;
    parser_versao: string;
  } | null;
  scores: Score[];
  entrevistas: Array<{
    id: string;
    agendada_para: string;
    status: string;
    bot_status: string | null;
    meet_url: string | null;
  }>;
}

export default function CandidaturaPage({
  params,
}: {
  params: { id: string };
}) {
  const id = params.id;
  const { usuario } = useAuth();
  const [c, setC] = useState<CandidaturaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [acaoStatus, setAcaoStatus] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemHistorico[]>([]);
  const [enquetes, setEnquetes] = useState<EnqueteHorario[]>([]);
  const [modalContato, setModalContato] = useState(false);
  const [modalAgendar, setModalAgendar] = useState(false);
  const [modalPropor, setModalPropor] = useState(false);
  // Horário pré-selecionado ao abrir o agendamento (vindo da escolha da enquete).
  const [slotAgendar, setSlotAgendar] = useState<
    { inicio: string; fim: string } | undefined
  >(undefined);

  const carregarMensagens = useCallback(async () => {
    try {
      const lista = await api<MensagemHistorico[]>('/api/mensagens', {
        query: { candidaturaId: id },
      });
      setMensagens(lista);
    } catch {
      setMensagens([]);
    }
  }, [id]);

  const carregarEnquetes = useCallback(async () => {
    try {
      const lista = await api<EnqueteHorario[]>(
        `/api/mensagens/enquete-horarios/${id}`,
      );
      setEnquetes(lista);
    } catch {
      setEnquetes([]);
    }
  }, [id]);

  const carregar = useCallback(async () => {
    setErro(null);
    setCarregando(true);
    try {
      const resp = await api<CandidaturaDetalhe>(`/api/candidaturas/${id}`);
      setC(resp);
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao carregar candidatura.');
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
    void carregarMensagens();
    void carregarEnquetes();
  }, [carregar, carregarMensagens, carregarEnquetes]);

  async function aprovarScore() {
    if (!c || !usuario) return;
    setAcaoStatus(null);
    try {
      const r = await api<{ atualizados: number }>(
        `/api/candidaturas/${id}/score/aprovar`,
        {
          method: 'POST',
          body: { usuarioId: usuario.oid },
        },
      );
      if (r.atualizados === 0) {
        setAcaoStatus(
          'Não há análise de IA para aprovar. Classifique o candidato com IA antes (botão "Classificar com IA" no ranking da vaga).',
        );
        return;
      }
      setAcaoStatus(
        `Análise aprovada — revisão humana registrada (${r.atualizados} score(s)).`,
      );
      await carregar();
    } catch (err) {
      setAcaoStatus(
        err instanceof ApiError ? err.message : 'Falha ao aprovar.',
      );
    }
  }

  async function calcularScore() {
    setAcaoStatus(null);
    try {
      await api(`/api/candidaturas/${id}/score/calcular`, { method: 'POST' });
      setAcaoStatus('Score recalculado.');
      await carregar();
    } catch (err) {
      setAcaoStatus(
        err instanceof ApiError ? err.message : 'Falha ao calcular score.',
      );
    }
  }

  async function definirConsentimentoGravacao(consentir: boolean) {
    setAcaoStatus(null);
    try {
      await api(`/api/candidaturas/${id}/consentimento-gravacao`, {
        method: 'POST',
        body: { consentir },
      });
      setAcaoStatus(
        consentir
          ? 'Consentimento de gravação registrado.'
          : 'Consentimento de gravação revogado.',
      );
      await carregar();
    } catch (err) {
      setAcaoStatus(
        err instanceof ApiError
          ? err.message
          : 'Falha ao atualizar consentimento de gravação.',
      );
    }
  }

  if (carregando) {
    return <div className="text-sm text-grafite-400 p-4">Carregando…</div>;
  }
  if (erro) {
    return <div className="badge-red p-3">{erro}</div>;
  }
  if (!c) return null;

  const consolidado = c.scores.find((s) => s.tipo === 'CONSOLIDADO');
  const similaridade = c.scores.find((s) => s.tipo === 'SIMILARIDADE_VETORIAL');
  const rankingCv = c.scores.find((s) => s.tipo === 'RANKING_CV');
  // Há análise de IA a aprovar? (a classificação grava RANKING_CV + CONSOLIDADO)
  const temAnaliseIa = Boolean(consolidado || rankingCv);
  const aprovado = Boolean(rankingCv?.revisado_em || consolidado?.revisado_em);

  return (
    <div>
      <PageHeader
        titulo={c.candidato.nome_completo}
        subtitulo={`Candidatura para ${c.vaga.titulo}`}
        acoes={
          <>
            <Link
              href={`/vagas/${c.vaga_id}/ranking`}
              className="btn-secondary"
            >
              ← Ranking
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setModalContato(true)}
            >
              💬 Contatar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={aprovado || !temAnaliseIa}
              title={
                !temAnaliseIa
                  ? 'Sem análise de IA para aprovar — classifique o candidato com IA primeiro.'
                  : 'Registra a revisão humana da avaliação automática (LGPD Art. 20).'
              }
              onClick={() => void aprovarScore()}
            >
              {aprovado
                ? '✓ Análise aprovada'
                : 'Aprovar análise (LGPD Art. 20)'}
            </button>
          </>
        }
      />

      {modalContato && (
        <EnviarMensagemModal
          candidaturaId={id}
          candidato={c.candidato}
          recrutadorNome={usuario?.nome}
          onClose={() => setModalContato(false)}
          onSent={() => {
            setAcaoStatus('Mensagem enfileirada para envio.');
            void carregarMensagens();
          }}
        />
      )}
      {modalAgendar && (
        <AgendarEntrevistaModal
          candidaturaId={id}
          consentimentoGravacao={Boolean(c.candidato.consentimento_gravacao_em)}
          gestorEmail={c.vaga.gestor?.email}
          gestorNome={c.vaga.gestor?.nome}
          slotInicial={slotAgendar}
          onClose={() => {
            setModalAgendar(false);
            setSlotAgendar(undefined);
          }}
          onAgendada={() => {
            setAcaoStatus('Entrevista agendada.');
            setSlotAgendar(undefined);
            void carregar();
          }}
        />
      )}
      {modalPropor && (
        <ProporHorariosModal
          candidaturaId={id}
          gestorEmail={c.vaga.gestor?.email}
          gestorNome={c.vaga.gestor?.nome}
          onClose={() => setModalPropor(false)}
          onEnviada={() => {
            setAcaoStatus(
              'Enquete de horários enviada no WhatsApp — o candidato vota e a escolha aparece aqui.',
            );
            void carregarMensagens();
            void carregarEnquetes();
          }}
        />
      )}

      {acaoStatus && (
        <div className="badge-blue mb-4 px-3 py-2 w-full justify-start">
          {acaoStatus}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-4">
        <Stat label="Score consolidado" valor={consolidado?.valor ?? null} />
        <Stat label="Similaridade vetorial" valor={similaridade?.valor ?? null} />
        <Stat label="Ranking LLM" valor={rankingCv?.valor ?? null} />
      </div>

      <div className="mb-4">
        <EsteiraGupy
          jobId={c.vaga.gupy_id}
          applicationId={c.gupy_id}
          etapaAtual={c.etapa_gupy}
          onMoved={(aviso) => {
            setAcaoStatus(aviso);
            void carregar();
          }}
        />
      </div>

      {/* Justificativa do LLM */}
      {rankingCv && (
        <section className="card p-5 mb-4">
          <h2 className="font-medium text-grafite-900 mb-2">
            Justificativa da IA{' '}
            {rankingCv.prompt_versao && (
              <span className="text-xs text-grafite-400 ml-2">
                ({rankingCv.modelo} · {rankingCv.prompt_versao})
              </span>
            )}
          </h2>
          <p className="text-sm text-grafite-600 whitespace-pre-line">
            {rankingCv.justificativa}
          </p>

          {rankingCv.evidencias?.pontos_fortes?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase text-grafite-400 mb-1">
                Pontos fortes
              </div>
              <ul className="list-disc list-inside text-sm text-grafite-700">
                {rankingCv.evidencias.pontos_fortes.map(
                  (p: string, i: number) => (
                    <li key={i}>{p}</li>
                  ),
                )}
              </ul>
            </div>
          )}
          {rankingCv.evidencias?.lacunas?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase text-grafite-400 mb-1">
                Lacunas
              </div>
              <ul className="list-disc list-inside text-sm text-grafite-700">
                {rankingCv.evidencias.lacunas.map((p: string, i: number) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {rankingCv.evidencias?.evidencias?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase text-grafite-400 mb-1">
                Evidências citadas
              </div>
              <ul className="space-y-1 text-sm">
                {rankingCv.evidencias.evidencias.map((ev: any, i: number) => (
                  <li key={i} className="text-grafite-700">
                    <span
                      className={
                        ev.impacto === 'positivo'
                          ? 'badge-green'
                          : ev.impacto === 'negativo'
                            ? 'badge-red'
                            : 'badge-gray'
                      }
                    >
                      {ev.eixo}
                    </span>{' '}
                    <span className="italic text-grafite-600">
                      &ldquo;{ev.trecho}&rdquo;
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Currículo estruturado */}
      <section className="card p-5 mb-4">
        <h2 className="font-medium text-grafite-900 mb-3">Currículo</h2>
        {!c.curriculo ? (
          <p className="text-sm text-grafite-400">
            Currículo ainda não foi processado.
          </p>
        ) : (
          <>
            {c.curriculo.resumo && (
              <p className="text-sm text-grafite-700 mb-3">
                {c.curriculo.resumo}
              </p>
            )}
            {c.curriculo.anos_experiencia != null && (
              <p className="text-xs text-grafite-400 mb-2">
                {c.curriculo.anos_experiencia} anos de experiência (estimativa)
              </p>
            )}
            {c.curriculo.competencias.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {c.curriculo.competencias.map((k) => (
                  <span key={k} className="badge-blue">
                    {k}
                  </span>
                ))}
              </div>
            )}
            {Array.isArray(c.curriculo.experiencias) &&
              c.curriculo.experiencias.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs uppercase text-grafite-400 mb-1">
                    Experiências
                  </div>
                  <ul className="space-y-1 text-sm text-grafite-700">
                    {(c.curriculo.experiencias as any[]).map((e, i) => (
                      <li key={i}>
                        <span className="font-medium">{e.cargo}</span>{' '}
                        <span className="text-grafite-400">@ {e.empresa}</span>{' '}
                        <span className="text-grafite-400 text-xs">
                          ({e.inicio ?? '?'} – {e.fim ?? '?'})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </>
        )}
      </section>

      {/* Entrevistas */}
      <section className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-grafite-900">Entrevistas</h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setModalPropor(true)}
              title="Envia uma enquete no WhatsApp com opções de horário; o candidato vota e a escolha aparece aqui."
            >
              Propor horários
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => setModalAgendar(true)}
              title="Agenda direto em um horário já combinado."
            >
              Agendar entrevista
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => void calcularScore()}
            >
              Recalcular score
            </button>
          </div>
        </div>

        {/* Enquete de horários — escolha do candidato (quando houver) */}
        {enquetes[0] && (
          <div className="mb-3 rounded-md border border-grafite-200 p-3">
            {enquetes[0].status === 'RESPONDIDA' &&
            enquetes[0].inicio_escolhido ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-grafite-700">
                  <span className="badge-green mr-2">Candidato escolheu</span>
                  {enquetes[0].opcao_escolhida ??
                    formatarDataHora(enquetes[0].inicio_escolhido)}
                </div>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => {
                    setSlotAgendar({
                      inicio: enquetes[0].inicio_escolhido!,
                      fim:
                        enquetes[0].fim_escolhido ??
                        enquetes[0].inicio_escolhido!,
                    });
                    setModalAgendar(true);
                  }}
                >
                  Agendar neste horário
                </button>
              </div>
            ) : enquetes[0].status === 'AGUARDANDO' ? (
              <div className="text-sm text-grafite-600">
                <span className="badge-yellow mr-2">Enquete enviada</span>
                Aguardando o candidato votar entre {enquetes[0].opcoes.length}{' '}
                horário(s) no WhatsApp.
              </div>
            ) : (
              <div className="text-xs text-grafite-400">
                Enquete de horários anterior: {enquetes[0].status.toLowerCase()}.
              </div>
            )}
          </div>
        )}

        {c.entrevistas.length === 0 ? (
          <p className="text-sm text-grafite-400">
            Nenhuma entrevista agendada.
          </p>
        ) : (
          <ul className="divide-y divide-grafite-100">
            {c.entrevistas.map((e) => (
              <li key={e.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-sm text-grafite-900">
                    {formatarDataHora(e.agendada_para)}
                  </div>
                  <div className="text-xs text-grafite-400">
                    Bot: {e.bot_status ?? '—'}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={e.status} />
                  <Link
                    href={`/entrevistas/${e.id}`}
                    className="text-unifique-700 hover:underline text-xs"
                  >
                    Ver entrevista →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Histórico de mensagens */}
      <section className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-grafite-900">Histórico de mensagens</h2>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setModalContato(true)}
          >
            Nova mensagem
          </button>
        </div>
        {mensagens.length === 0 ? (
          <p className="text-sm text-grafite-400">
            Nenhuma mensagem enviada ainda.
          </p>
        ) : (
          <ul className="divide-y divide-grafite-100">
            {mensagens.map((m) => (
              <li key={m.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-sm text-grafite-900">
                    <span className="badge-gray mr-2">
                      {m.canal === 'WHATSAPP' ? 'WhatsApp' : m.canal}
                    </span>
                    {m.template_codigo ?? '—'}
                  </div>
                  <div className="text-xs text-grafite-400">
                    {formatarDataHora(m.enviado_em ?? m.criado_em)}
                    {m.destino ? ` · ${m.destino}` : ''}
                  </div>
                </div>
                <StatusBadge status={m.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* LGPD */}
      <section className="card p-5">
        <h2 className="font-medium text-grafite-900 mb-2">
          Consentimentos LGPD
        </h2>
        <ul className="text-sm space-y-1 text-grafite-600">
          <li>
            Geral:{' '}
            <span className={c.candidato.consentimento_lgpd_em ? 'badge-green' : 'badge-red'}>
              {c.candidato.consentimento_lgpd_em
                ? formatarData(c.candidato.consentimento_lgpd_em)
                : 'pendente'}
            </span>
          </li>
          <li>
            Gravação de voz:{' '}
            <span className={c.candidato.consentimento_gravacao_em ? 'badge-green' : 'badge-yellow'}>
              {c.candidato.consentimento_gravacao_em
                ? formatarData(c.candidato.consentimento_gravacao_em)
                : 'não coletado'}
            </span>
            {!c.candidato.excluido_em && (
              <button
                type="button"
                className="ml-2 text-xs text-unifique-700 hover:underline"
                onClick={() =>
                  void definirConsentimentoGravacao(
                    !c.candidato.consentimento_gravacao_em,
                  )
                }
              >
                {c.candidato.consentimento_gravacao_em ? 'Revogar' : 'Registrar'}
              </button>
            )}
          </li>
          <li>
            Revisão humana da análise de IA (Art. 20):{' '}
            <span
              className={
                aprovado
                  ? 'badge-green'
                  : temAnaliseIa
                    ? 'badge-yellow'
                    : 'badge-gray'
              }
            >
              {aprovado
                ? `aprovada em ${formatarData(
                    rankingCv?.revisado_em ?? consolidado?.revisado_em,
                  )}`
                : temAnaliseIa
                  ? 'pendente de aprovação'
                  : 'sem análise de IA'}
            </span>
          </li>
          {c.candidato.excluido_em && (
            <li>
              <span className="badge-red">
                Excluído por LGPD em {formatarData(c.candidato.excluido_em)}
              </span>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, valor }: { label: string; valor: number | null }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-grafite-400 mb-1">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {valor != null ? valor.toFixed(1) : '—'}
      </div>
      <ScoreBadge valor={valor} />
    </div>
  );
}
