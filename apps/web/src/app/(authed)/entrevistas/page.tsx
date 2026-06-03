import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export default function EntrevistasIndex() {
  return (
    <div>
      <PageHeader
        titulo="Entrevistas"
        subtitulo="Entrevistas são abertas a partir do detalhe de uma candidatura."
      />
      <EmptyState
        titulo="Acesse pela candidatura"
        descricao="Vá até uma vaga → ranking → clique em um candidato → ver entrevistas."
      />
    </div>
  );
}
