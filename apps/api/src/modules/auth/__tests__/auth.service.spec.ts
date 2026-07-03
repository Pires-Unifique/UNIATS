import { describe, expect, it, jest } from '@jest/globals';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AuthService } from '../auth.service.js';

/**
 * AuthService é orquestração pura — mockamos PrismaService e ConfigService.
 * Foco: política de papel no provisioning e o resolver do bypass de teste.
 */
type MockPrisma = {
  usuario: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  vaga: { updateMany: jest.Mock; findFirst: jest.Mock };
  candidatura: { findFirst: jest.Mock };
  chaveApi: { findUnique: jest.Mock; update: jest.Mock };
};

function montar(envOverrides: Record<string, unknown> = {}) {
  const prisma: MockPrisma = {
    usuario: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    vaga: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
    },
    candidatura: { findFirst: jest.fn() },
    chaveApi: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
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
  it('cria usuário NOVO SEM áreas (não achado por oid nem e-mail) e marca login', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(null); // não existe por oid nem e-mail
    prisma.usuario.create.mockResolvedValue(usuarioDb);

    const r = await service.provisionarUsuario({
      azure_oid: 'oid-1',
      email: 'fulano@unifique.com.br',
      nome: 'Fulano',
    });

    expect(prisma.usuario.create).toHaveBeenCalledTimes(1);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    const arg = prisma.usuario.create.mock.calls[0][0] as any;
    expect(arg.data.areas).toEqual([]);
    expect(arg.data.papel).toBe('VISUALIZADOR');
    expect(arg.data.ultimo_login_em).toBeInstanceOf(Date);
    expect(r.areas).toEqual([]);
  });

  it('e-mail na allowlist: usuário NOVO recebe área admin no create', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(null);
    prisma.usuario.create.mockResolvedValue({
      ...usuarioDb,
      areas: ['admin'],
      papel: 'ADMIN',
    });

    const r = await service.provisionarUsuario({
      azure_oid: 'oid-adm',
      email: 'guilherme.viana@unifique.com.br',
      nome: 'Guilherme',
    });

    const arg = prisma.usuario.create.mock.calls[0][0] as any;
    expect(arg.data.areas).toEqual(['admin']);
    expect(arg.data.papel).toBe('ADMIN');
    expect(r.areas).toEqual(['admin']);
  });

  it('usuário recorrente (achado por azure_oid): atualiza e NÃO mexe em áreas se não-admin', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValueOnce(usuarioDb); // achou por oid
    prisma.usuario.update.mockResolvedValue(usuarioDb);

    await service.provisionarUsuario({
      azure_oid: 'oid-1',
      email: 'fulano@unifique.com.br',
      nome: 'Fulano',
    });

    expect(prisma.usuario.create).not.toHaveBeenCalled();
    const arg = prisma.usuario.update.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'u-1' });
    expect(arg.data).not.toHaveProperty('areas'); // não-admin não toca áreas
    expect(arg.data.ultimo_login_em).toBeInstanceOf(Date);
  });

  it('reconcilia por e-mail quando a linha já existe sob OUTRO azure_oid (evita P2002)', async () => {
    const { service, prisma } = montar();
    // não acha por oid; acha por e-mail (linha pré-existente: seed/dev/SSO antigo).
    prisma.usuario.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...usuarioDb, id: 'u-seed', azure_oid: 'oid-antigo' });
    prisma.usuario.update.mockResolvedValue({
      ...usuarioDb,
      id: 'u-seed',
      areas: ['admin'],
    });

    const r = await service.provisionarUsuario({
      azure_oid: 'oid-novo-sso',
      email: 'guilherme.viana@unifique.com.br',
      nome: 'Guilherme',
    });

    expect(prisma.usuario.create).not.toHaveBeenCalled();
    const arg = prisma.usuario.update.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ id: 'u-seed' });
    expect(arg.data.azure_oid).toBe('oid-novo-sso'); // reconcilia o oid da linha
    expect(arg.data.areas).toEqual(['admin']); // e-mail é admin → aplica
    expect(r.areas).toEqual(['admin']);
  });

  it('roda o auto-vínculo de vagas no login (updateMany por gestor_email)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(null);
    prisma.usuario.create.mockResolvedValue(usuarioDb);
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

  it('devolve null para usuário DESATIVADO (bypass de dev segue a mesma regra)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue({ ...usuarioDb, ativo: false });
    expect(await service.resolverPorOid('oid-1')).toBeNull();
  });
});

describe('AuthService — usuário desativado no provisionamento', () => {
  it('recusa login de usuário com ativo=false (403 com code USUARIO_DESATIVADO)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue({ ...usuarioDb, ativo: false });

    await expect(
      service.provisionarUsuario({
        azure_oid: 'oid-1',
        email: 'fulano@unifique.com.br',
        nome: 'Fulano',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.autenticarPorChaveApi', () => {
  const chaveRaw = 'clb_abc123';
  const hash = createHash('sha256').update(chaveRaw, 'utf8').digest('hex');
  const chaveDb = {
    id: 'ch-1',
    nome: 'Integração UNIIT',
    prefixo: 'clb_abc123'.slice(0, 12),
    hash,
    escopos: ['recrutamento'],
    expira_em: null,
    ultimo_uso_em: null,
    revogado_em: null,
  };

  it('vira usuário de sistema com areas = escopos (busca por hash SHA-256)', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue(chaveDb);

    const r = await service.autenticarPorChaveApi(chaveRaw);

    const arg = prisma.chaveApi.findUnique.mock.calls[0][0] as any;
    expect(arg.where).toEqual({ hash }); // nunca busca pela chave em claro
    expect(r.chave_api).toBe(true);
    expect(r.areas).toEqual(['recrutamento']);
    expect(r.nome).toBe('Integração UNIIT');
  });

  it('recusa chave inexistente ou revogada', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue(null);
    await expect(service.autenticarPorChaveApi('clb_x')).rejects.toThrow(
      UnauthorizedException,
    );

    prisma.chaveApi.findUnique.mockResolvedValue({
      ...chaveDb,
      revogado_em: new Date(),
    });
    await expect(service.autenticarPorChaveApi(chaveRaw)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('recusa chave expirada', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue({
      ...chaveDb,
      expira_em: new Date(Date.now() - 1000),
    });
    await expect(service.autenticarPorChaveApi(chaveRaw)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('atualiza ultimo_uso_em quando defasado (>1 min), sem bloquear a requisição', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue({
      ...chaveDb,
      ultimo_uso_em: new Date(Date.now() - 5 * 60_000),
    });

    await service.autenticarPorChaveApi(chaveRaw);
    expect(prisma.chaveApi.update).toHaveBeenCalledTimes(1);
  });

  it('NÃO regrava ultimo_uso_em em uso recente (menos de 1 min)', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue({
      ...chaveDb,
      ultimo_uso_em: new Date(),
    });

    await service.autenticarPorChaveApi(chaveRaw);
    expect(prisma.chaveApi.update).not.toHaveBeenCalled();
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
