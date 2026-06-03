import { ReactNode } from 'react';

interface Props {
  titulo: string;
  subtitulo?: string;
  acoes?: ReactNode;
}

export function PageHeader({ titulo, subtitulo, acoes }: Props) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-grafite-900">{titulo}</h1>
        {subtitulo && (
          <p className="text-sm text-grafite-400 mt-0.5">{subtitulo}</p>
        )}
      </div>
      {acoes && <div className="flex gap-2">{acoes}</div>}
    </div>
  );
}
