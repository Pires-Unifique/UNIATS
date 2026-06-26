'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { AutoPrefillDTO } from '@uniats/shared';

import { Logo } from '@/components/Logo';
import { api, ApiError } from '@/lib/api';
import { ROTULO_STATUS_CONVITE } from '@/lib/offboarding';

/**
 * Tela PÚBLICA (sem login) do colaborador para pedir o próprio desligamento via
 * link com token. Confere os dados, preenche motivo/aviso/contatos e confirma.
 */
export default function AutodesligamentoPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [prefill, setPrefill] = useState<AutoPrefillDTO | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [motivo, setMotivo] = useState('');
  const [cumpreAviso, setCumpreAviso] = useState(false);
  const [avisoDias, setAvisoDias] = useState('');
  const [emailPessoal, setEmailPessoal] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = await api<AutoPrefillDTO>(`/api/offboarding/auto/${token}`);
      setPrefill(p);
      setEmailPessoal(p.email_pessoal ?? '');
      setWhatsapp(p.whatsapp_pessoal ?? '');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Link inválido.');
    } finally {
      setCarregando(false);
    }
  }, [token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function confirmar() {
    setErro(null);
    if (!motivo.trim()) {
      setErro('Informe o motivo.');
      return;
    }
    if (cumpreAviso && (!avisoDias || Number(avisoDias) <= 0)) {
      setErro('Informe quantos dias de aviso prévio.');
      return;
    }
    setEnviando(true);
    try {
      await api(`/api/offboarding/auto/${token}`, {
        method: 'POST',
        body: {
          motivo: motivo.trim(),
          cumpre_aviso_previo: cumpreAviso,
          aviso_previo_dias: cumpreAviso ? Number(avisoDias) : null,
          email_pessoal: emailPessoal.trim() || null,
          whatsapp_pessoal: whatsapp.trim() || null,
        },
      });
      setEnviado(true);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao enviar.');
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-grafite-50 flex flex-col items-center px-4 py-10">
      <div className="flex items-center gap-2 mb-6">
        <Logo size={28} />
        <span className="text-lg font-semibold text-grafite-900">Collab</span>
        <span className="text-sm text-grafite-400">· Unifique RH</span>
      </div>

      <div className="w-full max-w-lg">
        {carregando ? (
          <div className="card p-6 text-sm text-grafite-400">Carregando…</div>
        ) : enviado ? (
          <div className="card p-6 text-center space-y-2">
            <div className="text-3xl">✅</div>
            <h1 className="text-lg font-semibold text-grafite-900">
              Pedido registrado
            </h1>
            <p className="text-sm text-grafite-600">
              Seu pedido de desligamento foi registrado e seguirá para
              assinatura. O DHO entrará em contato com os próximos passos.
            </p>
          </div>
        ) : !prefill?.valido ? (
          <div className="card p-6 text-center space-y-2">
            <div className="text-3xl">⚠️</div>
            <h1 className="text-lg font-semibold text-grafite-900">
              Link indisponível
            </h1>
            <p className="text-sm text-grafite-600">
              {prefill
                ? `Este link está ${ROTULO_STATUS_CONVITE[prefill.status].toLowerCase()}.`
                : erro ?? 'Link inválido.'}{' '}
              Procure o DHO para gerar um novo, se necessário.
            </p>
          </div>
        ) : (
          <div className="card p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-grafite-900">
                Solicitar meu desligamento
              </h1>
              <p className="text-sm text-grafite-500">
                Confira seus dados e preencha as informações abaixo.
              </p>
            </div>

            {erro && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                {erro}
              </div>
            )}

            {/* Dados do colaborador (somente leitura) */}
            <div className="rounded-md bg-grafite-50 border border-grafite-100 p-3 text-sm space-y-1">
              <Linha rotulo="Nome" valor={prefill.colaborador_nome} />
              <Linha rotulo="Matrícula" valor={prefill.colaborador_matricula} />
              <Linha rotulo="Cargo" valor={prefill.cargo} />
              <Linha rotulo="Unidade" valor={prefill.unidade} />
              <Linha rotulo="Centro de custo" valor={prefill.centro_custo} />
            </div>

            <div>
              <label className="block text-sm font-medium text-grafite-700 mb-1">
                * Motivo do desligamento
              </label>
              <textarea
                className="inp min-h-[90px]"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm mb-2">
                <input
                  type="checkbox"
                  checked={cumpreAviso}
                  onChange={(e) => setCumpreAviso(e.target.checked)}
                />
                Vou cumprir aviso prévio
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
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
              <p className="sm:col-span-2 text-xs text-grafite-400">
                Confira e atualize seus contatos pessoais, se necessário.
              </p>
            </div>

            <button
              className="btn-primary w-full"
              disabled={enviando}
              onClick={() => void confirmar()}
            >
              {enviando ? 'Enviando…' : 'Confirmar pedido de desligamento'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-grafite-400">{rotulo}</span>
      <span className="text-grafite-700 text-right">{valor || '—'}</span>
    </div>
  );
}
