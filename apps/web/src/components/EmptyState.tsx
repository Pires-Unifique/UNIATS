import { ReactNode } from 'react';

export function EmptyState({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="card p-8 text-center">
      <p className="text-grafite-800 font-medium">{titulo}</p>
      {descricao && (
        <p className="text-sm text-grafite-400 mt-1">{descricao}</p>
      )}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}
