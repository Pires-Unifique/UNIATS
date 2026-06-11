'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';

interface TemplateCatalogo {
  codigo: string;
  versao: string;
  nome: string;
  descricao: string | null;
  variaveis: string[];
  canais: Array<'WHATSAPP' | 'EMAIL'>;
  whatsappCorpo: string | null;
  emailAssunto: string | null;
  emailTexto: string | null;
  emailHtml: string | null;
}

interface VariavelDisponivel {
  slug: string;
  label: string;
  descricao: string;
  autoPreenchida: boolean;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const CODIGO_RE = /^[a-z][a-z0-9_]*$/;

function variaveisDe(...corpos: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const corpo of corpos) {
    if (!corpo) continue;
    for (const m of corpo.matchAll(PLACEHOLDER_RE)) set.add(m[1]);
  }
  return [...set];
}

interface FormState {
  codigo: string;
  nome: string;
  descricao: string;
  whatsappCorpo: string;
  emailAssunto: string;
  emailTexto: string;
}

const FORM_VAZIO: FormState = {
  codigo: '',
  nome: '',
  descricao: '',
  whatsappCorpo: '',
  emailAssunto: '',
  emailTexto: '',
};

/** Modelos prontos para começar um template novo sem partir do zero. */
type Modelo = FormState & { rotuloBotao: string };

const MODELOS: Modelo[] = [
  {
    rotuloBotao: 'Proposta de horários',
    codigo: 'proposta_horarios',
    nome: 'Proposta de horários',
    descricao:
      'Oferece opções de horário (preenchidas pela agenda) para o candidato escolher por resposta.',
    whatsappCorpo:
      'Olá, {{candidato_nome}}! 👋\n\n' +
      'Para agendarmos a entrevista da vaga *{{vaga_titulo}}*, temos estes horários disponíveis:\n\n' +
      '1️⃣ {{opcao_1}}\n' +
      '2️⃣ {{opcao_2}}\n' +
      '3️⃣ {{opcao_3}}\n\n' +
      'É só me responder com o número da opção que preferir. 😊\n\n' +
      '— {{recrutador_nome}}',
    emailAssunto: 'Horários para sua entrevista — {{vaga_titulo}}',
    emailTexto:
      'Olá, {{candidato_nome}},\n\n' +
      'Para agendarmos a entrevista da vaga {{vaga_titulo}}, temos os seguintes horários disponíveis:\n\n' +
      '1) {{opcao_1}}\n' +
      '2) {{opcao_2}}\n' +
      '3) {{opcao_3}}\n\n' +
      'Responda a este e-mail com a opção de sua preferência e enviaremos o link da videochamada.\n\n' +
      'Atenciosamente,\n' +
      '{{recrutador_nome}}\n' +
      'Unifique — Recrutamento & Seleção',
  },
];

/**
 * Campo de texto com uma paleta de "botões de variável": o usuário clica e a
 * variável ({{slug}}) é inserida no ponto do cursor — sem precisar digitar {{ }}.
 */
