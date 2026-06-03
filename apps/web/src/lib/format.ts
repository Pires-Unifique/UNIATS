export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncar(s: string | null | undefined, max = 120): string {
  if (!s) return '—';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Razão 0..1 → "42,5%". `null`/`undefined` → "—". */
export function formatarPct(v: number | null | undefined, casas = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })}%`;
}

/** Dias → "12,5 d". `null`/`undefined` → "—". */
export function formatarDias(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d`;
}

/** Inteiro com separador de milhar pt-BR. */
export function formatarNumero(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('pt-BR');
}
