import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@uniats/db';

import { TemplatesService } from '../templates/templates.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

function buildPrismaMock() {
  return {
    templateMensagem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tpl-1',
    codigo: 'convite_triagem',
    nome: 'Convite',
    descricao: null,
    versao: 'v1',
    ativo: true,
    whatsapp_corpo: 'Olá {{candidato_nome}} — {{vaga_titulo}}',
    email_assunto: null,
    email_texto: null,
    email_html: null,
    criado_por: null,
    atualizado_por: null,
    criado_em: new Date(),
    atualizado_em: new Date(),
    ...over,
  };
}

describe('TemplatesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: TemplatesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new TemplatesService(prisma as unknown as PrismaService);
  });

  describe('listarAtivos', () => {
    it('mapeia para catálogo derivando variáveis e canais', async () => {
      prisma.templateMensagem.findMany.mockResolvedValue([
        row({
          whatsapp_corpo: 'Oi {{candidato_nome}}',
          email_assunto: 'Assunto {{vaga_titulo}}',
          email_texto: 'Texto {{candidato_nome}} {{link}}',
        }),
      ]);
      const out = await service.listarAtivos();
      expect(out[0].canais.sort()).toEqual(['EMAIL', 'WHATSAPP']);
      expect(out[0].variaveis.sort()).toEqual([
        'candidato_nome',
        'link',
        'vaga_titulo',
      ]);
    });
  });

  describe('obterPorCodigo', () => {
    it('resolve template ativo', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(row());
      const t = await service.obterPorCodigo('convite_triagem');
      expect(t.codigo).toBe('convite_triagem');
      expect(t.whatsapp?.corpo).toContain('{{candidato_nome}}');
      expect(t.email).toBeUndefined();
    });

    it('lança NotFound se inativo', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(
        row({ ativo: false }),
      );
      await expect(service.obterPorCodigo('convite_triagem')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lança NotFound se inexistente', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(null);
      await expect(service.obterPorCodigo('xpto')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('criar', () => {
    it('rejeita codigo inválido', async () => {
      await expect(
        service.criar({ codigo: 'Inválido!', nome: 'X', whatsappCorpo: 'oi' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita quando nenhum corpo é informado', async () => {
      await expect(
        service.criar({ codigo: 'novo', nome: 'X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria com versao v1', async () => {
      prisma.templateMensagem.create.mockResolvedValue(
        row({ codigo: 'novo', nome: 'Novo', versao: 'v1' }),
      );
      const out = await service.criar({
        codigo: 'novo',
        nome: 'Novo',
        whatsappCorpo: 'Oi {{candidato_nome}}',
      });
      expect(out.versao).toBe('v1');
      expect(prisma.templateMensagem.create).toHaveBeenCalled();
    });

    it('traduz P2002 em BadRequest (código duplicado)', async () => {
      prisma.templateMensagem.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.criar({ codigo: 'novo', nome: 'X', whatsappCorpo: 'oi' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('atualizar', () => {
    it('incrementa a versão e mantém ao menos um corpo', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(row({ versao: 'v1' }));
      prisma.templateMensagem.update.mockResolvedValue(
        row({ versao: 'v2', nome: 'Editado' }),
      );
      const out = await service.atualizar('convite_triagem', { nome: 'Editado' });
      expect(out.versao).toBe('v2');
      expect(prisma.templateMensagem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ versao: 'v2' }),
        }),
      );
    });

    it('rejeita remover o único corpo existente', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(
        row({ whatsapp_corpo: 'oi', email_assunto: null, email_texto: null }),
      );
      await expect(
        service.atualizar('convite_triagem', { whatsappCorpo: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lança NotFound se não existe', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(null);
      await expect(
        service.atualizar('xpto', { nome: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('desabilitar', () => {
    it('marca ativo=false', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue({ id: 'tpl-1' });
      prisma.templateMensagem.update.mockResolvedValue(row({ ativo: false }));
      const out = await service.desabilitar('convite_triagem');
      expect(out).toEqual({ codigo: 'convite_triagem', ativo: false });
      expect(prisma.templateMensagem.update).toHaveBeenCalledWith({
        where: { codigo: 'convite_triagem' },
        data: { ativo: false },
      });
    });

    it('lança NotFound se não existe', async () => {
      prisma.templateMensagem.findUnique.mockResolvedValue(null);
      await expect(service.desabilitar('xpto')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
