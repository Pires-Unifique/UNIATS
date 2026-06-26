'use client';

import { useEffect, useState } from 'react';

interface Props {
  /** Título do modal (ex.: "Recusar solicitação"). */
  titulo: string;
  /** Texto auxiliar opcional acima do campo. */
  descricao?: string;
  /** Rótulo do campo (ex.: "Motivo da recusa"). */
  label?: string;
  /** Rótulo do botão de confirmação (ex.: "Recusar"). */
  confirmarLabel?: string;
  /** Variante visual do botão de confirmação. */
  perigo?: boolean;
  carregando?: boolean;
  onConfirmar: (motivo: string) => void;
  onClose: () => void;
}

/**
 * Modal genérico para capturar um MOTIVO (recusa, cancelamento, etc.) — substitui
 * o `window.prompt`. Exige texto não vazio. Esc/clique fora fecham.
 */
export function MotivoModal({
  titulo,
  descricao,
  label = 'Motivo',
  confirmarLabel = 'Confirmar',
  perigo = false,
  carregando = false,
  onConfirmar,
  onClose,
}: Props) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function confirmar() {
    if (!motivo.trim()) {
      setErro('Informe o motivo.');
      return;
    }
    onConfirmar(motivo.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-grafite-900">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-grafite-400 hover:text-grafite-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {descricao && (
          <p className="text-sm text-grafite-500 mb-3">{descricao}</p>
        )}

        <label className="block text-sm font-medium text-grafite-700 mb-1">
          * {label}
        </label>
        <textarea
          className="inp min-h-[90px]"
          autoFocus
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            if (erro) setErro(null);
          }}
        />
        {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            className="btn-secondary"
            disabled={carregando}
            onClick={onClose}
          >
            Voltar
          </button>
          <button
            type="button"
            className={perigo ? 'btn-primary !bg-red-600 hover:!bg-red-700' : 'btn-primary'}
            disabled={carregando}
            onClick={confirmar}
          >
            {carregando ? 'Enviando…' : confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
