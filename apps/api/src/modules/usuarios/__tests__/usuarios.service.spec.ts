import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { UsuariosService } from '../usuarios.service.js';

/**
 * Foco: as TRAVAS da tela de Usuários — auto-edição proibida, validação de
 * áreas/domínio, pré-cadastro (oid provisório) e remoção segura.
 */
type MockPrisma = {
  usuario: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  registroAuditoria: { create: jest.Mock };
};

const ADMIN = {
  id: 'adm-1',
  azure_oid: 'oid-adm',
  email: 'admin@unifique.com.br',
  nome: 'Admin',
  papel: 'ADMIN',
  areas: ['admin'],
  ativo: true,
} as any;

const GESTOR_ACESSOS = {
  id: 'ga-1',
  azure_oid: 'oid-ga',
  email: 'acessos@unifique.com.br',
  nome: 'Gestora de Acessos',
  papel: 'VISUALIZADOR',
  areas: ['gestao_acessos'],
  ativo: true,
} as any;

const usuarioDb = {
  id: 'u-1',
  azure_oid: 'oid-1',
  email: 'fulano@unifique.com.br',
  nome: 'Fulano',
  areas: [] as string[],
  ativo: true,
  ultimo_login_em: null as Date | null,
  criado_em: new Date('2026-07-01T12:00:00Z'),
  _count: { vagas_gestao: 2 },
};

