import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { ChavesApiService } from '../chaves-api.service.js';

/**
 * Foco: geração segura (hash-only no banco, chave completa uma única vez),
 * validação de escopos ('admin' proibido) e revogação.
 */
type MockPrisma = {
  chaveApi: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
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

function montar() {
  const prisma: MockPrisma = {
    chaveApi: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    registroAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const service = new ChavesApiService(prisma as any);
  return { service, prisma };
}

const chaveDb = {
  id: 'ch-1',
  nome: 'Integração UNIIT',
  prefixo: 'clb_9f2a41c8',
  escopos: ['recrutamento'],
  criado_por_nome: 'Admin',
  expira_em: null,
  ultimo_uso_em: null,
  revogado_em: null,
  criado_em: new Date('2026-07-03T10:00:00Z'),
};

describe('ChavesApiService.gerar', () => {
  it('devolve a chave completa UMA vez e persiste apenas o SHA-256 + prefixo', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.create.mockImplementation(async (arg: any) => ({
      ...chaveDb,
      ...arg.data,
      id: 'ch-1',
      criado_em: new Date(),
    }));

    const r = await service.gerar(
      { nome: 'Integração UNIIT', escopos: ['recrutamento'] },
      ADMIN,
    );

    expect(r.chave).toMatch(/^clb_[0-9a-f]{48}$/);
    const arg = prisma.chaveApi.create.mock.calls[0][0] as any;
    // hash persistido corresponde à chave devolvida; a chave em claro não vai ao banco
    expect(arg.data.hash).toBe(
      createHash('sha256').update(r.chave, 'utf8').digest('hex'),
    );
    expect(JSON.stringify(arg.data)).not.toContain(r.chave);
    expect(arg.data.prefixo).toBe(r.chave.slice(0, 12));
    expect(arg.data.escopos).toEqual(['recrutamento']);
  });

  it("recusa escopo 'admin' e escopos desconhecidos", async () => {
    const { service } = montar();
    await expect(
      service.gerar({ nome: 'x', escopos: ['admin'] }, ADMIN),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.gerar({ nome: 'x', escopos: ['banana'] }, ADMIN),
    ).rejects.toThrow(BadRequestException);
  });

  it('exige nome e ao menos um escopo', async () => {
    const { service } = montar();
    await expect(
      service.gerar({ nome: '', escopos: ['recrutamento'] }, ADMIN),
    ).rejects.toThrow(BadRequestException);
    await expect(service.gerar({ nome: 'x', escopos: [] }, ADMIN)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('valida validade_dias e calcula expira_em', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.create.mockResolvedValue(chaveDb);

    await expect(
      service.gerar({ nome: 'x', escopos: ['dho'], validade_dias: 0 }, ADMIN),
    ).rejects.toThrow(BadRequestException);

    await service.gerar({ nome: 'x', escopos: ['dho'], validade_dias: 90 }, ADMIN);
    const arg = prisma.chaveApi.create.mock.calls[0][0] as any;
    expect(arg.data.expira_em).toBeInstanceOf(Date);
  });
});

describe('ChavesApiService.revogar', () => {
  it('marca revogado_em e audita', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue(chaveDb);
    prisma.chaveApi.update.mockResolvedValue({
      ...chaveDb,
      revogado_em: new Date(),
    });

    const r = await service.revogar('ch-1', ADMIN);

    expect(r.revogado_em).not.toBeNull();
    const upd = prisma.chaveApi.update.mock.calls[0][0] as any;
    expect(upd.data.revogado_em).toBeInstanceOf(Date);
    expect(upd.data.revogado_por_id).toBe(ADMIN.id);
    const audit = prisma.registroAuditoria.create.mock.calls[0][0] as any;
    expect(audit.data.acao).toBe('chave_api_revogada');
  });

  it('recusa revogar chave já revogada ou inexistente', async () => {
    const { service, prisma } = montar();
    prisma.chaveApi.findUnique.mockResolvedValue({
      ...chaveDb,
      revogado_em: new Date(),
    });
    await expect(service.revogar('ch-1', ADMIN)).rejects.toThrow(
      BadRequestException,
    );

    prisma.chaveApi.findUnique.mockResolvedValue(null);
    await expect(service.revogar('ch-x', ADMIN)).rejects.toThrow(
      NotFoundException,
    );
  });
});
