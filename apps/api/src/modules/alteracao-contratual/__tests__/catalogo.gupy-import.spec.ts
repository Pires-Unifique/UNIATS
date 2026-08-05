import { CatalogoService } from '../catalogo.service.js';

/**
 * Importação de cargos a partir dos MODELOS DE VAGA (job-templates?fields=all):
 * chave GUPY-<roleId> (enriquece os cargos de roles em vez de duplicar),
 * descrição combinada (descrição + responsabilidades + requisitos) e
 * preservação do texto já editado pelo líder.
 */
type Modelo = {
  id: number;
  nome?: string | null;
  roleId?: number | null;
  roleName?: string | null;
  descricao?: string | null;
  responsabilidades?: string | null;
  requisitos?: string | null;
};

function montar(opts: {
  modelos: Modelo[];
  existentePorCodigo?: Record<string, { id: string; descricao: string | null }>;
}) {
  const gupy = {
    listarJobTemplates: jest
      .fn()
      .mockResolvedValueOnce(opts.modelos)
      .mockResolvedValue([]),
  };
  const create = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn(async ({ where }: { where: { codigo: string } }) =>
    opts.existentePorCodigo?.[where.codigo] ?? null,
  );
  const prisma = { cargo: { findUnique, create, update } };
  const service = new CatalogoService(
    prisma as never,
    {} as never,
    gupy as never,
  );
  return { service, create, update, findUnique, gupy };
}

const MODELO: Modelo = {
  id: 618849,
  nome: 'Atendente de Suporte Técnico',
  roleId: 216246,
  roleName: 'ATENDENTE SUPORTE TÉCNICO',
  descricao: 'Ajuda os clientes remotamente.',
  responsabilidades: 'Atender clientes; abrir protocolo.',
  requisitos: 'Ensino médio completo.',
};

describe('CatalogoService.importarCargosGupy', () => {
  it('cria cargo por GUPY-<roleId>, título = roleName e descrição combinada', async () => {
    const { service, create } = montar({ modelos: [MODELO] });

    const r = await service.importarCargosGupy();

    expect(r).toEqual({ criados: 1, atualizados: 0, total: 1 });
    const data = create.mock.calls[0][0].data;
    expect(data.codigo).toBe('GUPY-216246');
    expect(data.titulo).toBe('ATENDENTE SUPORTE TÉCNICO');
    expect(data.origem).toBe('gupy');
    expect(data.descricao).toContain('Ajuda os clientes remotamente.');
    expect(data.descricao).toContain('Responsabilidades:');
    expect(data.descricao).toContain('Requisitos:');
  });

  it('enriquece um cargo existente (de role) preenchendo a descrição vazia', async () => {
    const { service, update } = montar({
      modelos: [MODELO],
      existentePorCodigo: { 'GUPY-216246': { id: 'c-1', descricao: null } },
    });

    const r = await service.importarCargosGupy();

    expect(r).toMatchObject({ criados: 0, atualizados: 1 });
    const data = update.mock.calls[0][0].data;
    expect(data.descricao).toContain('Ajuda os clientes remotamente.');
  });

  it('NÃO sobrescreve a descrição já editada pelo líder', async () => {
    const { service, update } = montar({
      modelos: [MODELO],
      existentePorCodigo: {
        'GUPY-216246': { id: 'c-1', descricao: 'Texto do líder' },
      },
    });

    await service.importarCargosGupy();

    expect(update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: expect.objectContaining({ descricao: 'Texto do líder' }),
    });
  });

  it('usa GUPY-TPL-<id> quando o modelo não tem roleId', async () => {
    const { service, create } = montar({
      modelos: [{ ...MODELO, roleId: null }],
    });

    await service.importarCargosGupy();

    expect(create.mock.calls[0][0].data.codigo).toBe('GUPY-TPL-618849');
  });
});
