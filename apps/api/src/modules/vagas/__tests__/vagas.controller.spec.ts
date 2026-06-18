import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { VagasController } from '../vagas.controller.js';
import type { Area, UsuarioAutenticado } from '../../auth/auth.types.js';

/**
 * Foco: ESCOPO POR ÁREA. 'admin'/'recrutamento' enxergam tudo; gestor (sem área,
 * só posse da vaga) só as próprias vagas (filtro gestor_id). Testamos o `where`
 * que chega ao Prisma — é a fronteira de segurança real.
 */
function montar() {
  const prisma = {
    vaga: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    candidatura: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const controller = new VagasController(prisma as any);
  return { controller, prisma };
}

function usuario(areas: Area[], id = 'u-1'): UsuarioAutenticado {
  return {
    id,
    azure_oid: `oid-${id}`,
    email: `${id}@x.com`,
    nome: id,
    papel: 'VISUALIZADOR',
    areas,
    ativo: true,
  };
}

describe('VagasController.listar — escopo', () => {
  it('gestor (sem área) só lista as próprias vagas (where.gestor_id = ele)', async () => {
    const { controller, prisma } = montar();
    await controller.listar(usuario([], 'g-1'));
    const arg = prisma.vaga.findMany.mock.calls[0][0] as any;
    expect(arg.where.gestor_id).toBe('g-1');
  });

  it("área 'admin' e 'recrutamento' NÃO recebem filtro de gestor_id", async () => {
    for (const areas of [['admin'], ['recrutamento']] as Area[][]) {
      const { controller, prisma } = montar();
      await controller.listar(usuario(areas));
      const arg = prisma.vaga.findMany.mock.calls[0][0] as any;
      expect(arg.where).not.toHaveProperty('gestor_id');
    }
  });

  it("área 'admissao' (sem recrutamento) é escopada por gestor_id", async () => {
    const { controller, prisma } = montar();
    await controller.listar(usuario(['admissao'], 'a-1'));
    const arg = prisma.vaga.findMany.mock.calls[0][0] as any;
    expect(arg.where.gestor_id).toBe('a-1');
  });
});

describe('VagasController.obter — escopo', () => {
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('gestor: mescla gestor_id no where (vaga alheia → findFirst null → 404)', async () => {
    const { controller, prisma } = montar();
    prisma.vaga.findFirst.mockResolvedValue(null); // não é dono / não existe
    await expect(controller.obter(usuario([], 'g-1'), UUID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const arg = prisma.vaga.findFirst.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: UUID, gestor_id: 'g-1' });
  });

  it("área 'recrutamento': where sem gestor_id", async () => {
    const { controller, prisma } = montar();
    prisma.vaga.findFirst.mockResolvedValue(null);
    await expect(
      controller.obter(usuario(['recrutamento']), UUID),
    ).rejects.toBeInstanceOf(NotFoundException);
    const arg = prisma.vaga.findFirst.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: UUID });
  });
});
