import { describe, expect, it, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { AuthService } from '../auth.service.js';

/**
 * AuthService é orquestração pura — mockamos PrismaService e ConfigService.
 * Foco: política de papel no provisioning e o resolver do bypass de teste.
 */
type MockPrisma = {
  usuario: { upsert: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  vaga: { updateMany: jest.Mock; findFirst: jest.Mock };
  candidatura: { findFirst: jest.Mock };
};

function montar(envOverrides: Record<string, unknown> = {}) {
  const prisma: MockPrisma = {
    usuario: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    vaga: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
    },
    candidatura: { findFirst: jest.fn() },
  };
  const env: Record<string, unknown> = {
    AUTH_DEV_OID: '00000000-0000-0000-0000-000000000001',
    AUTH_DEV_EMAIL: 'admin@unifique.com.br',
    AUTH_ADMIN_EMAILS: 'guilherme.viana@unifique.com.br',
    ...envOverrides,
  };
  const config = { get: jest.fn((k: string) => env[k]) };
  const service = new AuthService(prisma as any, config as any);
  return { service, prisma, config };
}

const usuarioDb = {
  id: 'u-1',
  azure_oid: 'oid-1',
  email: 'fulano@unifique.com.br',
  nome: 'Fulano',
  papel: 'VISUALIZADOR',
  areas: [],
  ativo: true,
};

describe('AuthService.provisionarUsuario', () => {
  it('cria usuário NOVO SEM áreas (acesso só por posse de vaga) e marca login', async () => {
    const { service, prisma } = montar();
    prisma.usuario.upsert.mockResolvedValue(usuarioDb);

    const r = await service.provisionarUsuario({
      azure_oid: 'oid-1',
      email: 'fulano@unifique.com.br',
      nome: 'Fulano',
    });

    expect(prisma.usuario.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.usuario.upsert.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ azure_oid: 'oid-1' });
    expect(arg.create.areas).toEqual([]);
    // Não-admin: o update NÃO toca em áreas (atribuição é deliberada).
    expect(arg.update).not.toHaveProperty('areas');
    expect(arg.update.ultimo_login_em).toBeInstanceOf(Date);
    expect(r.areas).toEqual([]);
  });

  it('e-mail na allowlist recebe área admin (create e update)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.upsert.mockResolvedValue({ ...usuarioDb, areas: ['admin'] });

    const r = await service.provisionarUsuario({
      azure_oid: 'oid-adm',
      email: 'guilherme.viana@unifique.com.br',
      nome: 'Guilherme',
    });

    const arg = prisma.usuario.upsert.mock.calls[0][0] as any;
    expect(arg.create.areas).toEqual(['admin']);
    expect(arg.update.areas).toEqual(['admin']); // reaplica a cada login
    expect(r.areas).toEqual(['admin']);
  });

  it('roda o auto-vínculo de vagas no login (updateMany por gestor_email)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.upsert.mockResolvedValue(usuarioDb);
    prisma.vaga.updateMany.mockResolvedValue({ count: 1 });

    await service.provisionarUsuario({
      azure_oid: 'oid-1',
      email: 'fulano@unifique.com.br',
      nome: 'Fulano',
    });

    const vinc = prisma.vaga.updateMany.mock.calls[0][0] as any;
    expect(vinc.where).toMatchObject({
      gestor_email: 'fulano@unifique.com.br',
      gestor_id: null,
    });
    expect(vinc.data).toEqual({ gestor_id: 'u-1' });
  });
});

describe('AuthService.assertVagaPermitida', () => {
  const usuario = (areas: string[]) =>
    ({ id: 'u-1', areas } as any);

  it("área 'recrutamento'/'admin' acessa qualquer vaga (sem consulta)", async () => {
    const { service, prisma } = montar();
    await service.assertVagaPermitida(usuario(['recrutamento']), 'vaga-x');
    await service.assertVagaPermitida(usuario(['admin']), 'vaga-x');
    expect(prisma.vaga.findFirst).not.toHaveBeenCalled();
  });

  it('gestor (sem área) só passa se for o dono; senão 404', async () => {
    const { service, prisma } = montar();
    prisma.vaga.findFirst.mockResolvedValue(null);
    await expect(
      service.assertVagaPermitida(usuario([]), 'vaga-alheia'),
    ).rejects.toThrow(NotFoundException);
    const arg = prisma.vaga.findFirst.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'vaga-alheia', gestor_id: 'u-1' });
  });

  it('gestor dono passa', async () => {
    const { service, prisma } = montar();
    prisma.vaga.findFirst.mockResolvedValue({ id: 'v' });
    await expect(
      service.assertVagaPermitida(usuario([]), 'v'),
    ).resolves.toBeUndefined();
  });
});

describe('AuthService.vincularGestorAoSincronizar', () => {
  it('liga a vaga ao gestor já existente quando o e-mail casa', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue({ ...usuarioDb, id: 'g-9' });

    await service.vincularGestorAoSincronizar('vaga-1', 'fulano@unifique.com.br');

    const arg = prisma.vaga.updateMany.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'vaga-1', gestor_id: null });
    expect(arg.data).toEqual({ gestor_id: 'g-9' });
  });

  it('no-op quando a vaga não tem e-mail de gestor', async () => {
    const { service, prisma } = montar();
    await service.vincularGestorAoSincronizar('vaga-1', null);
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(prisma.vaga.updateMany).not.toHaveBeenCalled();
  });

  it('no-op quando nenhum usuário tem aquele e-mail', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(null);
    await service.vincularGestorAoSincronizar('vaga-1', 'ninguem@unifique.com.br');
    expect(prisma.vaga.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.resolverPorOid', () => {
  it('devolve a identidade quando o oid existe', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb);
    const r = await service.resolverPorOid('oid-1');
    expect(r?.id).toBe('u-1');
  });

  it('devolve null quando o oid não existe', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(null);
    expect(await service.resolverPorOid('inexistente')).toBeNull();
  });
});

describe('AuthService.usuarioDevPadrao', () => {
  it('faz upsert do admin de desenvolvimento (área admin no create e update)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.upsert.mockResolvedValue({
      ...usuarioDb,
      papel: 'ADMIN',
      areas: ['admin'],
    });

    const r = await service.usuarioDevPadrao();

    const arg = prisma.usuario.upsert.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ azure_oid: '00000000-0000-0000-0000-000000000001' });
    expect(arg.create.areas).toEqual(['admin']);
    expect(arg.update.areas).toEqual(['admin']);
    expect(r.areas).toEqual(['admin']);
  });
});
