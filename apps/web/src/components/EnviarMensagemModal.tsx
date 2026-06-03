'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { DisponibilidadePicker } from '@/components/DisponibilidadePicker';
import { api, ApiError } from '@/lib/api';
import { graphEnabled, type SlotLivre } from '@/lib/graph';

export interface TemplateCatalogo {
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

interface Props {
  candidaturaId: string;
  candidato: {
    telefone: string | null;
    email: string | null;
    consentimento_lgpd_em: string | null;
    excluido_em: string | null;
  };
  /** Nome do recrutador logado — usado como fallback para {{recrutador_nome}}. */
  recrutadorNome?: string | null;
  onClose: () => void;
  onSent: () => void;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Substituição client-side só para PREVIEW (o envio real renderiza no backend). */
function preencher(corpo: string, vars: Record<string, string>): string {
  return corpo.replace(PLACEHOLDER_RE, (full, nome) =>
    vars[nome]?.trim() ? vars[nome] : full,
  );
}

export function EnviarMensagemModal({
  candidaturaId,
  candidato,
  recrutadorNome,
  onClose,
  onSent,
}: Props) {
  const [templates, setTemplates] = useState<TemplateCatalogo[]>([]);
  const [catalogo, setCatalogo] = useState<VariavelDisponivel[]>([]);
  const [contexto, setContexto] = useState<Record<string, string>>({});
  const [codigo, setCodigo] = useState<string>('');
  const [canal, setCanal] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarPicker, setMostrarPicker] = useState(false);

  const template = useMemo(
    () => templates.find((t) => t.codigo === codigo),
    [templates, codigo],
  );

  // Variáveis de horário (opcao_1, opcao_2, …) em ordem — preenchidas pela agenda.
  const varsOpcao = useMemo(
    () =>
      (template?.variaveis ?? [])
        .filter((v) => /^opcao_\d+$/.test(v))
        .sort(
          (a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]),
        ),
    [template],
  );

  function aplicarSlots(slots: SlotLivre[]) {
    setVars((s) => {
      const novo = { ...s };
      varsOpcao.forEach((nome, i) => {
        if (slots[i]) novo[nome] = slots[i].rotulo;
      });
      return novo;
    });
  }

