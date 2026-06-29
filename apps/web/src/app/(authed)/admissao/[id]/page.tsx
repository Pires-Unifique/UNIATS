'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type {
  AdmissaoDetalheDTO,
  ResultadoExameAdmissional,
  RgExtraidoDTO,
  SolicitacaoAcessoDTO,
  StatusAdmissao,
  StatusDocumentoAdmissional,
} from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { formatarData, formatarDataHora } from '@/lib/format';
import { ETAPAS_ADMISSAO, ROTULO_ETAPA_ADMISSAO } from '@/lib/admissao';

const ROTULO_DOC: Record<string, string> = {
  RG: 'RG',
  CPF: 'CPF',
  CTPS: 'Carteira de Trabalho (CTPS)',
  TITULO_ELEITOR: 'Título de eleitor',
  PIS_NIS: 'PIS/NIS',
  COMPROVANTE_RESIDENCIA: 'Comprovante de residência',
  COMPROVANTE_ESCOLARIDADE: 'Comprovante de escolaridade',
  CERTIDAO_NASCIMENTO_CASAMENTO: 'Certidão de nascimento/casamento',
  RESERVISTA: 'Certificado de reservista',
  DADOS_BANCARIOS: 'Dados bancários',
  FOTO_3X4: 'Foto 3x4',
  DEPENDENTES: 'Documentos de dependentes',
  OUTRO: 'Outro',
};

