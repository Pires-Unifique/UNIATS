'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UsuarioAdminDTO } from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { AREAS_ATRIBUIVEIS, labelArea } from '@/lib/areas';
import { useAuth } from '@/lib/auth';
import { formatarDataHora } from '@/lib/format';

interface PreCadastroForm {
  email: string;
  nome: string;
  areas: string[];
}

const PRE_CADASTRO_VAZIO: PreCadastroForm = { email: '', nome: '', areas: [] };

export default function UsuariosPage() {
  const { usuario } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioAdminDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);

  // Pré-cadastro
  const [form, setForm] = useState<PreCadastroForm>(PRE_CADASTRO_VAZIO);
  const [salvandoPre, setSalvandoPre] = useState(false);

  // Edição inline de áreas: id do usuário em edição + seleção corrente.
  const [editando, setEditando] = useState<string | null>(null);
  const [areasEdicao, setAreasEdicao] = useState<string[]>([]);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await api<UsuarioAdminDTO[]>('/api/usuarios', {
        query: { inativos: mostrarInativos ? '1' : undefined },
      });
      setUsuarios(r);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar usuários.');
    } finally {
      setCarregando(false);
    }
  }, [mostrarInativos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? usuarios.filter(
        (u) =>
          u.nome.toLowerCase().includes(termo) ||
          u.email.toLowerCase().includes(termo),
      )
    : usuarios;

  function alternarAreaForm(area: string) {
    setForm((f) => ({
      ...f,
      areas: f.areas.includes(area)
        ? f.areas.filter((a) => a !== area)
        : [...f.areas, area],
    }));
  }

  async function preCadastrar() {
    if (!form.email.trim()) {
      setErro('Informe o e-mail corporativo.');
      return;
    }
    setErro(null);
    setSalvandoPre(true);
    try {
      await api('/api/usuarios', {
        method: 'POST',
        body: {
          email: form.email.trim(),
          nome: form.nome.trim() || undefined,
          areas: form.areas,
        },
      });
      setForm(PRE_CADASTRO_VAZIO);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao pré-cadastrar.');
    } finally {
      setSalvandoPre(false);
    }
  }

  function abrirEdicao(u: UsuarioAdminDTO) {
    setEditando(u.id);
    setAreasEdicao(u.areas);
    setErro(null);
  }

  function alternarAreaEdicao(area: string) {
    setAreasEdicao((atual) =>
      atual.includes(area) ? atual.filter((a) => a !== area) : [...atual, area],
    );
  }

  async function salvarEdicao(id: string) {
    setErro(null);
    setSalvandoEdicao(true);
    try {
      await api(`/api/usuarios/${id}`, {
        method: 'PATCH',
        body: { areas: areasEdicao },
      });
      setEditando(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar as áreas.');
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function alternarAtivo(u: UsuarioAdminDTO) {
    setErro(null);
    try {
      await api(`/api/usuarios/${u.id}`, {
        method: 'PATCH',
        body: { ativo: !u.ativo },
      });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao atualizar o usuário.');
    }
  }

  async function removerPreCadastro(u: UsuarioAdminDTO) {
    setErro(null);
    try {
      await api(`/api/usuarios/${u.id}`, { method: 'DELETE' });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao remover o pré-cadastro.');
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Usuários"
        subtitulo="Controle quem acessa os módulos amplos do Collab. Gestores e líderes já enxergam o que é deles automaticamente — aqui você libera Administração de Pessoas, Recrutamento, Admissão e Admin."
      />

      <div className="card p-3 mb-5 text-sm text-unifique-700 bg-unifique-50 border-unifique-200 dark:bg-unifique-500/10 dark:text-unifique-300 dark:border-unifique-500/30">
        <strong>Acesso automático já funciona sozinho:</strong> quem entra com a
        conta Microsoft é cadastrado na hora e, se for gestor de vaga (e-mail
        vindo da Gupy), já vê as vagas dele — sem liberação de ninguém.
      </div>

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {/* Pré-cadastro */}
      <div className="card p-4 mb-6 space-y-4">
        <h2 className="font-semibold text-grafite-900">Pré-liberar acesso</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Campo label="E-mail corporativo *">
            <input
              className="inp"
              value={form.email}
              placeholder="nome.sobrenome@unifique.com.br"
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Campo>
          <Campo label="Nome (opcional — atualizado no 1º login)">
            <input
              className="inp"
              value={form.nome}
              placeholder="Ex.: Fernanda Costa"
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </Campo>
        </div>
        <div>
          <span className="block text-sm font-medium text-grafite-700 mb-2">Áreas</span>
          <SeletorAreas selecionadas={form.areas} onToggle={alternarAreaForm} />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={salvandoPre}
            onClick={() => void preCadastrar()}
          >
            {salvandoPre ? 'Pré-cadastrando…' : 'Pré-cadastrar'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex gap-2 flex-1 min-w-[14rem]">
          <input
            className="inp"
            placeholder="Buscar por nome ou e-mail…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-grafite-600">
          <input
            type="checkbox"
            checked={mostrarInativos}
            onChange={(e) => setMostrarInativos(e.target.checked)}
          />
          Mostrar desativados
        </label>
      </div>

      {carregando ? (
        <p className="text-sm text-grafite-400">Carregando usuários…</p>
      ) : filtrados.length === 0 ? (
        <div className="card p-6 text-sm text-grafite-500">
          {usuarios.length === 0
            ? 'Nenhum usuário ainda — quem logar com a conta Microsoft aparece aqui.'
            : `Nenhum usuário encontrado para “${busca.trim()}”.`}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtrados.map((u) => {
            const ehVoce = usuario?.email?.toLowerCase() === u.email.toLowerCase();
            return (
              <li key={u.id} className={`card ${u.ativo ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-grafite-900">{u.nome}</span>
                      {u.areas.map((a) => (
                        <span key={a} className="badge-blue px-2 py-0.5 text-xs">
                          {labelArea(a)}
                        </span>
                      ))}
                      {u.vagas_como_gestor > 0 && (
                        <span className="badge-gray px-2 py-0.5 text-xs">
                          Gestor de {u.vagas_como_gestor} vaga{u.vagas_como_gestor > 1 ? 's' : ''}
                        </span>
                      )}
                      {u.admin_via_ambiente && (
                        <span
                          className="badge-gray px-2 py-0.5 text-xs"
                          title="Admin garantido por AUTH_ADMIN_EMAILS — remover 'admin' volta no próximo login."
                        >
                          admin via ambiente
                        </span>
                      )}
                      {u.aguardando_primeiro_login && (
                        <span className="badge-yellow px-2 py-0.5 text-xs">
                          aguardando 1º login
                        </span>
                      )}
                      {!u.ativo && (
                        <span className="badge-red px-2 py-0.5 text-xs">desativado</span>
                      )}
                    </div>
                    <p className="text-xs text-grafite-400 mt-0.5">{u.email}</p>
                    <p className="text-xs text-grafite-400 mt-1">
                      {u.areas.length === 0 && !u.aguardando_primeiro_login
                        ? 'Sem áreas — acesso automático ao que é dele · '
                        : ''}
                      Último login: {formatarDataHora(u.ultimo_login_em)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ehVoce ? (
                      <span className="text-xs text-grafite-400 italic">
                        você — peça a outro admin
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-soft text-xs"
                          onClick={() =>
                            editando === u.id ? setEditando(null) : abrirEdicao(u)
                          }
                        >
                          {editando === u.id ? 'Fechar' : 'Editar áreas'}
                        </button>
                        {u.aguardando_primeiro_login ? (
                          <button
                            type="button"
                            className="btn-soft-danger text-xs"
                            onClick={() => void removerPreCadastro(u)}
                          >
                            Remover
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`text-xs ${u.ativo ? 'btn-soft-danger' : 'btn-soft-success'}`}
                            onClick={() => void alternarAtivo(u)}
                          >
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {editando === u.id && (
                  <div className="border-t border-grafite-100 bg-grafite-50 p-4 rounded-b-lg space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-grafite-400">
                      Editar áreas de {u.nome}
                    </p>
                    <SeletorAreas
                      selecionadas={areasEdicao}
                      onToggle={alternarAreaEdicao}
                      comDescricao
                    />
                    {u.admin_via_ambiente && !areasEdicao.includes('admin') && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Este e-mail está em AUTH_ADMIN_EMAILS: o Admin volta no
                        próximo login. Para remover de vez, ajuste o ambiente.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={salvandoEdicao}
                        onClick={() => void salvarEdicao(u.id)}
                      >
                        {salvandoEdicao ? 'Salvando…' : 'Salvar'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => setEditando(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SeletorAreas({
  selecionadas,
  onToggle,
  comDescricao = false,
}: {
  selecionadas: string[];
  onToggle: (area: string) => void;
  comDescricao?: boolean;
}) {
  return (
    <div className={comDescricao ? 'grid grid-cols-1 md:grid-cols-2 gap-2' : 'flex flex-wrap gap-2'}>
      {AREAS_ATRIBUIVEIS.map((a) => {
        const marcada = selecionadas.includes(a.valor);
        return (
          <label
            key={a.valor}
            className={`inline-flex items-center gap-2 border rounded-md px-3 py-1.5 text-sm cursor-pointer transition-colors ${
              marcada
                ? 'border-unifique-200 bg-unifique-50 text-unifique-700 dark:bg-unifique-500/15 dark:text-unifique-300 dark:border-unifique-500/40'
                : 'border-grafite-200 text-grafite-600 hover:bg-grafite-100'
            }`}
          >
            <input
              type="checkbox"
              className="accent-unifique-600"
              checked={marcada}
              onChange={() => onToggle(a.valor)}
            />
            <span>{a.label}</span>
            {comDescricao && (
              <span className="text-xs opacity-70">· {a.descricao}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-grafite-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
