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

  const [razoes, setRazoes] = useState('');
  const [dataAplicacao, setDataAplicacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
    setCargoAtual(c.cargo_atual ?? '');
    setLiderAtual(c.lider_nome ?? '');
    setBusca(`${c.nome} (${c.matricula})`);
    setResultados([]);
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

  const has = (t: TipoAlteracaoContratual) => tipos.has(t);

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
              Sem resultados? Preencha matrícula/nome manualmente nos campos de
              &quot;Situação atual&quot; (o espelho do Senior pode não estar
              sincronizado).
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-grafite-700 mb-1">
                  * Novo líder (nome)
                </label>
                <input
                  className="inp"
                  value={novoLiderNome}
                  onChange={(e) => setNovoLiderNome(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-grafite-700 mb-1">
                  Matrícula do novo líder
                </label>
                <input
                  className="inp"
                  value={novoLiderMatricula}
                  onChange={(e) => setNovoLiderMatricula(e.target.value)}
                />
              </div>
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

        {/* ---------- Situação atual (snapshot editável) ---------- */}
        <div className="card p-5 space-y-3 h-fit">
          <h2 className="text-sm font-semibold text-grafite-700 text-center border-b border-grafite-100 pb-2">
            Situação atual
          </h2>
          <Campo label="Colaborador" value={nome} onChange={setNome} />
          <Campo label="Matrícula" value={matricula} onChange={setMatricula} />
          <Campo label="Unidade" value={unidadeAtual} onChange={setUnidadeAtual} />
          <Campo
            label="Centro de custo"
            value={centroAtual}
            onChange={setCentroAtual}
          />
          <Campo label="Cargo" value={cargoAtual} onChange={setCargoAtual} />
          <Campo label="Líder" value={liderAtual} onChange={setLiderAtual} />
        </div>
      </div>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-grafite-500 mb-1">
        {label}
      </label>
      <input className="inp" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
