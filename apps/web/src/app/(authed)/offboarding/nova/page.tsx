'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type {
  ColaboradorDTO,
  FormaAssinatura,
  OrigemOffboarding,
  SolicitacaoOffboardingDetalheDTO,
  TipoDesligamento,
} from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import {
  FORMAS_ASSINATURA,
  ORIGENS_OFFBOARDING,
  TIPOS_DESLIGAMENTO,
} from '@/lib/offboarding';

export default function NovaOffboardingPage() {
  const router = useRouter();

  // identidade / origem
  const [origem, setOrigem] = useState<OrigemOffboarding>('EMPREGADOR');

  // colaborador (busca no espelho do Senior) + snapshot da situação atual
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ColaboradorDTO[]>([]);
  const [colaboradorId, setColaboradorId] = useState<string | null>(null);
  const [matricula, setMatricula] = useState('');
  const [nome, setNome] = useState('');
  const [unidadeAtual, setUnidadeAtual] = useState('');
  const [centroAtual, setCentroAtual] = useState('');
  const [cargoAtual, setCargoAtual] = useState('');
  const [liderAtual, setLiderAtual] = useState('');

  // formulário
  const [tipo, setTipo] = useState<TipoDesligamento>('PEDIDO_COLABORADOR');
  const [cumpreAviso, setCumpreAviso] = useState(false);
  const [avisoDias, setAvisoDias] = useState('');
  const [motivo, setMotivo] = useState('');
  const [forma, setForma] = useState<FormaAssinatura>('DIGITAL');
  const [emailPessoal, setEmailPessoal] = useState('');
  const [whatsappPessoal, setWhatsappPessoal] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscarColaborador = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    try {
      const r = await api<ColaboradorDTO[]>(
        '/api/alteracao-contratual/catalogo/colaboradores',
        { query: { q } },
      );
      setResultados(r);
    } catch {
      setResultados([]);
    }
  }, []);

  async function selecionarColaborador(c: ColaboradorDTO) {
    setColaboradorId(c.id);
    setMatricula(c.matricula);
    setNome(c.nome);
    setUnidadeAtual(c.unidade_nome ?? '');
    setCentroAtual(c.centro_custo_nome ?? '');
    setCargoAtual(c.cargo_atual ?? '');
    setLiderAtual(c.lider_nome ?? '');
    setBusca(`${c.nome} (${c.matricula})`);
    setResultados([]);
    // Busca contatos pessoais na Senior (simulado por ora) — "verificar".
    try {
      const contatos = await api<{
        email_pessoal?: string | null;
        whatsapp_pessoal?: string | null;
      }>('/api/offboarding/contatos', { query: { matricula: c.matricula } });
      setEmailPessoal(contatos.email_pessoal ?? '');
      setWhatsappPessoal(contatos.whatsapp_pessoal ?? '');
    } catch {
      /* contatos ficam vazios — preenche manual */
    }
  }

  async function salvar() {
    setErro(null);
    if (!matricula.trim() || !nome.trim()) {
      setErro('Selecione o colaborador na busca.');
      return;
    }
    if (!motivo.trim()) {
      setErro('Informe o motivo do desligamento.');
      return;
    }
    if (cumpreAviso && (!avisoDias || Number(avisoDias) <= 0)) {
      setErro('Informe quantos dias de aviso prévio serão cumpridos.');
      return;
    }

    setSalvando(true);
    try {
      const criada = await api<SolicitacaoOffboardingDetalheDTO>('/api/offboarding', {
        method: 'POST',
        body: {
          origem,
          colaborador_id: colaboradorId,
          colaborador_matricula: matricula.trim(),
          colaborador_nome: nome.trim(),
          tipo_desligamento: tipo,
          cumpre_aviso_previo: cumpreAviso,
          aviso_previo_dias: cumpreAviso ? Number(avisoDias) : null,
          motivo: motivo.trim(),
          email_pessoal: emailPessoal.trim() || null,
          whatsapp_pessoal: whatsappPessoal.trim() || null,
          forma_assinatura: forma,
        },
      });
      router.push(`/offboarding/${criada.id}` as Route);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar.');
      setSalvando(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Nova solicitação de offboarding"
        subtitulo="Quem solicita, o colaborador, o tipo de desligamento e as condições."
      />

      {erro && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ---------- Formulário ---------- */}
        <div className="lg:col-span-2 card p-5 space-y-4">
          <fieldset>
            <legend className="text-sm font-medium text-grafite-700 mb-2">
              * Quem está solicitando
            </legend>
            <div className="flex flex-wrap gap-4">
              {ORIGENS_OFFBOARDING.map(({ origem: o, label }) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="origem"
                    checked={origem === o}
                    onChange={() => setOrigem(o)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {origem === 'EMPREGADOR' && (
              <p className="text-xs text-grafite-400 mt-1.5">
                Solicitação do empregador passa pelas aprovações do gestor do
                centro de custo e do DHO antes de gerar o documento.
              </p>
            )}
          </fieldset>

          <div>
            <label className="block text-sm font-medium text-grafite-700 mb-1">
              * Colaborador
            </label>
            <input
              className="inp"
              placeholder="Busque por nome ou matrícula"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setColaboradorId(null);
                void buscarColaborador(e.target.value);
              }}
            />
            {resultados.length > 0 && (
              <div className="card mt-1 max-h-48 overflow-auto divide-y divide-grafite-100">
                {resultados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-grafite-50"
                    onClick={() => void selecionarColaborador(c)}
                  >
                    {c.nome}{' '}
                    <span className="text-grafite-400">({c.matricula})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Tipo de desligamento
              </label>
              <select
                className="inp"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoDesligamento)}
              >
                {TIPOS_DESLIGAMENTO.map(({ tipo: t, label }) => (
                  <option key={t} value={t}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Forma de assinatura
              </label>
              <select
                className="inp"
                value={forma}
                onChange={(e) => setForma(e.target.value as FormaAssinatura)}
              >
                {FORMAS_ASSINATURA.map(({ forma: f, label }) => (
                  <option key={f} value={f}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                checked={cumpreAviso}
                onChange={(e) => setCumpreAviso(e.target.checked)}
              />
              Vai cumprir aviso prévio
            </label>
            {cumpreAviso && (
              <div className="flex-1 max-w-[160px]">
                <label className="block text-sm font-medium text-grafite-700 mb-1">
                  * Dias de aviso
                </label>
                <input
                  type="number"
                  min="1"
                  className="inp"
                  value={avisoDias}
                  onChange={(e) => setAvisoDias(e.target.value)}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-grafite-700 mb-1">
              * Motivo
            </label>
            <textarea
              className="inp min-h-[80px]"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                E-mail pessoal
              </label>
              <input
                className="inp"
                value={emailPessoal}
                onChange={(e) => setEmailPessoal(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                WhatsApp pessoal
              </label>
              <input
                className="inp"
                value={whatsappPessoal}
                onChange={(e) => setWhatsappPessoal(e.target.value)}
              />
            </div>
            <p className="sm:col-span-2 text-xs text-grafite-400">
              Contatos pré-preenchidos a partir do Senior (simulado) —{' '}
              <strong>verificar</strong> antes de seguir.
            </p>
          </div>

          <div className="pt-2">
            <button
              className="btn-primary"
              disabled={salvando}
              onClick={() => void salvar()}
            >
              {salvando ? 'Salvando…' : 'Criar solicitação'}
            </button>
          </div>
        </div>

        {/* ---------- Situação atual (snapshot do colaborador) ---------- */}
        <div className="card p-5 space-y-3 h-fit">
          <h2 className="text-sm font-semibold text-grafite-700 text-center border-b border-grafite-100 pb-2">
            Situação atual
          </h2>
          {!matricula && (
            <p className="text-xs text-grafite-400 text-center py-2">
              Selecione um colaborador para ver a situação atual.
            </p>
          )}
          <Campo label="Colaborador" value={nome} />
          <Campo label="Matrícula" value={matricula} />
          <Campo label="Unidade" value={unidadeAtual} />
          <Campo label="Centro de custo" value={centroAtual} />
          <Campo label="Cargo" value={cargoAtual} />
          <Campo label="Líder" value={liderAtual} />
        </div>
      </div>
    </div>
  );
}

function Campo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-grafite-500 mb-1">
        {label}
      </label>
      <div className="inp w-full bg-grafite-50 text-grafite-700 min-h-[38px] flex items-center">
        {value || <span className="text-grafite-300">—</span>}
      </div>
    </div>
  );
}