function montar(envOverrides: Record<string, unknown> = {}) {
  const prisma: MockPrisma = {
    usuario: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    registroAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const env: Record<string, unknown> = {
    AZURE_AD_ALLOWED_DOMAIN: 'unifique.com.br,redeunifique.com.br',
    ...envOverrides,
  };
  const config = { get: jest.fn((k: string) => env[k]) };
  const auth = { ehAdminPorAmbiente: jest.fn().mockReturnValue(false) };
  const service = new UsuariosService(prisma as any, config as any, auth as any);
  return { service, prisma, auth };
}

describe('UsuariosService.atualizar — travas', () => {
  let ctx: ReturnType<typeof montar>;
  beforeEach(() => {
    ctx = montar();
    ctx.prisma.usuario.findUnique.mockResolvedValue(usuarioDb);
    ctx.prisma.usuario.update.mockResolvedValue(usuarioDb);
  });

  it('recusa auto-edição (não dá para se trancar fora nem se auto-promover)', async () => {
    await expect(
      ctx.service.atualizar(ADMIN.id, { ativo: false }, ADMIN),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('recusa área inválida (fora de AREAS_ATRIBUIVEIS)', async () => {
    await expect(
      ctx.service.atualizar('u-1', { areas: ['offboarding'] }, ADMIN),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.service.atualizar('u-1', { areas: ['gestor'] }, ADMIN),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa corpo vazio (nada a atualizar)', async () => {
    await expect(ctx.service.atualizar('u-1', {}, ADMIN)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('atualiza áreas (dedupe) e grava auditoria com antes/depois', async () => {
    ctx.prisma.usuario.update.mockResolvedValue({
      ...usuarioDb,
      areas: ['dho'],
    });

    await ctx.service.atualizar('u-1', { areas: ['dho', 'dho'] }, ADMIN);

    const upd = ctx.prisma.usuario.update.mock.calls[0][0] as any;
    expect(upd.data.areas).toEqual(['dho']);
    const audit = ctx.prisma.registroAuditoria.create.mock.calls[0][0] as any;
    expect(audit.data).toMatchObject({
      usuario_id: ADMIN.id,
      acao: 'usuario_acessos_atualizados',
      entidade: 'usuario',
      entidade_id: 'u-1',
    });
    expect(audit.data.diff.antes).toEqual({ areas: [], ativo: true });
    expect(audit.data.diff.depois).toEqual({ areas: ['dho'], ativo: true });
  });
});

describe('UsuariosService — travas de escalação (autor com gestao_acessos, sem admin)', () => {
  let ctx: ReturnType<typeof montar>;
  beforeEach(() => {
    ctx = montar();
    ctx.prisma.usuario.update.mockResolvedValue(usuarioDb);
  });

  it('libera áreas básicas normalmente (recrutamento/admissão/dho)', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue(usuarioDb);
    await expect(
      ctx.service.atualizar('u-1', { areas: ['recrutamento'] }, GESTOR_ACESSOS),
    ).resolves.toBeDefined();
    expect(ctx.prisma.usuario.update).toHaveBeenCalled();
  });

  it('recusa CONCEDER admin ou gestao_acessos', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue(usuarioDb);
    await expect(
      ctx.service.atualizar('u-1', { areas: ['admin'] }, GESTOR_ACESSOS),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      ctx.service.atualizar('u-1', { areas: ['gestao_acessos'] }, GESTOR_ACESSOS),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('recusa EDITAR/DESATIVAR quem já tem admin (mesmo sem mexer nas áreas)', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue({
      ...usuarioDb,
      areas: ['admin'],
    });
    await expect(
      ctx.service.atualizar('u-1', { ativo: false }, GESTOR_ACESSOS),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('recusa REVOGAR gestao_acessos de outro usuário (custódia é do admin)', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue({
      ...usuarioDb,
      areas: ['gestao_acessos'],
    });
    await expect(
      ctx.service.atualizar('u-1', { areas: [] }, GESTOR_ACESSOS),
    ).rejects.toThrow(ForbiddenException);
  });

  it('recusa PRÉ-CADASTRAR com admin/gestao_acessos, mas aceita com áreas básicas', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue(null);
    await expect(
      ctx.service.preCadastrar(
        { email: 'novo@unifique.com.br', areas: ['admin'] },
        GESTOR_ACESSOS,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.usuario.create).not.toHaveBeenCalled();

    ctx.prisma.usuario.create.mockResolvedValue({
      ...usuarioDb,
      azure_oid: 'pre-cadastro:xyz',
      areas: ['admissao'],
    });
    await expect(
      ctx.service.preCadastrar(
        { email: 'novo@unifique.com.br', areas: ['admissao'] },
        GESTOR_ACESSOS,
      ),
    ).resolves.toBeDefined();
  });

  it('recusa REMOVER pré-cadastro que possui admin/gestao_acessos', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue({
      ...usuarioDb,
      azure_oid: 'pre-cadastro:xyz',
      ultimo_login_em: null,
      areas: ['gestao_acessos'],
    });
    await expect(
      ctx.service.removerPreCadastro('u-1', GESTOR_ACESSOS),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.usuario.delete).not.toHaveBeenCalled();
  });

  it('ADMIN segue podendo tudo (concede gestao_acessos e edita admins)', async () => {
    ctx.prisma.usuario.findUnique.mockResolvedValue({
      ...usuarioDb,
      areas: ['admin'],
    });
    await expect(
      ctx.service.atualizar('u-1', { areas: ['gestao_acessos'] }, ADMIN),
    ).resolves.toBeDefined();
  });
});

describe('UsuariosService.preCadastrar', () => {
  it('cria com azure_oid provisório (pre-cadastro:) e papel VISUALIZADOR', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(null);
    prisma.usuario.create.mockResolvedValue({
      ...usuarioDb,
      azure_oid: 'pre-cadastro:xyz',
      areas: ['dho'],
    });

    const r = await service.preCadastrar(
      { email: 'Fernanda.Costa@unifique.com.br', areas: ['dho'] },
      ADMIN,
    );

    const arg = prisma.usuario.create.mock.calls[0][0] as any;
    expect(arg.data.azure_oid).toMatch(/^pre-cadastro:/);
    expect(arg.data.email).toBe('fernanda.costa@unifique.com.br'); // normalizado
    expect(arg.data.papel).toBe('VISUALIZADOR');
    expect(arg.data.areas).toEqual(['dho']);
    expect(r.aguardando_primeiro_login).toBe(true);
  });

  it('recusa domínio fora da allowlist do SSO', async () => {
    const { service, prisma } = montar();
    await expect(
      service.preCadastrar({ email: 'x@gmail.com', areas: [] }, ADMIN),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.usuario.create).not.toHaveBeenCalled();
  });

  it('recusa e-mail já cadastrado (409 aponta para editar na lista)', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue(usuarioDb);
    await expect(
      service.preCadastrar(
        { email: 'fulano@unifique.com.br', areas: [] },
        ADMIN,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('UsuariosService.removerPreCadastro', () => {
  it('remove pré-cadastro que nunca logou', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue({
      ...usuarioDb,
      azure_oid: 'pre-cadastro:xyz',
      ultimo_login_em: null,
    });
    prisma.usuario.delete.mockResolvedValue({});

    await expect(service.removerPreCadastro('u-1', ADMIN)).resolves.toEqual({
      ok: true,
    });
    expect(prisma.usuario.delete).toHaveBeenCalledWith({ where: { id: 'u-1' } });
  });

  it('recusa remover usuário real (que já logou) — o caminho é Desativar', async () => {
    const { service, prisma } = montar();
    prisma.usuario.findUnique.mockResolvedValue({
      ...usuarioDb,
      ultimo_login_em: new Date(),
    });
    await expect(service.removerPreCadastro('u-1', ADMIN)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.usuario.delete).not.toHaveBeenCalled();
  });
});

describe('UsuariosService.listar', () => {
  it('mapeia contagem de vagas, selo de ambiente e pré-cadastro no DTO', async () => {
    const { service, prisma, auth } = montar();
    auth.ehAdminPorAmbiente.mockReturnValue(true);
    prisma.usuario.findMany.mockResolvedValue([usuarioDb]);

    const [dto] = await service.listar();

    expect(dto.vagas_como_gestor).toBe(2);
    expect(dto.admin_via_ambiente).toBe(true);
    expect(dto.aguardando_primeiro_login).toBe(false);
    // por padrão só ativos
    const arg = prisma.usuario.findMany.mock.calls[0][0] as any;
    expect(arg.where).toMatchObject({ ativo: true });
  });
});
