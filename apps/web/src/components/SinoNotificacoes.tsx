'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api';

/** Poll da contagem de não lidas (ms). GET leve — só um count no banco. */
const POLL_CONTAGEM_MS = 30_000;

type TipoNotificacao = 'HORARIO_CONFIRMADO' | 'ANALISE_PRONTA';

interface Notificacao {
  id: string;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  link: string | null;
  referencia_id: string | null;
  lida_em: string | null;
  criado_em: string;
}

interface ListaResp {
  itens: Notificacao[];
  naoLidas: number;
}

const ICONE: Record<TipoNotificacao, string> = {
  HORARIO_CONFIRMADO: '📅',
  ANALISE_PRONTA: '📝',
};

/** "há 3 min", "há 2 h", "há 4 d" — ou a data quando passa de uma semana. */
function tempoRelativo(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `há ${dias} d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function SinoNotificacoes() {
  const router = useRouter();
  const [naoLidas, setNaoLidas] = useState(0);
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const carregarContagem = useCallback(async () => {
    try {
      const r = await api<{ naoLidas: number }>('/api/notificacoes/contagem');
      setNaoLidas(r.naoLidas);
    } catch {
      // Falha de rede/sessão é tratada no api(); aqui o sino só não atualiza.
    }
  }, []);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await api<ListaResp>('/api/notificacoes', {
        query: { limite: 20 },
      });
      setItens(r.itens);
      setNaoLidas(r.naoLidas);
    } catch {
      /* silencioso — mantém o que já está na tela */
    } finally {
      setCarregando(false);
    }
  }, []);

  // Poll da contagem (badge), sempre. A lista só é buscada ao abrir.
  useEffect(() => {
    void carregarContagem();
    const t = setInterval(() => void carregarContagem(), POLL_CONTAGEM_MS);
    return () => clearInterval(t);
  }, [carregarContagem]);

  // Ao abrir o painel, busca a lista mais recente.
  useEffect(() => {
    if (aberto) void carregarLista();
  }, [aberto, carregarLista]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [aberto]);

  async function marcarLida(n: Notificacao) {
    if (n.lida_em) return;
    // Otimista: some do "não lida" na hora; a API confirma em seguida.
    setItens((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, lida_em: new Date().toISOString() } : x)),
    );
    setNaoLidas((c) => Math.max(0, c - 1));
    try {
      await api(`/api/notificacoes/${n.id}/lida`, { method: 'PATCH' });
    } catch {
      void carregarContagem();
    }
  }

  async function marcarTodasLidas() {
    const agora = new Date().toISOString();
    setItens((prev) => prev.map((x) => (x.lida_em ? x : { ...x, lida_em: agora })));
    setNaoLidas(0);
    try {
      await api('/api/notificacoes/marcar-todas-lidas', { method: 'POST' });
    } catch {
      void carregarContagem();
    }
  }

  function aoClicar(n: Notificacao) {
    void marcarLida(n);
    setAberto(false);
    if (n.link) router.push(n.link as Route);
  }

  const rotulo =
    naoLidas > 0 ? `Notificações (${naoLidas} não lidas)` : 'Notificações';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="btn-ghost text-base px-2 py-1 relative"
        title={rotulo}
        aria-label={rotulo}
        aria-haspopup="true"
        aria-expanded={aberto}
      >
        <span aria-hidden>🔔</span>
        {naoLidas > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-unifique-600 text-[#fff] text-[10px] font-semibold flex items-center justify-center"
            aria-hidden
          >
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="card absolute right-0 mt-2 w-80 max-h-[70vh] overflow-hidden flex flex-col z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-grafite-100">
            <span className="text-sm font-semibold text-grafite-800">
              Notificações
            </span>
            {naoLidas > 0 && (
              <button
                type="button"
                className="text-xs text-unifique-700 hover:underline"
                onClick={() => void marcarTodasLidas()}
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {carregando && itens.length === 0 ? (
              <p className="px-3 py-6 text-sm text-grafite-400 text-center">
                Carregando…
              </p>
            ) : itens.length === 0 ? (
              <p className="px-3 py-6 text-sm text-grafite-400 text-center">
                Nenhuma notificação por aqui.
              </p>
            ) : (
              <ul className="divide-y divide-grafite-100">
                {itens.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => aoClicar(n)}
                      className={`w-full text-left px-3 py-2.5 flex gap-2.5 hover:bg-grafite-50 transition-colors ${
                        n.lida_em ? '' : 'bg-unifique-50 dark:bg-unifique-400/10'
                      }`}
                    >
                      <span className="text-base leading-none mt-0.5" aria-hidden>
                        {ICONE[n.tipo] ?? '🔔'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-grafite-800 truncate">
                            {n.titulo}
                          </span>
                          {!n.lida_em && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-unifique-600 shrink-0"
                              aria-hidden
                            />
                          )}
                        </span>
                        <span className="block text-xs text-grafite-600 mt-0.5">
                          {n.mensagem}
                        </span>
                        <span className="block text-[11px] text-grafite-400 mt-1">
                          {tempoRelativo(n.criado_em)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
