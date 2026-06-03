import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';

import { MessagingService } from '../messaging.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import type { TemplateResolvido } from '../templates/template.types.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

function buildPrismaMock() {
  return {
    candidatura: { findUnique: jest.fn() },
    mensagem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

const CONVITE_RESOLVIDO: TemplateResolvido = {
  codigo: 'convite_triagem',
  versao: 'v1',
  whatsapp: {
    corpo:
      'Olá, {{candidato_nome}}! Vaga *{{vaga_titulo}}*. Confirme: {{link_confirmacao}}',
  },
  email: {
    assunto: 'Processo — {{vaga_titulo}}',
    texto: 'Olá {{candidato_nome}}, {{vaga_titulo}}: {{link_confirmacao}}',
  },
};

function buildTemplatesMock() {
  return {
    obterPorCodigo: jest.fn(async (codigo: string) => {
      if (codigo === 'convite_triagem') return CONVITE_RESOLVIDO;
      throw new NotFoundException(`Template "${codigo}" não existe.`);
    }),
  };
}

describe('MessagingService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let templates: ReturnType<typeof buildTemplatesMock>;
  let fila: jest.Mocked<Queue>;
  let service: MessagingService;

  const candidaturaId = '00000000-0000-4000-8000-000000000001';
  const candidatoId = '00000000-0000-4000-8000-000000000002';

  beforeEach(() => {
    prisma = buildPrismaMock();
    templates = buildTemplatesMock();
    fila = { add: jest.fn() } as unknown as jest.Mocked<Queue>;
    service = new MessagingService(
      prisma as unknown as PrismaService,
      templates as unknown as TemplatesService,
      fila,
    );
  });

  describe('enfileirar', () => {
    const variaveis = {
      candidato_nome: 'Ana',
      vaga_titulo: 'Dev Sr',
      link_confirmacao: 'https://t.example/c',
    };

    it('rejeita template inexistente', async () => {
      await expect(
        service.enfileirar({
          candidaturaId,
          canal: 'WHATSAPP',
          templateCodigo: 'inexistente',
          variaveis,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita variáveis insuficientes (dry-run falha)', async () => {
      await expect(
        service.enfileirar({
          candidaturaId,
          canal: 'WHATSAPP',
          templateCodigo: 'convite_triagem',
          variaveis: { candidato_nome: 'Ana' }, // faltam vaga_titulo, link_confirmacao
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita candidato excluído por LGPD', async () => {
      prisma.candidatura.findUnique.mockResolvedValue({
        id: candidaturaId,
        candidato_id: candidatoId,
        candidato: {
          id: candidatoId,
          email: 'a@x.com',
          telefone: '+5547999998888',
          consentimento_lgpd_em: new Date(),
          excluido_em: new Date(),
        },
      });
      await expect(
        service.enfileirar({
          candidaturaId,
          canal: 'WHATSAPP',
          templateCodigo: 'convite_triagem',
          variaveis,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita candidato sem consentimento LGPD', async () => {
      prisma.candidatura.findUnique.mockResolvedValue({
        id: candidaturaId,
        candidato_id: candidatoId,
        candidato: {
          id: candidatoId,
          email: 'a@x.com',
          telefone: '+5547999998888',
          consentimento_lgpd_em: null,
          excluido_em: null,
        },
      });
      await expect(
        service.enfileirar({
          candidaturaId,
          canal: 'WHATSAPP',
          templateCodigo: 'convite_triagem',
          variaveis,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cria mensagem PENDENTE e enfileira com jobId determinístico', async () => {
      prisma.candidatura.findUnique.mockResolvedValue({
        id: candidaturaId,
        candidato_id: candidatoId,
        candidato: {
          id: candidatoId,
          email: 'a@x.com',
          telefone: '+5547999998888',
          consentimento_lgpd_em: new Date(),
          excluido_em: null,
        },
      });
      prisma.mensagem.create.mockResolvedValue({ id: 'msg-1' });

      const out = await service.enfileirar({
        candidaturaId,
        canal: 'WHATSAPP',
        templateCodigo: 'convite_triagem',
        variaveis,
      });
      expect(out.mensagemId).toBe('msg-1');
      expect(prisma.mensagem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            canal: 'WHATSAPP',
            direcao: 'SAIDA',
            template_codigo: 'convite_triagem@v1',
            destino: '+5547999998888',
            provider: 'waha',
            status: 'PENDENTE',
          }),
        }),
      );
      expect(fila.add).toHaveBeenCalledWith(
        'enviar-mensagem',
        expect.objectContaining({
          mensagemId: 'msg-1',
          canalPrimario: 'WHATSAPP',
          templateCodigo: 'convite_triagem',
        }),
        expect.objectContaining({ jobId: 'msg-msg-1', delay: 0 }),
      );
    });

    it('respeita agendamento futuro com delay', async () => {
      prisma.candidatura.findUnique.mockResolvedValue({
        id: candidaturaId,
        candidato_id: candidatoId,
        candidato: {
          id: candidatoId,
          email: 'a@x.com',
          telefone: '+5547999998888',
          consentimento_lgpd_em: new Date(),
          excluido_em: null,
        },
      });
      prisma.mensagem.create.mockResolvedValue({ id: 'msg-2' });
      const futuro = new Date(Date.now() + 60_000);
      await service.enfileirar({
        candidaturaId,
        canal: 'EMAIL',
        templateCodigo: 'convite_triagem',
        variaveis,
        agendadoPara: futuro,
      });
      const opts = fila.add.mock.calls[0][2] as any;
      expect(opts.delay).toBeGreaterThan(50_000);
    });
  });

  describe('atualizarStatusWebhook', () => {
    it('não regride status (ENTREGUE → ENVIADO ignorado)', async () => {
      prisma.mensagem.findFirst.mockResolvedValue({
        id: 'm-1',
        status: 'ENTREGUE',
      });
      const r = await service.atualizarStatusWebhook(
        'prov-msg-1',
        'ENVIADO',
        new Date(),
      );
      expect(r.atualizou).toBe(false);
      expect(prisma.mensagem.update).not.toHaveBeenCalled();
    });

    it('avança para LIDO e grava timestamp', async () => {
      prisma.mensagem.findFirst.mockResolvedValue({
        id: 'm-1',
        status: 'ENTREGUE',
      });
      const ts = new Date('2026-01-15T10:00:00Z');
      const r = await service.atualizarStatusWebhook('prov-msg-1', 'LIDO', ts);
      expect(r.atualizou).toBe(true);
      expect(prisma.mensagem.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { status: 'LIDO', lido_em: ts },
      });
    });

    it('grava FALHADO mesmo após estados avançados', async () => {
      prisma.mensagem.findFirst.mockResolvedValue({
        id: 'm-1',
        status: 'LIDO',
      });
      const r = await service.atualizarStatusWebhook(
        'prov-msg-1',
        'FALHADO',
        new Date(),
      );
      expect(r.atualizou).toBe(true);
    });

    it('retorna atualizou=false se mensagem não encontrada', async () => {
      prisma.mensagem.findFirst.mockResolvedValue(null);
      const r = await service.atualizarStatusWebhook(
        'prov-msg-1',
        'ENTREGUE',
        new Date(),
      );
      expect(r.atualizou).toBe(false);
    });
  });
});
