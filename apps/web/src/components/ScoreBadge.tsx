import clsx from 'clsx';

interface Props {
  /** valor de 0 a 100 */
  valor: number | null | undefined;
  rotulo?: string;
}

/**
 * Badge colorida para representar score 0-100.
 *   ≥ 75 → verde (forte)
 *   ≥ 50 → âmbar
 *   <  50 → vermelho
 *   null → cinza
 */
export function ScoreBadge({ valor, rotulo }: Props) {
  if (valor == null) {
    return <span className="badge-gray">{rotulo ?? 'sem score'}</span>;
  }
  const cor = valor >= 75 ? 'badge-green' : valor >= 50 ? 'badge-yellow' : 'badge-red';
  return (
    <span className={clsx(cor, 'tabular-nums')}>
      {rotulo ? `${rotulo}: ` : ''}
      {valor.toFixed(0)}
    </span>
  );
}