function CampoComVariaveis({
  label,
  value,
  onChange,
  variaveis,
  multiline = false,
  rows = 5,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  variaveis: VariavelDisponivel[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  function inserir(slug: string) {
    const el = ref.current;
    const token = `{{${slug}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const novo = value.slice(0, start) + token + value.slice(end);
    onChange(novo);
    // Reposiciona o cursor logo após a variável inserida.
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div>
      <span className="text-xs text-grafite-400">{label}</span>
      {multiline ? (
        <textarea
          ref={ref}
          rows={rows}
          className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm font-sans"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          ref={ref}
          className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {variaveis.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[11px] text-grafite-400 mb-1">
            Clique para inserir uma variável:
          </div>
          <div className="flex flex-wrap gap-1">
            {variaveis.map((v) => (
              <button
                key={v.slug}
                type="button"
                title={v.descricao}
                onClick={() => inserir(v.slug)}
                className={
                  'px-2 py-0.5 rounded-full text-xs border transition-colors ' +
                  (v.autoPreenchida
                    ? 'border-unifique-200 bg-unifique-50 text-unifique-700 hover:bg-unifique-100 dark:border-unifique-500/30 dark:bg-unifique-500/15 dark:text-unifique-400 dark:hover:bg-unifique-500/25'
                    : 'border-grafite-200 bg-white text-grafite-600 hover:bg-grafite-100')
                }
              >
                + {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateCatalogo[]>([]);
  const [variaveis, setVariaveis] = useState<VariavelDisponivel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editando, setEditando] = useState<string | null>(null); // codigo em edição
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [lista, vars] = await Promise.all([
        api<TemplateCatalogo[]>('/api/mensagens/templates'),
        api<VariavelDisponivel[]>('/api/mensagens/variaveis').catch(
          () => [] as VariavelDisponivel[],
        ),
      ]);
      setTemplates(lista);
      setVariaveis(vars);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const variaveisForm = useMemo(
    () =>
      form
        ? variaveisDe(form.whatsappCorpo, form.emailAssunto, form.emailTexto)
        : [],
    [form],
  );

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function novo() {
    setEditando(null);
    setForm({ ...FORM_VAZIO });
    setStatus(null);
  }

  function aplicarModelo(m: Modelo) {
    setEditando(null);
    setForm({
      codigo: m.codigo,
      nome: m.nome,
      descricao: m.descricao,
      whatsappCorpo: m.whatsappCorpo,
      emailAssunto: m.emailAssunto,
      emailTexto: m.emailTexto,
    });
    setStatus(null);
  }

  function editar(t: TemplateCatalogo) {
    setEditando(t.codigo);
    setForm({
      codigo: t.codigo,
      nome: t.nome,
      descricao: t.descricao ?? '',
      whatsappCorpo: t.whatsappCorpo ?? '',
      emailAssunto: t.emailAssunto ?? '',
      emailTexto: t.emailTexto ?? '',
    });
    setStatus(null);
  }

  async function salvar() {
    if (!form) return;
    setSalvando(true);
    setStatus(null);
    setErro(null);
    const payload = {
      nome: form.nome,
      descricao: form.descricao || undefined,
      whatsappCorpo: form.whatsappCorpo || undefined,
      emailAssunto: form.emailAssunto || undefined,
      emailTexto: form.emailTexto || undefined,
    };
    try {
      if (editando) {
        await api(`/api/mensagens/templates/${editando}`, {
          method: 'PATCH',
          body: payload,
        });
        setStatus(`Template "${editando}" atualizado.`);
      } else {
        await api('/api/mensagens/templates', {
          method: 'POST',
          body: { codigo: form.codigo, ...payload },
        });
        setStatus(`Template "${form.codigo}" criado.`);
      }
      setForm(null);
      setEditando(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function desativar(codigo: string) {
    if (!window.confirm(`Desativar o template "${codigo}"?`)) return;
    try {
      await api(`/api/mensagens/templates/${codigo}`, { method: 'DELETE' });
      setStatus(`Template "${codigo}" desativado.`);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao desativar.');
    }
  }

  // Rótulo amigável de uma variável (para os badges "detectadas").
  const rotulo = useCallback(
    (slug: string) => variaveis.find((v) => v.slug === slug)?.label ?? slug,
    [variaveis],
  );

  const codigoValido = !editando ? CODIGO_RE.test(form?.codigo ?? '') : true;
  const temCorpo = Boolean(
    form?.whatsappCorpo.trim() ||
      (form?.emailAssunto.trim() && form?.emailTexto.trim()),
  );
  const podeSalvar =
    !!form && !!form.nome.trim() && codigoValido && temCorpo && !salvando;

  return (
    <div>
      <PageHeader
        titulo="Templates de mensagem"
        subtitulo="Monte a mensagem e clique nos botões de variável para inseri-las. Sem digitar código."
        acoes={
          <button type="button" className="btn-primary" onClick={novo}>
            + Novo template
          </button>
        }
      />

      {status && (
        <div className="badge-blue mb-4 px-3 py-2 w-full justify-start">{status}</div>
      )}
      {erro && (
        <div className="badge-red mb-4 px-3 py-2 w-full justify-start">{erro}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Lista */}
        <section className="card p-5">
          <h2 className="font-medium text-grafite-900 mb-3">Templates ativos</h2>
          {carregando ? (
            <p className="text-sm text-grafite-400">Carregando…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-grafite-400">Nenhum template ativo.</p>
          ) : (
            <ul className="divide-y divide-grafite-100">
              {templates.map((t) => (
                <li key={t.codigo} className="py-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-medium text-grafite-900">
                        {t.nome}{' '}
                        <span className="text-xs text-grafite-400">
                          ({t.codigo}@{t.versao})
                        </span>
                      </div>
                      {t.descricao && (
                        <p className="text-xs text-grafite-400 mt-0.5">
                          {t.descricao}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.canais.map((c) => (
                          <span key={c} className="badge-gray">
                            {c === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}
                          </span>
                        ))}
                        {t.variaveis.map((v) => (
                          <span key={v} className="badge-blue" title={`{{${v}}}`}>
                            {rotulo(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className="text-unifique-700 hover:underline text-xs"
                        onClick={() => editar(t)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline text-xs"
                        onClick={() => void desativar(t.codigo)}
                      >
                        Desativar
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Editor */}
        <section className="card p-5">
          <h2 className="font-medium text-grafite-900 mb-3">
            {form ? (editando ? `Editar "${editando}"` : 'Novo template') : 'Editor'}
          </h2>
          {!form ? (
            <p className="text-sm text-grafite-400">
              Selecione um template para editar ou clique em &ldquo;Novo template&rdquo;.
            </p>
          ) : (
            <div className="space-y-4">
              {!editando && (
                <div className="rounded-md border border-grafite-100 bg-grafite-50 p-2">
                  <div className="text-[11px] text-grafite-500 mb-1">
                    Começar de um modelo pronto:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {MODELOS.map((m) => (
                      <button
                        key={m.codigo}
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => aplicarModelo(m)}
                      >
                        {m.rotuloBotao}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!editando && (
                <label className="block">
                  <span className="text-xs text-grafite-400">
                    Código (identificador interno: letras, números e _)
                  </span>
                  <input
                    className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                    value={form.codigo}
                    onChange={(e) => set('codigo', e.target.value)}
                    placeholder="ex.: convite_estagio"
                  />
                  {form.codigo && !codigoValido && (
                    <span className="text-xs text-red-600">
                      Deve começar por letra e usar apenas letras, números e _.
                    </span>
                  )}
                </label>
              )}

              <label className="block">
                <span className="text-xs text-grafite-400">Nome (rótulo)</span>
                <input
                  className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={form.nome}
                  onChange={(e) => set('nome', e.target.value)}
                />
              </label>

              <label className="block">
                <span className="text-xs text-grafite-400">Descrição</span>
                <input
                  className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={form.descricao}
                  onChange={(e) => set('descricao', e.target.value)}
                />
              </label>

              <CampoComVariaveis
                label="Mensagem do WhatsApp"
                value={form.whatsappCorpo}
                onChange={(v) => set('whatsappCorpo', v)}
                variaveis={variaveis}
                multiline
                placeholder="Ex.: Olá! Tudo bem? Clique nos botões abaixo para inserir o nome do candidato…"
              />

              <div className="border-t border-grafite-100 pt-3">
                <p className="text-xs uppercase text-grafite-400 mb-2">
                  E-mail (opcional)
                </p>
                <div className="space-y-3">
                  <CampoComVariaveis
                    label="Assunto do e-mail"
                    value={form.emailAssunto}
                    onChange={(v) => set('emailAssunto', v)}
                    variaveis={variaveis}
                  />
                  <CampoComVariaveis
                    label="Texto do e-mail"
                    value={form.emailTexto}
                    onChange={(v) => set('emailTexto', v)}
                    variaveis={variaveis}
                    multiline
                  />
                </div>
              </div>

              <div>
                <span className="text-xs uppercase text-grafite-400">
                  Variáveis usadas nesta mensagem
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {variaveisForm.length === 0 ? (
                    <span className="text-xs text-grafite-400">nenhuma</span>
                  ) : (
                    variaveisForm.map((v) => (
                      <span key={v} className="badge-blue" title={`{{${v}}}`}>
                        {rotulo(v)}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {!temCorpo && (
                <p className="text-xs text-amber-600">
                  Escreva ao menos a mensagem do WhatsApp, ou o assunto + texto do e-mail.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setForm(null);
                    setEditando(null);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!podeSalvar}
                  onClick={() => void salvar()}
                >
                  {salvando ? 'Salvando…' : editando ? 'Salvar (nova versão)' : 'Criar'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
