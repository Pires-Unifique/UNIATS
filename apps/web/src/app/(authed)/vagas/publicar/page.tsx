'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CargoDTO } from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';

interface OpcaoEstrutura {
  id: number;
  nome: string;
}

const TIPOS: Array<{ v: string; l: string }> = [
  { v: 'effective', l: 'Efetivo' },
  { v: 'internship', l: 'Estágio' },
  { v: 'apprentice', l: 'Aprendiz' },
  { v: 'temporary', l: 'Temporário' },
  { v: 'associate', l: 'Associado' },
  { v: 'talent_pool', l: 'Banco de talentos' },
];

/** Quebra um textarea (um item por linha) em lista limpa. */
function linhas(texto: string): string[] {
  return texto
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function PublicarVagaPage() {
  const [cargos, setCargos] = useState<CargoDTO[]>([]);
  const [carregandoCargos, setCarregandoCargos] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] = useState<{
    vagaId: string;
    status: string;
  } | null>(null);

  // Cargo do catálogo (fonte da descrição) + conteúdo editável da vaga
  const [cargoId, setCargoId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [responsabilidades, setResponsabilidades] = useState('');
  const [requisitos, setRequisitos] = useState('');

  // Estrutura / publicação na Gupy
  const [departamento, setDepartamento] = useState<OpcaoEstrutura | null>(null);
  const [role, setRole] = useState<OpcaoEstrutura | null>(null);
  const [filial, setFilial] = useState<OpcaoEstrutura | null>(null);
  const [tipo, setTipo] = useState('effective');
  const [numVagas, setNumVagas] = useState(1);
  const [deadline, setDeadline] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [publicacao, setPublicacao] = useState('external');
  const [codigo, setCodigo] = useState('');
  const [recrutador, setRecrutador] = useState('');
  const [gestor, setGestor] = useState('');

  useEffect(() => {
    (async () => {
      setCarregandoCargos(true);
      try {
        const r = await api<CargoDTO[]>(
          '/api/alteracao-contratual/catalogo/cargos',
        );
        setCargos(r);
      } catch (err) {
        setErro(
          err instanceof ApiError ? err.message : 'Falha ao carregar cargos.',
        );
      } finally {
        setCarregandoCargos(false);
      }
    })();
  }, []);

  const cargoSelecionado = cargos.find((c) => c.id === cargoId) ?? null;

  function selecionarCargo(id: string) {
    setCargoId(id);
    const c = cargos.find((x) => x.id === id);
    if (c) {
      setTitulo(c.titulo);
      setDescricao(c.descricao ?? '');
      if (c.codigo) setCodigo(c.codigo);
    }
  }

  async function publicar(publicarAgora: boolean) {
    setErro(null);
    if (!cargoId) {
      setErro('Selecione um cargo do catálogo.');
      return;
    }
    if (!titulo.trim() || !descricao.trim()) {
      setErro('Título e descrição da vaga são obrigatórios.');
      return;
    }
    if (!departamento || !role) {
      setErro('Selecione o departamento e o cargo (role) da Gupy.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      setErro('Informe a data limite de contratação.');
      return;
    }
    setPublicando(true);
    try {
      const body = {
        titulo: titulo.trim(),
        departamentoNome: departamento.nome,
        missao: descricao.trim(),
        formacaoMinima: null,
        formacaoIdeal: null,
        conhecimentos: linhas(requisitos).map((texto) => ({
          texto,
          grau: null,
          nivel: null,
        })),
        responsabilidades: linhas(responsabilidades),
        autonomiaNivel: null,
        autonomiaParagrafos: [],
        mensuravel: null,
        departmentId: departamento.id,
        roleId: role.id,
        branchId: filial?.id ?? null,
        type: tipo,
        numVacancies: numVagas,
        hiringDeadline: deadline,
        workplaceType: workplace || null,
        publicationType: publicacao,
        code: codigo.trim() || null,
        recruiterEmail: recrutador.trim() || null,
        managerEmail: gestor.trim() || null,
        publicarAgora,
        arquivoSha256: null,
      };
      const r = await api<{ vagaId: string; status: string }>(
        '/api/vagas/template/publicar',
        { method: 'POST', body },
      );
      setResultado(r);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao publicar.');
    } finally {
      setPublicando(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Publicar vaga"
        subtitulo="Escolha um cargo do catálogo, confira a descrição e publique a vaga na Gupy."
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {resultado ? (
        <div className="card p-6 space-y-3">
          <div className="badge-green w-full justify-start px-3 py-2">
            Vaga{' '}
            {resultado.status === 'PUBLICADA'
              ? 'publicada'
              : 'salva como rascunho'}{' '}
            na Gupy com sucesso.
          </div>
          <Link href="/vagas" className="btn-primary inline-block">
            Ver vagas
          </Link>
        </div>
      ) : (
        <>
          {/* Etapa A — cargo do catálogo */}
          <div className="card p-4 mb-4 space-y-4">
            <h2 className="font-semibold text-grafite-900">Cargo do catálogo</h2>
            {carregandoCargos ? (
              <p className="text-sm text-grafite-400">Carregando cargos…</p>
            ) : cargos.length === 0 ? (
              <p className="text-sm text-grafite-500">
                Nenhum cargo cadastrado.{' '}
                <Link
                  href={'/cargos' as Route}
                  className="text-unifique-700 hover:underline"
                >
                  Cadastre um cargo
                </Link>{' '}
                antes de publicar a vaga.
              </p>
            ) : (
              <>
                <Campo label="Cargo *">
                  <select
                    className="inp"
                    value={cargoId}
                    onChange={(e) => selecionarCargo(e.target.value)}
                  >
                    <option value="">Selecione o cargo</option>
                    {cargos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.titulo}
                        {c.senioridade ? ` — ${c.senioridade}` : ''}
                      </option>
                    ))}
                  </select>
                </Campo>
                {cargoSelecionado && (
                  <div className="rounded-md bg-grafite-50 border border-grafite-100 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-grafite-400 mb-1">
                      Descrição do cargo
                    </p>
                    <p className="text-sm text-grafite-700 leading-relaxed whitespace-pre-wrap">
                      {cargoSelecionado.descricao ||
                        'Este cargo ainda não tem descrição cadastrada. Edite-o em Cargos para preenchê-la.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {cargoSelecionado && (
            <>
              {/* Etapa B — conteúdo da vaga (editável) */}
              <div className="card p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-grafite-900">
                  Conteúdo da vaga
                </h2>
                <Campo label="Título da vaga *">
                  <input
                    className="inp"
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                  />
                </Campo>
                <Campo label="Descrição da vaga *">
                  <textarea
                    className="inp h-40"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                  />
                  <span className="block text-xs text-grafite-400 mt-1">
                    Pré-preenchida com a descrição do cargo. Ajuste para esta vaga
                    se precisar.
                  </span>
                </Campo>
                <Campo label="Responsabilidades (opcional, uma por linha)">
                  <textarea
                    className="inp h-28"
                    value={responsabilidades}
                    onChange={(e) => setResponsabilidades(e.target.value)}
                  />
                </Campo>
                <Campo label="Requisitos / conhecimentos (opcional, um por linha)">
                  <textarea
                    className="inp h-28"
                    value={requisitos}
                    onChange={(e) => setRequisitos(e.target.value)}
                  />
                </Campo>
              </div>

              {/* Etapa C — estrutura Gupy */}
              <div className="card p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-grafite-900">
                  Estrutura e publicação na Gupy
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Campo label="Departamento *">
                    <EstruturaSelect
                      endpoint="departamentos"
                      sugestao={null}
                      valor={departamento}
                      onSelect={setDepartamento}
                    />
                  </Campo>
                  <Campo label="Cargo na Gupy (role) *">
                    <EstruturaSelect
                      endpoint="cargos"
                      sugestao={cargoSelecionado.titulo}
                      valor={role}
                      onSelect={setRole}
                    />
                  </Campo>
                  <Campo label="Filial">
                    <EstruturaSelect
                      endpoint="filiais"
                      sugestao={null}
                      valor={filial}
                      onSelect={setFilial}
                    />
                  </Campo>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Campo label="Data limite de contratação *">
                    <input
                      type="date"
                      className="inp"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </Campo>
                  <Campo label="Nº de vagas">
                    <input
                      type="number"
                      min={1}
                      className="inp"
                      value={numVagas}
                      onChange={(e) => setNumVagas(Number(e.target.value) || 1)}
                    />
                  </Campo>
                  <Campo label="Tipo de contratação">
                    <select
                      className="inp"
                      value={tipo}
                      onChange={(e) => setTipo(e.target.value)}
                    >
                      {TIPOS.map((t) => (
                        <option key={t.v} value={t.v}>
                          {t.l}
                        </option>
                      ))}
                    </select>
                  </Campo>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Campo label="Modelo de trabalho">
                    <select
                      className="inp"
                      value={workplace}
                      onChange={(e) => setWorkplace(e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="on-site">Presencial</option>
                      <option value="hybrid">Híbrido</option>
                      <option value="remote">Remoto</option>
                    </select>
                  </Campo>
                  <Campo label="Visibilidade">
                    <select
                      className="inp"
                      value={publicacao}
                      onChange={(e) => setPublicacao(e.target.value)}
                    >
                      <option value="external">Externa</option>
                      <option value="internal">Interna</option>
                    </select>
                  </Campo>
                  <Campo label="Código interno (opcional)">
                    <input
                      className="inp"
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value)}
                    />
                  </Campo>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Campo label="E-mail do recrutador (opcional)">
                    <input
                      className="inp"
                      type="email"
                      value={recrutador}
                      onChange={(e) => setRecrutador(e.target.value)}
                    />
                  </Campo>
                  <Campo label="E-mail do gestor (opcional)">
                    <input
                      className="inp"
                      type="email"
                      value={gestor}
                      onChange={(e) => setGestor(e.target.value)}
                    />
                  </Campo>
                </div>
              </div>

              <div className="flex gap-3 justify-end mb-10">
                <button
                  type="button"
                  className="btn-soft"
                  disabled={publicando}
                  onClick={() => void publicar(false)}
                >
                  {publicando ? 'Enviando…' : 'Salvar rascunho na Gupy'}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={publicando}
                  onClick={() => void publicar(true)}
                >
                  {publicando ? 'Publicando…' : 'Publicar agora'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-grafite-700 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Select assíncrono de estrutura organizacional da Gupy (com sugestão). */
function EstruturaSelect({
  endpoint,
  sugestao,
  valor,
  onSelect,
}: {
  endpoint: 'departamentos' | 'cargos' | 'filiais';
  sugestao: string | null;
  valor: OpcaoEstrutura | null;
  onSelect: (o: OpcaoEstrutura | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [opcoes, setOpcoes] = useState<OpcaoEstrutura[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciado, setIniciado] = useState(false);

  const carregar = useCallback(
    async (q: string) => {
      setCarregando(true);
      setErro(null);
      try {
        const r = await api<OpcaoEstrutura[]>(`/api/gupy/estrutura/${endpoint}`, {
          query: { q: q || undefined },
        });
        setOpcoes(r);
      } catch (err) {
        setErro(err instanceof ApiError ? err.message : 'Falha ao buscar.');
        setOpcoes([]);
      } finally {
        setCarregando(false);
      }
    },
    [endpoint],
  );

  // Carrega sugestões na primeira interação (foco).
  function aoFocar() {
    if (!iniciado) {
      setIniciado(true);
      void carregar(sugestao ?? '');
    }
  }

  return (
    <div>
      {valor ? (
        <div className="flex items-center gap-2">
          <span className="badge-green px-2 py-1 text-xs">{valor.nome}</span>
          <button
            type="button"
            className="text-xs text-grafite-500 hover:underline"
            onClick={() => onSelect(null)}
          >
            trocar
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              className="inp"
              placeholder="Buscar…"
              value={busca}
              onFocus={aoFocar}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void carregar(busca);
                }
              }}
            />
            <button
              type="button"
              className="btn-soft px-2"
              onClick={() => void carregar(busca)}
            >
              🔍
            </button>
          </div>
          {carregando && (
            <p className="text-xs text-grafite-400 mt-1">Buscando…</p>
          )}
          {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
          {opcoes.length > 0 && (
            <ul className="border border-grafite-200 rounded-md mt-1 max-h-40 overflow-auto bg-white">
              {opcoes.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-grafite-50"
                    onClick={() => onSelect(o)}
                  >
                    {o.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