export default function AdmissaoDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [a, setA] = useState<AdmissaoDetalheDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoDoc, setEnviandoDoc] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const det = await api<AdmissaoDetalheDTO>(`/api/admissoes/${id}`);
      setA(det);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar admissão.');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Enquanto algum RG estiver ENVIADO mas ainda sem OCR, o resultado chega de
  // forma assíncrona (fila) — então recarrega a cada 5s até aparecer.
  const rgProcessando = (a?.documentos ?? []).some(
    (d) => d.tipo === 'RG' && d.status === 'ENVIADO' && !d.ocr_processado_em,
  );
  useEffect(() => {
    if (!rgProcessando) return;
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [rgProcessando, carregar]);

  async function acao<T>(fn: () => Promise<T>) {
    setSalvando(true);
    setErro(null);
    try {
      await fn();
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Operação falhou.');
    } finally {
      setSalvando(false);
    }
  }

  function transicionar(para: StatusAdmissao) {
    void acao(() =>
      api(`/api/admissoes/${id}/status`, { method: 'PATCH', body: { para } }),
    );
  }
  function cancelar() {
    const motivo = window.prompt('Motivo do cancelamento da admissão:');
    if (!motivo?.trim()) return;
    void acao(() =>
      api(`/api/admissoes/${id}/cancelar`, {
        method: 'POST',
        body: { motivo },
      }),
    );
  }
  function avaliarDoc(docId: string, status: StatusDocumentoAdmissional) {
    let motivo_recusa: string | undefined;
    if (status === 'REPROVADO') {
      motivo_recusa = window.prompt('Motivo da recusa:') ?? undefined;
      if (!motivo_recusa) return;
    }
    void acao(() =>
      api(`/api/admissoes/${id}/documentos/${docId}`, {
        method: 'PATCH',
        body: { status, motivo_recusa },
      }),
    );
  }
  function salvarExame(resultado: ResultadoExameAdmissional) {
    void acao(() =>
      api(`/api/admissoes/${id}/exame`, {
        method: 'PATCH',
        body: { resultado },
      }),
    );
  }
  async function enviarArquivo(docId: string, file: File) {
    setEnviandoDoc(docId);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      await api(`/api/admissoes/${id}/documentos/${docId}/arquivo`, {
        method: 'POST',
        body: fd,
      });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao enviar arquivo.');
    } finally {
      setEnviandoDoc(null);
    }
  }

  if (erro && !a) {
    return (
      <div>
        <PageHeader titulo="Admissão" />
        <div className="badge-red w-full justify-start px-3 py-2">{erro}</div>
      </div>
    );
  }
  if (!a) {
    return (
      <div>
        <PageHeader titulo="Admissão" />
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      </div>
    );
  }

  const idxAtual = ETAPAS_ADMISSAO.indexOf(a.status);
  const cancelada = a.status === 'CANCELADA';
  const concluida = a.status === 'CONCLUIDA';
  const proxima = idxAtual >= 0 ? ETAPAS_ADMISSAO[idxAtual + 1] : undefined;
  const anterior = idxAtual > 0 ? ETAPAS_ADMISSAO[idxAtual - 1] : undefined;

  return (
    <div>
      <PageHeader
        titulo={a.candidato.nome_completo}
        subtitulo={`${a.cargo ?? a.vaga?.titulo ?? 'Admissão'} · ${a.candidato.email ?? '—'}`}
        acoes={
          <div className="flex items-center gap-2">
            <Link href="/admissao" className="text-sm text-grafite-500 hover:underline">
              ← Voltar
            </Link>
            <StatusBadge status={a.status} />
          </div>
        }
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {/* Stepper */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {ETAPAS_ADMISSAO.map((etapa, i) => {
            const feita = !cancelada && i < idxAtual;
            const atual = !cancelada && i === idxAtual;
            return (
              <div
                key={etapa}
                className={
                  'text-xs px-2.5 py-1 rounded-full border ' +
                  (atual
                    ? 'bg-unifique-600 text-[#fff] border-unifique-600'
                    : feita
                      ? 'bg-unifique-50 text-unifique-700 border-unifique-200 dark:bg-unifique-500/15 dark:text-unifique-400 dark:border-unifique-500/30'
                      : 'bg-white text-grafite-400 border-grafite-200')
                }
              >
                {i + 1}. {ROTULO_ETAPA_ADMISSAO[etapa]}
              </div>
            );
          })}
        </div>

        {!cancelada && !concluida && (
          <div className="flex flex-wrap gap-2 mt-4">
            {proxima && (
              <button
                className="btn-primary text-sm disabled:opacity-50"
                disabled={salvando}
                onClick={() => transicionar(proxima)}
              >
                Avançar → {ROTULO_ETAPA_ADMISSAO[proxima]}
              </button>
            )}
            {anterior && (
              <button
                className="btn-soft text-sm disabled:opacity-50"
                disabled={salvando}
                onClick={() => transicionar(anterior)}
              >
                ← Voltar etapa
              </button>
            )}
            <button
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
              disabled={salvando}
              onClick={cancelar}
            >
              Cancelar admissão
            </button>
          </div>
        )}
        {cancelada && a.motivo_cancelamento && (
          <p className="text-sm text-red-600 mt-3">
            Cancelada: {a.motivo_cancelamento}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coluna principal */}
        <div className="lg:col-span-2 space-y-4">
          {/* Documentos */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-grafite-100 font-medium text-grafite-800">
              Documentos
            </div>
            <table className="w-full text-sm">
              <tbody>
                {a.documentos.map((d) => {
                  const processandoRg =
                    d.tipo === 'RG' &&
                    d.status === 'ENVIADO' &&
                    !d.ocr_processado_em;
                  return (
                    <tr
                      key={d.id}
                      className="border-t border-grafite-100 align-top"
                    >
                      <td className="px-4 py-2.5">
                        <span className="text-grafite-800">
                          {ROTULO_DOC[d.tipo] ?? d.tipo}
                        </span>
                        {d.obrigatorio && (
                          <span
                            className="text-red-500 ml-1"
                            title="Obrigatório"
                          >
                            *
                          </span>
                        )}
                        {d.arquivo_url && (
                          <div className="text-xs text-grafite-400 mt-0.5">
                            📎 {d.nome_arquivo ?? 'arquivo enviado'}
                          </div>
                        )}
                        {d.status === 'REPROVADO' && d.motivo_recusa && (
                          <div className="text-xs text-red-500 mt-0.5">
                            {d.motivo_recusa}
                          </div>
                        )}
                        {processandoRg && (
                          <div className="text-xs text-unifique-600 mt-1">
                            🤖 Lendo o documento com IA…
                          </div>
                        )}
                        {d.dados_extraidos_json && (
                          <DadosRg rg={d.dados_extraidos_json} />
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {!cancelada && !concluida && (
                          <div className="flex items-center justify-end gap-3">
                            <label
                              className={
                                'text-xs text-unifique-700 hover:underline cursor-pointer ' +
                                (enviandoDoc === d.id
                                  ? 'opacity-50 pointer-events-none'
                                  : '')
                              }
                            >
                              {enviandoDoc === d.id
                                ? 'Enviando…'
                                : d.arquivo_url
                                  ? 'Substituir'
                                  : 'Enviar arquivo'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                                className="hidden"
                                disabled={salvando || enviandoDoc !== null}
                                onChange={(ev) => {
                                  const f = ev.target.files?.[0];
                                  ev.target.value = '';
                                  if (f) void enviarArquivo(d.id, f);
                                }}
                              />
                            </label>
                            <button
                              className="text-xs text-unifique-700 hover:underline disabled:opacity-50"
                              disabled={salvando || d.status === 'APROVADO'}
                              onClick={() => avaliarDoc(d.id, 'APROVADO')}
                            >
                              Aprovar
                            </button>
                            <button
                              className="text-xs text-red-600 hover:underline disabled:opacity-50"
                              disabled={salvando || d.status === 'REPROVADO'}
                              onClick={() => avaliarDoc(d.id, 'REPROVADO')}
                            >
                              Recusar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Exame admissional */}
          <div className="card p-4">
            <div className="font-medium text-grafite-800 mb-2">
              Exame admissional (ASO)
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <StatusBadge status={a.exame?.resultado ?? 'PENDENTE'} />
              {a.exame?.agendado_para && (
                <span className="text-sm text-grafite-500">
                  Agendado: {formatarData(a.exame.agendado_para)}
                </span>
              )}
              {!cancelada && !concluida && (
                <select
                  className="border border-grafite-200 rounded-md px-2 py-1 text-sm bg-white ml-auto"
                  value={a.exame?.resultado ?? 'PENDENTE'}
                  disabled={salvando}
                  onChange={(e) =>
                    salvarExame(e.target.value as ResultadoExameAdmissional)
                  }
                >
                  <option value="PENDENTE">Pendente</option>
                  <option value="APTO">Apto</option>
                  <option value="APTO_COM_RESTRICOES">Apto c/ restrições</option>
                  <option value="INAPTO">Inapto</option>
                </select>
              )}
            </div>
            {a.exame?.restricoes && (
              <p className="text-sm text-grafite-500 mt-2">{a.exame.restricoes}</p>
            )}
          </div>
        </div>

        {/* Coluna lateral */}
        <div className="space-y-4">
          {/* Dados da contratação */}
          <div className="card p-4 text-sm space-y-1.5">
            <div className="font-medium text-grafite-800 mb-1">Contratação</div>
            <Linha rotulo="Cargo" valor={a.cargo} />
            <Linha
              rotulo="Salário"
              valor={a.salario ? `R$ ${a.salario}` : null}
            />
            <Linha rotulo="Tipo" valor={a.tipo_contratacao} />
            <Linha rotulo="Jornada" valor={a.jornada} />
            <Linha rotulo="Admissão prevista" valor={formatarData(a.data_admissao)} />
            <Linha rotulo="Matrícula" valor={a.matricula} />
            <Linha rotulo="eSocial" valor={a.esocial_recibo} />
            <Linha rotulo="Vaga" valor={a.vaga?.titulo} />
            <Linha rotulo="Telefone" valor={a.candidato.telefone} />
          </div>

          {/* Criação de acesso (AD) */}
          {a.solicitacao_acesso && <AcessoCard sol={a.solicitacao_acesso} />}

          {/* Timeline */}
          <div className="card p-4">
            <div className="font-medium text-grafite-800 mb-2">Histórico</div>
            <ol className="space-y-2">
              {a.eventos.map((ev) => (
                <li key={ev.id} className="text-sm">
                  <div className="text-grafite-700">
                    {ROTULO_ETAPA_ADMISSAO[ev.para_status]}
                  </div>
                  <div className="text-xs text-grafite-400">
                    {formatarDataHora(ev.criado_em)}
                    {ev.observacao ? ` · ${ev.observacao}` : ''}
                  </div>
                </li>
              ))}
            </ol>
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
      <span className="text-grafite-800 text-right">{valor || '—'}</span>
    </div>
  );
}

/** Dados lidos do RG por IA — exibidos com selo "conferir". */
function DadosRg({ rg }: { rg: RgExtraidoDTO }) {
  const rgLinha = rg.rg_numero
    ? `${rg.rg_numero}${
        rg.orgao_emissor
          ? ` ${rg.orgao_emissor}${rg.uf ? `/${rg.uf}` : ''}`
          : ''
      }`
    : undefined;
  const itens: Array<[string, string | undefined]> = [
    ['Nome', rg.nome_completo],
    ['RG', rgLinha],
    ['Nascimento', rg.data_nascimento],
    ['CPF', rg.cpf],
  ];
  const visiveis = itens.filter(([, v]) => v);
  if (visiveis.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-unifique-200 bg-unifique-50/60 p-2 text-xs dark:border-unifique-500/30 dark:bg-unifique-500/10">
      <div className="font-medium text-unifique-700 mb-1">
        Lido do RG por IA — conferir
        {rg.confianca ? ` · confiança ${rg.confianca}` : ''}
      </div>
      {visiveis.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-grafite-400">{k}</span>
          <span className="text-grafite-700 text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Estado do gatilho de criação de acesso (chamado no Acelerato). */
function AcessoCard({ sol }: { sol: SolicitacaoAcessoDTO }) {
  const ROTULO: Record<string, string> = {
    PENDENTE: 'Pendente',
    ENVIADA: 'Chamado aberto',
    FALHADA: 'Falhou',
  };
  return (
    <div className="card p-4 text-sm space-y-1.5">
      <div className="font-medium text-grafite-800 mb-1">
        Criação de acesso (AD)
      </div>
      <Linha rotulo="Status" valor={ROTULO[sol.status] ?? sol.status} />
      <Linha rotulo="Nome enviado" valor={sol.nome_enviado} />
      {sol.url_externa && (
        <a
          href={sol.url_externa}
          target="_blank"
          rel="noreferrer"
          className="text-unifique-700 hover:underline block pt-1"
        >
          Abrir chamado no Acelerato →
        </a>
      )}
      {sol.status === 'FALHADA' && sol.erro && (
        <p className="text-xs text-red-500">{sol.erro}</p>
      )}
    </div>
  );
}
