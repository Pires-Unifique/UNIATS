'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';

// --- Tipos (espelham @uniats/shared) ---
type Grau = 'B' | 'I' | 'A';
type Nivel = 'JR' | 'PL' | 'SR';

interface Conhecimento {
  texto: string;
  grau: Grau | null;
  nivel: Nivel | null;
}
interface TemplateParsed {
  titulo: string | null;
  departamentoNome: string | null;
  missao: string | null;
  formacaoMinima: string | null;
  formacaoIdeal: string | null;
  conhecimentos: Conhecimento[];
  responsabilidades: string[];
  autonomiaNivel: Nivel | null;
  autonomiaParagrafos: string[];
  mensuravel: boolean | null;
  avisos: string[];
}
interface ImportarResp {
  template: TemplateParsed;
  arquivoSha256: string | null;
}
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

export default function PublicarVagaPage() {
  const [resp, setResp] = useState<ImportarResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [resultado, setResultado] = useState<{
    vagaId: string;
    status: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Campos editáveis
  const [titulo, setTitulo] = useState('');
  const [missao, setMissao] = useState('');
  const [formacaoMinima, setFormacaoMinima] = useState('');
  const [formacaoIdeal, setFormacaoIdeal] = useState('');
  const [conhecimentos, setConhecimentos] = useState('');
  const [responsabilidades, setResponsabilidades] = useState('');
  const [autonomia, setAutonomia] = useState('');
  const [nivel, setNivel] = useState<Nivel | ''>('');

  // Campos Gupy
  const [departamento, setDepartamento] = useState<OpcaoEstrutura | null>(null);
  const [cargo, setCargo] = useState<OpcaoEstrutura | null>(null);
  const [filial, setFilial] = useState<OpcaoEstrutura | null>(null);
  const [tipo, setTipo] = useState('effective');
  const [numVagas, setNumVagas] = useState(1);
  const [deadline, setDeadline] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [publicacao, setPublicacao] = useState('external');
  const [codigo, setCodigo] = useState('');
  const [recrutador, setRecrutador] = useState('');
  const [gestor, setGestor] = useState('');

  const aplicarTemplate = useCallback((t: TemplateParsed) => {
    setTitulo(t.titulo ?? '');
    setMissao(t.missao ?? '');
    setFormacaoMinima(t.formacaoMinima ?? '');
    setFormacaoIdeal(t.formacaoIdeal ?? '');
    setConhecimentos(
      t.conhecimentos
        .map((c) => (c.grau ? `${c.texto} [${c.grau}]` : c.texto))
        .join('\n'),
    );
    setResponsabilidades(t.responsabilidades.join('\n'));
    setAutonomia(t.autonomiaParagrafos.join('\n'));
    setNivel(t.autonomiaNivel ?? '');
  }, []);

  async function importar() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErro('Selecione um arquivo .xlsx.');
      return;
    }
    setErro(null);
    setResultado(null);
    setImportando(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      const data = await api<ImportarResp>('/api/vagas/template/importar', {
        method: 'POST',
        body: fd,
      });
      setResp(data);
      aplicarTemplate(data.template);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao importar.');
    } finally {
      setImportando(false);
    }
  }

  function parseConhecimentos(): Conhecimento[] {
    return conhecimentos
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(.*?)\s*\[([BIA])\]\s*$/i);
        if (m)
          return {
            texto: m[1].trim(),
            grau: m[2].toUpperCase() as Grau,
            nivel: null,
          };
        return { texto: l, grau: null, nivel: null };
      });
  }

  async function publicar(publicarAgora: boolean) {
    setErro(null);
    if (!titulo.trim() || !missao.trim()) {
      setErro('Título e missão são obrigatórios.');
      return;
    }
    if (!departamento || !cargo) {
      setErro('Selecione o departamento e o cargo da Gupy.');
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
        missao: missao.trim(),
        formacaoMinima: formacaoMinima.trim() || null,
        formacaoIdeal: formacaoIdeal.trim() || null,
        conhecimentos: parseConhecimentos(),
        responsabilidades: responsabilidades
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        autonomiaNivel: nivel || null,
        autonomiaParagrafos: autonomia
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        mensuravel: null,
        departmentId: departamento.id,
        roleId: cargo.id,
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
        arquivoSha256: resp?.arquivoSha256 ?? null,
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
        subtitulo="Importe o template padrão (Descrição do Cargo) e publique a vaga na Gupy."
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {resultado ? (
        <div className="card p-6 space-y-3">
          <div className="badge-green w-full justify-start px-3 py-2">
            Vaga {resultado.status === 'PUBLICADA' ? 'publicada' : 'salva como rascunho'}{' '}
            na Gupy com sucesso.
          </div>
          <Link href="/vagas" className="btn-primary inline-block">
            Ver vagas
          </Link>
        </div>
      ) : (
        <>
          {/* Etapa A — upload */}
          <div className="card p-4 mb-4">
            <label className="block text-sm font-medium text-grafite-700 mb-2">
              Arquivo do template (.xlsx)
            </label>
            <div className="flex gap-3 items-center">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="flex-1 text-sm"
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={importando}
                onClick={() => void importar()}
              >
                {importando ? 'Importando…' : 'Importar template'}
              </button>
            </div>
          </div>

          {resp && (
            <>
              {resp.template.avisos.length > 0 && (
                <div className="badge-yellow mb-4 w-full justify-start px-3 py-2 flex-col items-start">
                  <strong>Confira os campos abaixo:</strong>
                  <ul className="list-disc ml-5 mt-1">
                    {resp.template.avisos.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Etapa B — conteúdo (editável) */}
              <div className="card p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-grafite-900">Conteúdo da vaga</h2>
                <Campo label="Título do cargo">
                  <input
                    className="inp"
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                  />
                </Campo>
                <Campo label="Missão">
                  <textarea
                    className="inp h-24"
                    value={missao}
                    onChange={(e) => setMissao(e.target.value)}
                  />
                </Campo>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Campo label="Formação mínima">
                    <textarea
                      className="inp h-24"
                      value={formacaoMinima}
                      onChange={(e) => setFormacaoMinima(e.target.value)}
                    />
                  </Campo>
                  <Campo label="Formação ideal">
                    <textarea
                      className="inp h-24"
                      value={formacaoIdeal}
                      onChange={(e) => setFormacaoIdeal(e.target.value)}
                    />
                  </Campo>
                </div>
                <Campo label="Conhecimentos específicos (um por linha; grau opcional ex.: [A])">
                  <textarea
                    className="inp h-24"
                    value={conhecimentos}
                    onChange={(e) => setConhecimentos(e.target.value)}
                  />
                </Campo>
                <Campo label="Responsabilidades (uma por linha)">
                  <textarea
                    className="inp h-32"
                    value={responsabilidades}
                    onChange={(e) => setResponsabilidades(e.target.value)}
                  />
                </Campo>
                <Campo label="Autonomia e complexidade (uma por linha)">
                  <textarea
                    className="inp h-24"
                    value={autonomia}
                    onChange={(e) => setAutonomia(e.target.value)}
                  />
                </Campo>
                <Campo label="Nível do cargo">
                  <select
                    className="inp"
                    value={nivel}
                    onChange={(e) => setNivel(e.target.value as Nivel | '')}
                  >
                    <option value="">—</option>
                    <option value="JR">Júnior</option>
                    <option value="PL">Pleno</option>
                    <option value="SR">Sênior</option>
                  </select>
                </Campo>
              </div>

              {/* Etapa B — estrutura Gupy */}
              <div className="card p-4 mb-4 space-y-4">
                <h2 className="font-semibold text-grafite-900">
                  Estrutura e publicação na Gupy
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Campo label="Departamento *">
                    <EstruturaSelect
                      endpoint="departamentos"
                      sugestao={resp.template.departamentoNome}
                      valor={departamento}
                      onSelect={setDepartamento}
                    />
                  </Campo>
                  <Campo label="Cargo (role) *">
                    <EstruturaSelect
                      endpoint="cargos"
                      sugestao={resp.template.titulo}
                      valor={cargo}
                      onSelect={setCargo}
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
                  className="btn-secondary"
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
              className="btn-secondary px-2"
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
