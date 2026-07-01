'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type {
  CargoDTO,
  CentroCustoDTO,
  ColaboradorDTO,
  ItemAlteracaoInputDTO,
  SolicitacaoAlteracaoDetalheDTO,
  TipoAlteracaoContratual,
  UnidadeDTO,
} from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { TIPOS_ALTERACAO } from '@/lib/alteracao-contratual';

function moedaBR(v: string): string {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && v !== ''
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '';
}

export default function NovaAlteracaoPage() {
  const router = useRouter();

  // catálogo (alimenta os selects de "novo valor")
  const [cargos, setCargos] = useState<CargoDTO[]>([]);
  const [unidades, setUnidades] = useState<UnidadeDTO[]>([]);
  const [centros, setCentros] = useState<CentroCustoDTO[]>([]);

  // colaborador (busca no espelho do Senior) + snapshot da situação atual
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ColaboradorDTO[]>([]);
  const [colaboradorId, setColaboradorId] = useState<string | null>(null);
  const [matricula, setMatricula] = useState('');
  const [nome, setNome] = useState('');
  const [unidadeAtual, setUnidadeAtual] = useState('');
  const [centroAtual, setCentroAtual] = useState('');
  const [colaboradorCentroId, setColaboradorCentroId] = useState<string | null>(null);
  const [cargoAtual, setCargoAtual] = useState('');
  const [liderAtual, setLiderAtual] = useState('');

  // tipos selecionados + valores novos
  const [tipos, setTipos] = useState<Set<TipoAlteracaoContratual>>(new Set());
  const [cargoNovoId, setCargoNovoId] = useState('');
  const [unidadeNovaId, setUnidadeNovaId] = useState('');
  const [centroNovoId, setCentroNovoId] = useState('');
  const [salarioAnterior, setSalarioAnterior] = useState('');
  const [salarioNovo, setSalarioNovo] = useState('');
  const [novoLiderNome, setNovoLiderNome] = useState('');
  const [novoLiderMatricula, setNovoLiderMatricula] = useState('');
  const [liderBusca, setLiderBusca] = useState('');
  const [liderResultados, setLiderResultados] = useState<ColaboradorDTO[]>([]);
  // CC do novo líder — regra: troca de líder só no MESMO CC; se for outro, o
  // sistema inclui também a mudança de CC (mover o colaborador junto).
  const [liderCentroId, setLiderCentroId] = useState<string | null>(null);
  const [liderCentroNome, setLiderCentroNome] = useState('');
  // Atributos do termo de cargo (SIM/NÃO) — null = não informado.
  const [diretrizComercial, setDiretrizComercial] = useState<boolean | null>(null);
  const [periculosidade, setPericulosidade] = useState<boolean | null>(null);
  const [aluguelFrota, setAluguelFrota] = useState<boolean | null>(null);

  const [razoes, setRazoes] = useState('');
  const [dataAplicacao, setDataAplicacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Pré-visualização (render do .docx oficial, sob demanda).
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [c, u, cc] = await Promise.all([
          api<CargoDTO[]>('/api/alteracao-contratual/catalogo/cargos'),
          api<UnidadeDTO[]>('/api/alteracao-contratual/catalogo/unidades'),
          api<CentroCustoDTO[]>('/api/alteracao-contratual/catalogo/centros-custo'),
        ]);
        setCargos(c);
        setUnidades(u);
        setCentros(cc);
      } catch {
        /* selects ficam vazios até o sync/import — ok no skeleton */
      }
    })();
  }, []);

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

  function selecionarColaborador(c: ColaboradorDTO) {
    setColaboradorId(c.id);
    setMatricula(c.matricula);
    setNome(c.nome);
    setUnidadeAtual(c.unidade_nome ?? '');
    setCentroAtual(c.centro_custo_nome ?? '');
    setColaboradorCentroId(c.centro_custo_id ?? null);
    setCargoAtual(c.cargo_atual ?? '');
    setLiderAtual(c.lider_nome ?? '');
    setBusca(`${c.nome} (${c.matricula})`);
    setResultados([]);
  }

  // Busca do NOVO líder na lista de colaboradores (por nome ou e-mail). A matrícula
  // é preenchida sozinha — não é dado que se sabe de cor de outros colaboradores.
  const buscarLider = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setLiderResultados([]);
      return;
    }
    try {
      const r = await api<ColaboradorDTO[]>(
        '/api/alteracao-contratual/catalogo/colaboradores',
        { query: { q } },
      );
      setLiderResultados(r);
    } catch {
      setLiderResultados([]);
    }
  }, []);

  function selecionarLider(c: ColaboradorDTO) {
    setNovoLiderNome(c.nome);
    setNovoLiderMatricula(c.matricula);
    setLiderCentroId(c.centro_custo_id ?? null);
    setLiderCentroNome(c.centro_custo_nome ?? '');
    setLiderBusca(`${c.nome} (${c.matricula})`);
    setLiderResultados([]);

    // Regra: se o novo líder é de OUTRO centro de custo, inclui também a
    // mudança de CC (o colaborador precisa ser movido junto).
    if (
      c.centro_custo_id &&
      colaboradorCentroId &&
      c.centro_custo_id !== colaboradorCentroId
    ) {
      setTipos((prev) => new Set(prev).add('CENTRO_CUSTO'));
      setCentroNovoId(c.centro_custo_id);
    }
  }

  function toggleTipo(t: TipoAlteracaoContratual) {
    setTipos((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function salvar() {
    setErro(null);
    if (tipos.size === 0) {
      setErro('Selecione ao menos um tipo de alteração.');
      return;
    }
    if (!matricula.trim() || !nome.trim()) {
      setErro('Informe a matrícula e o nome do colaborador.');
      return;
    }
    if (!razoes.trim()) {
      setErro('Informe as razões.');
      return;
    }
    if (!dataAplicacao) {
      setErro('Informe a data de início (aplicação).');
      return;
    }

    const itens: ItemAlteracaoInputDTO[] = [];
    if (tipos.has('CARGO')) {
      if (!cargoNovoId) return setErro('Selecione o novo cargo.');
      itens.push({ tipo: 'CARGO', cargo_novo_id: cargoNovoId });
    }
    if (tipos.has('UNIDADE')) {
      if (!unidadeNovaId) return setErro('Selecione a nova unidade.');
      itens.push({ tipo: 'UNIDADE', unidade_nova_id: unidadeNovaId });
    }
    if (tipos.has('CENTRO_CUSTO')) {
      if (!centroNovoId) return setErro('Selecione o novo centro de custo.');
      itens.push({ tipo: 'CENTRO_CUSTO', centro_custo_novo_id: centroNovoId });
    }
    if (tipos.has('SALARIO')) {
      if (!salarioAnterior || !salarioNovo)
        return setErro('Informe o salário antigo e o novo.');
      itens.push({
        tipo: 'SALARIO',
        salario_anterior: salarioAnterior,
        salario_novo: salarioNovo,
      });
    }
    if (tipos.has('LIDER')) {
      if (!novoLiderNome.trim()) return setErro('Informe o novo líder.');
      itens.push({
        tipo: 'LIDER',
        novo_lider_nome: novoLiderNome,
        novo_lider_matricula: novoLiderMatricula || null,
      });
    }

    // Regra: troca de líder cross-CC exige incluir a mudança de CC para o CC do líder.
    if (liderOutroCC && (!tipos.has('CENTRO_CUSTO') || centroNovoId !== liderCentroId)) {
      return setErro(
        `O novo líder é de outro centro de custo${liderCentroNome ? ` (${liderCentroNome})` : ''}. ` +
          `Inclua também a mudança de centro de custo para ${liderCentroNome || 'o CC do novo líder'}.`,
      );
    }

    setSalvando(true);
    try {
      const criada = await api<SolicitacaoAlteracaoDetalheDTO>(
        '/api/alteracao-contratual',
        {
          method: 'POST',
          body: {
            colaborador_id: colaboradorId,
            colaborador_matricula: matricula.trim(),
            colaborador_nome: nome.trim(),
            unidade_atual: unidadeAtual || null,
            centro_custo_atual: centroAtual || null,
            cargo_atual: cargoAtual || null,
            lider_atual: liderAtual || null,
            diretriz_comercial: tipos.has('CARGO') ? diretrizComercial : null,
            periculosidade: tipos.has('CARGO') ? periculosidade : null,
            aluguel_frota: tipos.has('CARGO') ? aluguelFrota : null,
            razoes: razoes.trim(),
            data_aplicacao: dataAplicacao,
            itens,
          },
        },
      );
      router.push(`/alteracao-contratual/${criada.id}` as Route);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar.');
      setSalvando(false);
    }
  }

  async function previsualizar(dados: unknown) {
    setPreviewLoading(true);
    setErro(null);
    try {
      const r = await api<{ html: string }>('/api/alteracao-contratual/preview', {
        method: 'POST',
        body: dados,
      });
      setPreviewHtml(r.html);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao gerar a pré-visualização.');
    } finally {
      setPreviewLoading(false);
    }
  }

  const has = (t: TipoAlteracaoContratual) => tipos.has(t);
  const cargoSelecionado = cargos.find((c) => c.id === cargoNovoId);
  // Novo líder é de outro centro de custo? (exige mover o CC junto)
  const liderOutroCC =
    tipos.has('LIDER') &&
    !!liderCentroId &&
    !!colaboradorCentroId &&
    liderCentroId !== colaboradorCentroId;

  // Dados do termo (pré-visualização ao vivo).
  const termoDados = {
    tipos: Array.from(tipos),
    colaboradorNome: nome,
    colaboradorMatricula: matricula,
    cargoAtual,
    cargoNovo: cargoSelecionado
      ? `${cargoSelecionado.titulo}${cargoSelecionado.senioridade ? ` — ${cargoSelecionado.senioridade}` : ''}`
      : '',
    cargoDescricao: cargoSelecionado?.descricao ?? null,
    diretrizComercial,
    periculosidade,
    aluguelFrota,
    centroAtual,
    centroNovo: centros.find((c) => c.id === centroNovoId)?.nome ?? '',
    unidadeAtual,
    unidadeNovo: unidades.find((u) => u.id === unidadeNovaId)?.nome ?? '',
    liderAtual,
    liderNovo: novoLiderNome,
    salarioAtual: moedaBR(salarioAnterior),
    salarioNovo: moedaBR(salarioNovo),
    razoes,
    dataAplicacao,
  };

  return (
    <div>
      <PageHeader
        titulo="Nova alteração contratual"
        subtitulo="Selecione o que muda, o colaborador e a data de aplicação."
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
              * Alteração
            </legend>
            <div className="flex flex-wrap gap-4">
              {TIPOS_ALTERACAO.map(({ tipo, label }) => (
                <label key={tipo} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={has(tipo)}
                    onChange={() => toggleTipo(tipo)}
                  />
                  {label}
                </label>
              ))}
            </div>
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
                    onClick={() => selecionarColaborador(c)}
                  >
                    {c.nome}{' '}
                    <span className="text-grafite-400">({c.matricula})</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-grafite-400 mt-1">
              Selecione o colaborador na busca — a &quot;Situação atual&quot; é
              preenchida automaticamente e não é editável.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-grafite-700 mb-1">
              * Razões
            </label>
            <textarea
              className="inp min-h-[80px]"
              value={razoes}
              onChange={(e) => setRazoes(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-grafite-700 mb-1">
              * Início (data de aplicação)
            </label>
            <input
              type="date"
              className="inp"
              value={dataAplicacao}
              onChange={(e) => setDataAplicacao(e.target.value)}
            />
          </div>

          {/* Campos condicionais por tipo selecionado */}
          {has('CARGO') && (
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Novo cargo
              </label>
              <select
                className="inp"
                value={cargoNovoId}
                onChange={(e) => setCargoNovoId(e.target.value)}
              >
                <option value="">Selecione o cargo</option>
                {cargos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.titulo}
                    {c.senioridade ? ` — ${c.senioridade}` : ''}
                  </option>
                ))}
              </select>
              {cargoSelecionado && (
                <p className="text-xs text-grafite-500 mt-1.5 leading-relaxed">
                  {cargoSelecionado.descricao || 'Este cargo ainda não tem descrição cadastrada.'}
                </p>
              )}
              <div className="mt-3 space-y-2">
                <SimNaoInput
                  rotulo="Possui Diretriz Comercial"
                  valor={diretrizComercial}
                  onChange={setDiretrizComercial}
                />
                <SimNaoInput
                  rotulo="Periculosidade"
                  valor={periculosidade}
                  onChange={setPericulosidade}
                />
                <SimNaoInput
                  rotulo="Possui Locação de Veículo"
                  valor={aluguelFrota}
                  onChange={setAluguelFrota}
                />
              </div>
            </div>
          )}

          {has('UNIDADE') && (
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Nova unidade
              </label>
              <select
                className="inp"
                value={unidadeNovaId}
                onChange={(e) => setUnidadeNovaId(e.target.value)}
              >
                <option value="">Selecione a unidade</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          {has('CENTRO_CUSTO') && (
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Novo centro de custo
              </label>
              <select
                className="inp"
                value={centroNovoId}
                onChange={(e) => setCentroNovoId(e.target.value)}
              >
                <option value="">Selecione o centro de custo</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          {has('SALARIO') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-grafite-700 mb-1">
                  * Salário antigo
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="inp"
                  value={salarioAnterior}
                  onChange={(e) => setSalarioAnterior(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-grafite-700 mb-1">
                  * Salário novo
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="inp"
                  value={salarioNovo}
                  onChange={(e) => setSalarioNovo(e.target.value)}
                />
              </div>
              <p className="col-span-2 text-xs text-grafite-400">
                O salário atual NÃO é consultado no Senior — informe os dois valores.
              </p>
            </div>
          )}

          {has('LIDER') && (
            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Novo líder
              </label>
              <input
                className="inp"
                placeholder="Busque por nome ou e-mail do novo líder"
                value={liderBusca}
                onChange={(e) => {
                  setLiderBusca(e.target.value);
                  setNovoLiderNome('');
                  setNovoLiderMatricula('');
                  void buscarLider(e.target.value);
                }}
              />
              {liderResultados.length > 0 && (
                <div className="card mt-1 max-h-48 overflow-auto divide-y divide-grafite-100">
                  {liderResultados.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-grafite-50"
                      onClick={() => selecionarLider(c)}
                    >
                      {c.nome}{' '}
                      <span className="text-grafite-400">
                        ({c.email || c.matricula})
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {novoLiderMatricula && (
                <p className="text-xs text-grafite-500 mt-1">
                  Matrícula do novo líder: <strong>{novoLiderMatricula}</strong>
                </p>
              )}
              {liderOutroCC && (
                <div className="mt-2 rounded-md bg-unifique-50 dark:bg-unifique-500/10 border border-unifique-100 dark:border-unifique-500/20 p-2.5 text-xs text-grafite-700">
                  O novo líder é de <strong>outro centro de custo</strong>
                  {liderCentroNome ? ` (${liderCentroNome})` : ''}. A troca de líder
                  só ocorre no mesmo CC, então incluímos automaticamente a{' '}
                  <strong>mudança de centro de custo</strong> — o colaborador será
                  movido junto{liderCentroNome ? ` para ${liderCentroNome}` : ''}.
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            <button
              className="btn-primary"
              disabled={salvando}
              onClick={() => void salvar()}
            >
              {salvando ? 'Salvando…' : 'Salvar/Gerar documento'}
            </button>
          </div>
        </div>

        {/* ---------- Situação atual (snapshot do colaborador — NÃO editável) ---------- */}
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

      {/* ---------- Pré-visualização do documento oficial (sob demanda) ---------- */}
      <div className="mt-6">
        <div className="flex items-center justify-center gap-3 mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-grafite-400">
            Pré-visualização do documento
          </h2>
          <button
            type="button"
            className="btn-soft text-xs"
            disabled={previewLoading}
            onClick={() => void previsualizar(termoDados)}
          >
            {previewLoading ? 'Gerando…' : 'Pré-visualizar'}
          </button>
        </div>
        {previewHtml ? (
          <div
            className="termo-doc card p-6 max-w-[800px] mx-auto overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <p className="text-center text-sm text-grafite-400">
            Preencha os campos e clique em “Pré-visualizar” para ver o termo preenchido.
          </p>
        )}
      </div>
    </div>
  );
}

/** Toggle SIM/NÃO (tri-estado: null = não informado). */
function SimNaoInput({
  rotulo,
  valor,
  onChange,
}: {
  rotulo: string;
  valor: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-grafite-700">{rotulo}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={
            valor === true
              ? 'btn-primary text-xs px-3 py-1'
              : 'btn-soft text-xs px-3 py-1'
          }
        >
          SIM
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={
            valor === false
              ? 'btn-primary text-xs px-3 py-1'
              : 'btn-soft text-xs px-3 py-1'
          }
        >
          NÃO
        </button>
      </div>
    </div>
  );
}

/** Campo somente-leitura da "Situação atual" (vem do colaborador selecionado). */
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
