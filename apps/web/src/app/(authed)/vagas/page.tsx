'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatarData } from '@/lib/format';

interface Pessoa {
  nome: string;
  email: string;
}

interface VagaResumo {
  id: string;
  gupy_id: string;
  codigo: string | null;
  titulo: string;
  departamento: string | null;
  unidade: string | null;
  cidade: string | null;
  estado: string | null;
  remoto: boolean;
  status: string;
  data_publicacao: string | null;
  atualizado_em: string;
  qtdCandidaturas: number;
  gestor: Pessoa | null;
  recrutador: Pessoa | null;
}

/** Chave estável p/ filtrar por pessoa (e-mail quando houver; senão o nome). */
function chavePessoa(p: Pessoa | null): string {
  return p ? p.email || p.nome : '';
}

/** Opções únicas de gestor/recrutador presentes na lista carregada. */
function opcoesPessoas(
  vagas: VagaResumo[] | null,
  campo: 'gestor' | 'recrutador',
): Pessoa[] {
  const porChave = new Map<string, Pessoa>();
  for (const v of vagas ?? []) {
    const p = v[campo];
    if (p && !porChave.has(chavePessoa(p))) porChave.set(chavePessoa(p), p);
  }
  return [...porChave.values()].sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR'),
  );
}

/** Valida o valor de ?pendencia= (deep-link do painel inicial). */
const PENDENCIAS_VALIDAS = [
  'sem_candidatura',
  'candidaturas_paradas',
  'enquete_sem_resposta',
];
function validarPendencia(valor: string | null): string {
  return valor && PENDENCIAS_VALIDAS.includes(valor) ? valor : '';
}

/** Local exibido/filtrado — mesma regra da coluna da tabela. */
function localDaVaga(v: VagaResumo): string {
  return v.remoto
    ? 'Remoto'
    : [v.cidade, v.estado].filter(Boolean).join(' / ');
}