  // Carrega catálogo + variáveis padrão da candidatura.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [tpls, ctx, cat] = await Promise.all([
          api<TemplateCatalogo[]>('/api/mensagens/templates'),
          api<Record<string, string>>(
            `/api/mensagens/contexto/${candidaturaId}`,
          ).catch(() => ({}) as Record<string, string>),
          api<VariavelDisponivel[]>('/api/mensagens/variaveis').catch(
            () => [] as VariavelDisponivel[],
          ),
        ]);
        if (!vivo) return;
        setTemplates(tpls);
        setCatalogo(cat);
        const ctxNorm: Record<string, string> = {
          candidato_nome: ctx.candidato_nome ?? '',
          vaga_titulo: ctx.vaga_titulo ?? '',
          recrutador_nome: ctx.recrutador_nome ?? recrutadorNome ?? '',
        };
        setContexto(ctxNorm);
        if (tpls.length) setCodigo(tpls[0].codigo);
      } catch (err) {
        if (vivo) {
          setErro(
            err instanceof ApiError ? err.message : 'Falha ao carregar templates.',
          );
        }
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [candidaturaId, recrutadorNome]);

  // Ao trocar de template, ajusta canal disponível e pré-preenche variáveis.
  useEffect(() => {
    if (!template) return;
    if (!template.canais.includes(canal)) {
      setCanal(template.canais[0] ?? 'WHATSAPP');
    }
    setVars((atual) => {
      const novo: Record<string, string> = {};
      for (const v of template.variaveis) {
        novo[v] = atual[v] ?? contexto[v] ?? '';
      }
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo, template, contexto]);

  const preview = useMemo(() => {
    if (!template) return '';
    if (canal === 'WHATSAPP') return preencher(template.whatsappCorpo ?? '', vars);
    const assunto = preencher(template.emailAssunto ?? '', vars);
    const texto = preencher(template.emailTexto ?? '', vars);
    return `Assunto: ${assunto}\n\n${texto}`;
  }, [template, canal, vars]);

  // O contato é liberado para qualquer candidatura ativa (LGPD Art. 7, V).
  // Só bloqueamos quem pediu exclusão dos dados (LGPD Art. 18).
  const candidatoExcluido = Boolean(candidato.excluido_em);
  const semDestino =
    canal === 'WHATSAPP' ? !candidato.telefone : !candidato.email;
  const faltando = template
    ? template.variaveis.filter((v) => !vars[v]?.trim())
    : [];
  const podeEnviar =
    !!template && !candidatoExcluido && !semDestino && faltando.length === 0 && !enviando;

  const enviar = useCallback(async () => {
    if (!template) return;
    setEnviando(true);
    setErro(null);
    try {
      await api('/api/mensagens/enviar', {
        method: 'POST',
        body: {
          candidaturaId,
          canal,
          templateCodigo: template.codigo,
          variaveis: vars,
          permitirFallback: true,
        },
      });
      onSent();
      onClose();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao enviar.');
      setEnviando(false);
    }
  }, [template, candidaturaId, canal, vars, onSent, onClose]);

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-grafite-900">
            Contatar candidato
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-grafite-400 hover:text-grafite-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {carregando ? (
          <p className="text-sm text-grafite-400">Carregando templates…</p>
        ) : (
          <>
            {candidatoExcluido && (
              <div className="badge-red mb-3 px-3 py-2 w-full justify-start">
                Candidato pediu exclusão de dados (LGPD) — envio bloqueado.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="block">
                <span className="text-xs text-grafite-400">Template</span>
                <select
                  className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.codigo} value={t.codigo}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-grafite-400">Canal</span>
                <select
                  className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={canal}
                  onChange={(e) => setCanal(e.target.value as 'WHATSAPP' | 'EMAIL')}
                >
                  {(template?.canais ?? ['WHATSAPP']).map((c) => (
                    <option key={c} value={c}>
                      {c === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {template?.descricao && (
              <p className="text-xs text-grafite-400 mb-3">{template.descricao}</p>
            )}

            {/* Atalho: puxar horários livres da agenda para preencher opcao_N. */}
            {varsOpcao.length > 0 && (
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setMostrarPicker(true)}
                >
                  📅 Escolher horários da minha agenda
                </button>
                <span className="text-xs text-grafite-400">
                  {graphEnabled()
                    ? `Preenche ${varsOpcao.length} opção(ões) de horário sem digitar.`
                    : 'Agenda ainda não configurada (ver infra/app registration).'}
                </span>
              </div>
            )}

            {/* Variáveis — rótulos amigáveis; auto-preenchidas vêm prontas. */}
            {template && template.variaveis.length > 0 && (
              <div className="mb-3">
                <div className="text-xs uppercase text-grafite-400 mb-1">
                  Variáveis
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {template.variaveis.map((v) => {
                    const meta = catalogo.find((c) => c.slug === v);
                    return (
                      <label key={v} className="block">
                        <span
                          className="text-xs text-grafite-600"
                          title={meta?.descricao}
                        >
                          {meta?.label ?? v}
                          {meta?.autoPreenchida && (
                            <span className="text-unifique-600"> · automático</span>
                          )}
                        </span>
                        <input
                          className="mt-0.5 w-full border border-grafite-200 rounded-md px-2 py-1 text-sm"
                          value={vars[v] ?? ''}
                          onChange={(e) =>
                            setVars((s) => ({ ...s, [v]: e.target.value }))
                          }
                          placeholder={meta?.label ?? v}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Preview */}
            <div className="mb-3">
              <div className="text-xs uppercase text-grafite-400 mb-1">
                Pré-visualização
              </div>
              <pre className="text-sm text-grafite-700 whitespace-pre-wrap font-sans bg-grafite-50 rounded p-3 max-h-56 overflow-y-auto">
                {preview || '—'}
              </pre>
            </div>

            {semDestino && (
              <p className="text-xs text-red-600 mb-2">
                Candidato sem {canal === 'WHATSAPP' ? 'telefone' : 'e-mail'} —
                escolha outro canal.
              </p>
            )}
            {erro && (
              <div className="badge-red mb-2 px-3 py-2 w-full justify-start">
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-2">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!podeEnviar}
                onClick={() => void enviar()}
              >
                {enviando
                  ? 'Enviando…'
                  : canal === 'WHATSAPP'
                    ? 'Enviar WhatsApp'
                    : 'Enviar e-mail'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>

      {mostrarPicker && (
        <DisponibilidadePicker
          maxSlots={varsOpcao.length || 3}
          onUsar={aplicarSlots}
          onClose={() => setMostrarPicker(false)}
        />
      )}
    </>
  );
}
