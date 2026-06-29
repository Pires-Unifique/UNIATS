'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CargoDTO } from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';

const SENIORIDADES = ['Júnior', 'Pleno', 'Sênior', 'Especialista', 'Líder'];

interface FormState {
  titulo: string;
  codigo: string;
  senioridade: string;
  descricao: string;
}

const FORM_VAZIO: FormState = {
  titulo: '',
  codigo: '',
  senioridade: '',
  descricao: '',
};

export default function CargosPage() {
  const [cargos, setCargos] = useState<CargoDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [incluirInativos, setIncluirInativos] = useState(false);

  // Formulário (criar/editar). `editando` = id do cargo em edição (null = novo).
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await api<CargoDTO[]>(
        '/api/alteracao-contratual/catalogo/cargos',
        { query: { inativos: incluirInativos ? '1' : undefined } },
      );
      setCargos(r);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar cargos.');
    } finally {
      setCarregando(false);
    }
  }, [incluirInativos]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const termo = busca.trim().toLowerCase();
  const cargosFiltrados = termo
    ? cargos.filter(
        (c) =>
          c.titulo.toLowerCase().includes(termo) ||
          (c.codigo ?? '').toLowerCase().includes(termo),
      )
    : cargos;

  function novoCargo() {
    setEditando(null);
    setForm(FORM_VAZIO);
    setErro(null);
  }

  function editarCargo(c: CargoDTO) {
    setEditando(c.id);
    setForm({
      titulo: c.titulo,
      codigo: c.codigo ?? '',
      senioridade: c.senioridade ?? '',
      descricao: c.descricao ?? '',
    });
    setErro(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvar() {
    if (!form.titulo.trim()) {
      setErro('O título do cargo é obrigatório.');
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const payload = {
        titulo: form.titulo.trim(),
        codigo: form.codigo.trim() || null,
        senioridade: form.senioridade.trim() || null,
        descricao: form.descricao.trim() || null,
      };
      if (editando) {
        await api(`/api/alteracao-contratual/catalogo/cargos/${editando}`, {
          method: 'PATCH',
          body: payload,
        });
      } else {
        await api('/api/alteracao-contratual/catalogo/cargos', {
          method: 'POST',
          body: payload,
        });
      }
      novoCargo();
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar o cargo.');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(c: CargoDTO) {
    setErro(null);
    try {
      await api(`/api/alteracao-contratual/catalogo/cargos/${c.id}`, {
        method: 'PATCH',
        body: { ativo: !c.ativo },
      });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao atualizar o cargo.');
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Cargos"
        subtitulo="Cadastre os cargos do catálogo. A descrição aqui é a mesma que aparece ao publicar uma vaga."
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {/* Formulário de cadastro/edição */}
      <div className="card p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-grafite-900">
            {editando ? 'Editar cargo' : 'Novo cargo'}
          </h2>
          {editando && (
            <button
              type="button"
              className="text-xs text-grafite-500 hover:underline"
              onClick={novoCargo}
            >
              cancelar edição
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Campo label="Título *">
            <input
              className="inp"
              value={form.titulo}
              placeholder="Ex.: Analista de Suporte"
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
            />
          </Campo>
          <Campo label="Código (opcional)">
            <input
              className="inp"
              value={form.codigo}
              placeholder="Ex.: ANL-SUP"
              onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
            />
          </Campo>
          <Campo label="Senioridade (opcional)">
            <input
              className="inp"
              list="senioridades"
              value={form.senioridade}
              placeholder="Ex.: Pleno"
              onChange={(e) =>
                setForm((f) => ({ ...f, senioridade: e.target.value }))
              }
            />
            <datalist id="senioridades">
              {SENIORIDADES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Campo>
        </div>

        <Campo label="Descrição do cargo">
          <textarea
            className="inp h-40"
            value={form.descricao}
            placeholder="Descreva a missão do cargo, principais responsabilidades e requisitos. Este texto aparece ao publicar a vaga."
            onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
          />
          <span className="block text-xs text-grafite-400 mt-1">
            Esta descrição é reaproveitada na tela de publicar vaga.
          </span>
        </Campo>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={salvando}
            onClick={() => void salvar()}
          >
            {salvando
              ? 'Salvando…'
              : editando
                ? 'Salvar alterações'
                : 'Cadastrar cargo'}
          </button>
        </div>
      </div>

      {/* Lista de cargos */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex gap-2 flex-1 min-w-[14rem]">
          <input
            className="inp"
            placeholder="Buscar por título ou código…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-grafite-600">
          <input
            type="checkbox"
            checked={incluirInativos}
            onChange={(e) => setIncluirInativos(e.target.checked)}
          />
          Mostrar inativos
        </label>
      </div>

      {carregando ? (
        <p className="text-sm text-grafite-400">Carregando cargos…</p>
      ) : cargos.length === 0 ? (
        <div className="card p-6 text-sm text-grafite-500">
          Nenhum cargo cadastrado ainda. Use o formulário acima para cadastrar o
          primeiro.
        </div>
      ) : cargosFiltrados.length === 0 ? (
        <div className="card p-6 text-sm text-grafite-500">
          Nenhum cargo encontrado para “{busca.trim()}”.
        </div>
      ) : (
        <ul className="space-y-3">
          {cargosFiltrados.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-grafite-900">
                      {c.titulo}
                    </span>
                    {c.senioridade && (
                      <span className="badge-gray px-2 py-0.5 text-xs">
                        {c.senioridade}
                      </span>
                    )}
                    {c.codigo && (
                      <span className="text-xs text-grafite-400">{c.codigo}</span>
                    )}
                    {!c.ativo && (
                      <span className="badge-red px-2 py-0.5 text-xs">inativo</span>
                    )}
                  </div>
                  <p className="text-sm text-grafite-600 mt-1.5 leading-relaxed whitespace-pre-wrap">
                    {c.descricao || 'Sem descrição cadastrada.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn-soft text-xs"
                    onClick={() => editarCargo(c)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className={`text-xs ${c.ativo ? 'btn-soft-danger' : 'btn-soft-success'}`}
                    onClick={() => void alternarAtivo(c)}
                  >
                    {c.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
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
