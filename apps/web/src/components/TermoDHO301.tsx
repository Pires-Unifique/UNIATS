import type { TipoAlteracaoContratual } from '@uniats/shared';

/** Dados normalizados para renderizar o termo DHO-301 (preview). */
export interface TermoDados {
  tipos: TipoAlteracaoContratual[];
  colaboradorNome?: string | null;
  colaboradorMatricula?: string | null;
  cargoAtual?: string | null;
  cargoNovo?: string | null;
  cargoDescricao?: string | null;
  diretrizComercial?: boolean | null;
  periculosidade?: boolean | null;
  aluguelFrota?: boolean | null;
  centroAtual?: string | null;
  centroNovo?: string | null;
  unidadeAtual?: string | null;
  unidadeNovo?: string | null;
  liderAtual?: string | null;
  liderNovo?: string | null;
  salarioAtual?: string | null;
  salarioNovo?: string | null;
  razoes?: string | null;
  dataAplicacao?: string | null; // YYYY-MM-DD
}

function dataBR(iso?: string | null): string {
  if (!iso) return '____/____/______';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? '____/____/______'
    : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function Check({ marcado }: { marcado: boolean }) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center border ${
        marcado
          ? 'border-grafite-700 bg-grafite-800 text-[#fff]'
          : 'border-grafite-400 text-transparent'
      }`}
      aria-hidden
    >
      {marcado ? '✓' : ''}
    </span>
  );
}

function Campo({
  rotulo,
  atual,
  novo,
  alterando,
}: {
  rotulo: string;
  atual?: string | null;
  novo?: string | null;
  alterando: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 py-1.5 border-b border-grafite-100">
      <div className="font-semibold text-grafite-700">{rotulo}</div>
      <div className="space-y-0.5">
        <div>
          <span className="text-grafite-400 text-xs mr-2">Atual</span>
          <span className="text-grafite-800">{atual || '—'}</span>
        </div>
        {alterando && (
          <div>
            <span className="text-unifique-500 text-xs mr-2">Novo</span>
            <span className="font-semibold text-unifique-700">{novo || '—'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SimNao({ rotulo, valor }: { rotulo: string; valor?: boolean | null }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-grafite-600">{rotulo}</span>
      <span className="flex items-center gap-1">
        <Check marcado={valor === true} /> SIM
      </span>
      <span className="flex items-center gap-1">
        <Check marcado={valor === false} /> NÃO
      </span>
    </div>
  );
}

/**
 * Reprodução em HTML do termo oficial DHO-301 (pré-visualização). O documento
 * ASSINADO é o .docx oficial preenchido — este preview espelha o mesmo conteúdo.
 */
export function TermoDHO301({ dados }: { dados: TermoDados }) {
  const tem = (t: TipoAlteracaoContratual) => dados.tipos.includes(t);
  const temCargo = tem('CARGO');

  return (
    <div className="mx-auto max-w-[640px] bg-white text-grafite-900 text-sm shadow-sm border border-grafite-200 rounded-md p-6 sm:p-8 leading-relaxed">
      <div className="text-center border-b-2 border-grafite-800 pb-2 mb-4">
        <p className="text-base font-bold tracking-wide">ALTERAÇÃO CONTRATUAL</p>
        <p className="text-[10px] text-grafite-400 uppercase tracking-widest">DHO-301</p>
      </div>

      {/* Checkboxes oficiais (filial = unidade) */}
      <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 mb-4 text-xs">
        <span className="flex items-center gap-2"><Check marcado={temCargo} /> ALTERAÇÃO CARGO</span>
        <span className="flex items-center gap-2"><Check marcado={tem('CENTRO_CUSTO')} /> ALTERAÇÃO CENTRO DE CUSTO</span>
        <span className="flex items-center gap-2"><Check marcado={tem('UNIDADE')} /> ALTERAÇÃO FILIAL</span>
        <span className="flex items-center gap-2"><Check marcado={tem('SALARIO')} /> ALTERAÇÃO SALARIAL</span>
      </div>

      <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 py-1.5 border-b border-grafite-100">
        <div className="font-semibold text-grafite-700">Nome</div>
        <div className="text-grafite-800">{dados.colaboradorNome || '—'}</div>
      </div>
      <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 py-1.5 border-b border-grafite-100">
        <div className="font-semibold text-grafite-700">Matrícula</div>
        <div className="text-grafite-800">{dados.colaboradorMatricula || '—'}</div>
      </div>

      {temCargo && (
        <>
          <Campo rotulo="Cargo" atual={dados.cargoAtual} novo={dados.cargoNovo} alterando />
          <div className="py-1.5 border-b border-grafite-100">
            <span className="font-semibold text-grafite-700">Descrição das Atividades: </span>
            <span className="text-grafite-700">{dados.cargoDescricao || '—'}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 py-2 border-b border-grafite-100">
            <SimNao rotulo="Possui Diretriz Comercial" valor={dados.diretrizComercial} />
            <SimNao rotulo="Periculosidade" valor={dados.periculosidade} />
            <SimNao rotulo="Possui Locação de Veículo" valor={dados.aluguelFrota} />
          </div>
        </>
      )}

      <Campo rotulo="Centro de Custo" atual={dados.centroAtual} novo={dados.centroNovo} alterando={tem('CENTRO_CUSTO')} />
      <Campo rotulo="Unidade" atual={dados.unidadeAtual} novo={dados.unidadeNovo} alterando={tem('UNIDADE')} />
      <Campo rotulo="Líder (nome completo)" atual={dados.liderAtual} novo={dados.liderNovo} alterando={tem('LIDER')} />
      {tem('SALARIO') && (
        <Campo rotulo="Salário" atual={dados.salarioAtual} novo={dados.salarioNovo} alterando />
      )}

      <div className="py-2 mt-1">
        <span className="font-semibold text-grafite-700">Razões da alteração: </span>
        <span className="text-grafite-800 whitespace-pre-line">{dados.razoes || '—'}</span>
      </div>

      <p className="text-grafite-700 mt-1">
        Competência de Alteração a partir de <strong>{dataBR(dados.dataAplicacao)}</strong>, término INDETERMINADO.
      </p>

      {temCargo && (
        <p className="text-xs text-grafite-500 mt-2">
          Declaro estar ciente de que se eu não comparecer nos exames para troca de função, esta
          alteração contratual será anulada.
        </p>
      )}

      <div className="mt-8 space-y-6 text-center text-xs text-grafite-500">
        <div>
          <div className="border-t border-grafite-400 w-72 mx-auto pt-1">
            Data / Assinatura do Superior – EMITENTE
          </div>
        </div>
        <div>
          <div className="border-t border-grafite-400 w-72 mx-auto pt-1">
            Data / Assinatura do Funcionário
          </div>
        </div>
      </div>
    </div>
  );
}