/** Valores únicos (não vazios) de um campo derivado, ordenados pt-BR. */
function opcoesTexto(
  vagas: VagaResumo[] | null,
  extrair: (v: VagaResumo) => string | null,
): string[] {
  const set = new Set<string>();
  for (const v of vagas ?? []) {
    const valor = extrair(v)?.trim();
    if (valor) set.add(valor);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// useSearchParams exige Suspense no page (regra do App Router no build).
export default function VagasPage() {
  return (
    <Suspense
      fallback={<div className="text-sm text-grafite-400 p-4">Carregando…</div>}
    >
      <VagasPageInner />
    </Suspense>
  );
}

function VagasPageInner() {
  // O sync org-wide da Gupy exige área recrutamento/admin (guard na API);
  // gestor sem essas áreas nem vê o botão — clicar só renderia um 403.
  const { podeVerTudo, apenasGestaoAcessos } = useAuth();

  // Vagas é o pouso padrão pós-login, mas quem SÓ gere acessos não participa
  // dos processos — vai direto para a tela de Usuários.
  useEffect(() => {
    if (apenasGestaoAcessos) {
      window.location.replace('/configuracoes/usuarios');
    }
  }, [apenasGestaoAcessos]);
  // Deep-link do painel inicial: /vagas?pendencia=... abre já filtrado (e com
  // o painel de filtros visível, para o recrutador ver o que está aplicado).
  // useSearchParams (e não window.location): na navegação client-side o
  // location ainda pode apontar pra URL anterior, e navegar de novo para
  // /vagas com outra query não remonta o componente. Inicializar o estado
  // DIRETO da URL evita o 1º fetch sem filtro (que, mais lento, terminava
  // depois do filtrado e sobrescrevia a lista).
  const searchParams = useSearchParams();
  const pendenciaUrl = validarPendencia(searchParams.get('pendencia'));

  const [vagas, setVagas] = useState<VagaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<string>('PUBLICADA');
  // Filtros por pessoa — client-side sobre a lista carregada (≤200 vagas),
  // pela chave e-mail/nome. '' = todos. Ficam atrás do botão "Filtros" para
  // não poluir a barra de busca.
  const [filtrosAbertos, setFiltrosAbertos] = useState(Boolean(pendenciaUrl));
  const [gestorFiltro, setGestorFiltro] = useState('');
  const [recrutadorFiltro, setRecrutadorFiltro] = useState('');
  const [departamentoFiltro, setDepartamentoFiltro] = useState('');
  const [localFiltro, setLocalFiltro] = useState('');
  // Pendência — server-side, mesmas definições do "Precisa de você" do início.
  const [pendenciaFiltro, setPendenciaFiltro] = useState(pendenciaUrl);

  // Cobre a navegação para /vagas com OUTRA query com a página já montada
  // (ex.: clicar em outro card do "Precisa de você").
  useEffect(() => {
    if (pendenciaUrl) {
      setPendenciaFiltro(pendenciaUrl);
      setStatusFiltro('PUBLICADA');
      setFiltrosAbertos(true);
    }
  }, [pendenciaUrl]);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Respostas fora de ordem (ex.: fetch antigo mais lento sobrescrevendo o
  // atual): cada carregar() aborta o anterior e ignora resposta abortada.
  const abortRef = useRef<AbortController | null>(null);
  const carregar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErro(null);
    try {
      const resp = await api<{ total: number; itens: VagaResumo[] }>(
        '/api/vagas',
        {
          query: {
            // Sempre explícito: o padrão do servidor é SÓ publicadas; ver
            // todos os status é escolha deliberada ('TODOS').
            status: statusFiltro,
            q: busca || undefined,
            pendencia: pendenciaFiltro || undefined,
            limite: 200,
          },
          signal: ctrl.signal,
        },
      );
      setVagas(resp.itens);
    } catch (err) {
      if (ctrl.signal.aborted) return; // requisição substituída — ignora
      setVagas([]);
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao carregar vagas.');
    }
  }, [busca, statusFiltro, pendenciaFiltro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const gestores = useMemo(() => opcoesPessoas(vagas, 'gestor'), [vagas]);
  const recrutadores = useMemo(
    () => opcoesPessoas(vagas, 'recrutador'),
    [vagas],
  );
  const departamentos = useMemo(
    () => opcoesTexto(vagas, (v) => v.departamento),
    [vagas],
  );
  const locais = useMemo(() => opcoesTexto(vagas, localDaVaga), [vagas]);
  const qtdFiltrosAtivos =
    (gestorFiltro ? 1 : 0) +
    (recrutadorFiltro ? 1 : 0) +
    (departamentoFiltro ? 1 : 0) +
    (localFiltro ? 1 : 0) +
    (pendenciaFiltro ? 1 : 0);
  const vagasFiltradas = useMemo(
    () =>
      (vagas ?? []).filter(
        (v) =>
          (!gestorFiltro || chavePessoa(v.gestor) === gestorFiltro) &&
          (!recrutadorFiltro ||
            chavePessoa(v.recrutador) === recrutadorFiltro) &&
          (!departamentoFiltro || v.departamento === departamentoFiltro) &&
          (!localFiltro || localDaVaga(v) === localFiltro),
      ),
    [vagas, gestorFiltro, recrutadorFiltro, departamentoFiltro, localFiltro],
  );

  // Sincroniza tudo num passo só: primeiro o cadastro das vagas, depois as
  // candidaturas (que rodam em background na API — acompanhamos o progresso).
  async function sincronizar() {
    setSincronizando(true);
    setErro(null);
    setAviso(null);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      // 1) Vagas — background na API (resposta imediata; um sync longo atrás do
      // proxy estourava o timeout do nginx e aparecia como erro de CORS).
      setAviso('Sincronizando vagas…');
      await api('/api/gupy/sync/vagas', { method: 'POST' });
      for (let i = 0; i < 300; i++) {
        await sleep(3000);
        const st = await api<{
          emAndamento: boolean;
          importadas: number;
          erro: string | null;
        }>('/api/gupy/sync/vagas/status');
        if (!st.emAndamento) {
          if (st.erro) {
            setErro(`Sincronização de vagas falhou: ${st.erro}`);
            return;
          }
          setAviso(`Vagas sincronizadas: ${st.importadas}. Buscando candidatos…`);
          break;
        }
        setAviso(`Sincronizando vagas: ${st.importadas} importada(s)…`);
      }
      await carregar();

      // 2) Candidatos de todas as vagas — background + polling de progresso.
      await api('/api/gupy/sync/candidaturas-todas', { method: 'POST' });
      setAviso('Buscando candidatos de todas as vagas…');
      for (let i = 0; i < 300; i++) {
        await sleep(4000);
        const st = await api<{
          emAndamento: boolean;
          totalVagas: number;
          vagasProcessadas: number;
          candidaturasImportadas: number;
        }>('/api/gupy/sync/candidaturas-todas/status');
        // Recarrega a lista só de tempos em tempos: recarregar a cada tick
        // consumia o rate limit e derrubava (429) as outras telas do usuário.
        if (i % 5 === 4) await carregar();
        if (!st.emAndamento) {
          await carregar();
          setAviso(
            `Sincronização concluída: ${st.candidaturasImportadas} candidatura(s) em ${st.vagasProcessadas} vaga(s).`,
          );
          break;
        }
        setAviso(
          `Buscando candidatos: ${st.vagasProcessadas}/${st.totalVagas} vagas · ${st.candidaturasImportadas} candidatura(s)…`,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao sincronizar com a Gupy.');
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Vagas"
        subtitulo="Vagas importadas da Gupy. Clique em uma vaga para ver os detalhes e os candidatos."
        acoes={
          podeVerTudo ? (
            <button
              type="button"
              className="btn-primary"
              disabled={sincronizando}
              onClick={() => void sincronizar()}
            >
              {sincronizando ? 'Sincronizando…' : 'Sincronizar Gupy'}
            </button>
          ) : undefined
        }
      />

      {aviso && (
        <div className="badge-green mb-4 w-full justify-start px-3 py-2">
          {aviso}
        </div>
      )}

      <div className="card p-4 mb-4 flex gap-3 items-center">
        <input
          className="flex-1 border border-grafite-200 rounded-md px-3 py-2 text-sm"
          type="search"
          placeholder="Buscar por título ou código…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select
          className="border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
        >
          <option value="TODOS">Todos status</option>
          <option value="PUBLICADA">Publicadas</option>
          <option value="APROVADA">Aprovadas</option>
          <option value="RASCUNHO">Rascunhos</option>
          <option value="PAUSADA">Pausadas</option>
          <option value="ENCERRADA">Encerradas</option>
          <option value="CANCELADA">Canceladas</option>
        </select>
        <button
          type="button"
          className="btn-soft whitespace-nowrap"
          onClick={() => setFiltrosAbertos((v) => !v)}
          aria-expanded={filtrosAbertos}
        >
          Filtros
          {qtdFiltrosAtivos > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-unifique-600 px-1 text-xs font-semibold text-white">
              {qtdFiltrosAtivos}
            </span>
          )}
          <span aria-hidden className="ml-1">
            {filtrosAbertos ? '▴' : '▾'}
          </span>
        </button>
      </div>

      {filtrosAbertos && (
        <div className="card p-4 mb-4 -mt-2 flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-grafite-400">
              Gestor
            </span>
            <select
              className="w-56 border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
              value={gestorFiltro}
              onChange={(e) => setGestorFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {gestores.map((p) => (
                <option key={chavePessoa(p)} value={chavePessoa(p)}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-grafite-400">
              Recrutador
            </span>
            <select
              className="w-56 border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
              value={recrutadorFiltro}
              onChange={(e) => setRecrutadorFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {recrutadores.map((p) => (
                <option key={chavePessoa(p)} value={chavePessoa(p)}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-grafite-400">
              Departamento
            </span>
            <select
              className="w-56 border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
              value={departamentoFiltro}
              onChange={(e) => setDepartamentoFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-grafite-400">
              Local
            </span>
            <select
              className="w-56 border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
              value={localFiltro}
              onChange={(e) => setLocalFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {locais.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-grafite-400">
              Pendência
            </span>
            <select
              className="w-72 border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
              value={pendenciaFiltro}
              onChange={(e) => {
                setPendenciaFiltro(e.target.value);
                // Pendência é definida sobre vagas NO AR (mesma regra do início).
                if (e.target.value) setStatusFiltro('PUBLICADA');
              }}
              title="Mesmas pendências do card 'Precisa de você' da página inicial."
            >
              <option value="">Todas as vagas</option>
              <option value="sem_candidatura">
                Sem candidatura (no ar há +14 dias)
              </option>
              <option value="candidaturas_paradas">
                Com candidaturas paradas (+7 dias, sem entrevista)
              </option>
              <option value="enquete_sem_resposta">
                Com enquete de horários sem resposta (+24h)
              </option>
            </select>
          </label>
          {qtdFiltrosAtivos > 0 && (
            <button
              type="button"
              className="btn-soft text-xs"
              onClick={() => {
                setGestorFiltro('');
                setRecrutadorFiltro('');
                setDepartamentoFiltro('');
                setLocalFiltro('');
                setPendenciaFiltro('');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">
          {erro}
        </div>
      )}

      {vagas === null ? (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      ) : vagas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma vaga ainda"
          descricao={
            podeVerTudo
              ? "Clique em 'Sincronizar Gupy' para importar."
              : 'Você verá aqui as vagas em que é o gestor.'
          }
        />
      ) : vagasFiltradas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma vaga para os filtros selecionados"
          descricao="Ajuste os filtros de gestor/recrutador ou limpe a seleção."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-600">
              <tr>
                <Th>Título</Th>
                <Th>Departamento</Th>
                <Th>Local</Th>
                <Th>Gestor</Th>
                <Th>Recrutador</Th>
                <Th>Status</Th>
                <Th>Publicada</Th>
                <Th className="text-right">Candidaturas</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {vagasFiltradas.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-grafite-100 hover:bg-grafite-50"
                >
                  <Td>
                    <div className="font-medium text-grafite-900">{v.titulo}</div>
                    {v.codigo && (
                      <div className="text-xs text-grafite-400">{v.codigo}</div>
                    )}
                  </Td>
                  <Td>{v.departamento ?? '—'}</Td>
                  <Td>{localDaVaga(v) || '—'}</Td>
                  <Td>
                    <PessoaCell pessoa={v.gestor} />
                  </Td>
                  <Td>
                    <PessoaCell pessoa={v.recrutador} />
                  </Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                  <Td>{formatarData(v.data_publicacao)}</Td>
                  <Td className="text-right tabular-nums">{v.qtdCandidaturas}</Td>
                  <Td className="text-right">
                    <Link
                      href={`/vagas/${v.id}/ranking`}
                      className="btn-soft text-xs"
                    >
                      Ver detalhes →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Nome do gestor/recrutador, compacto — e-mail completo no tooltip. */
function PessoaCell({ pessoa }: { pessoa: Pessoa | null }) {
  if (!pessoa) return <span className="text-grafite-400">—</span>;
  return (
    <span
      className="block max-w-[11rem] truncate text-xs text-grafite-600"
      title={pessoa.email ? `${pessoa.nome} · ${pessoa.email}` : pessoa.nome}
    >
      {pessoa.nome}
    </span>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left font-medium px-4 py-2 text-xs uppercase tracking-wide ${className ?? ''}`}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className ?? ''}`}>{children}</td>;
}
