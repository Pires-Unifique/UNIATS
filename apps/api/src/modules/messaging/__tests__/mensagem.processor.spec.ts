import { NotFoundException } from '@nestjs/common';
import type { Job } from 'bullmq';

import { MensagemProcessor } from '../processors/mensagem.processor.js';
import { MessagingService } from '../messaging.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import type { TemplateResolvido } from '../templates/template.types.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SendGridClient } from '../../sendgrid/sendgrid.client.js';
import { WahaClient } from '../../waha/waha.client.js';

function fakeJob(data: unknown, id = '1'): Job<unknown> {
  return { id, data, attemptsMade: 0 } as Job<unknown>;
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

describe('MensagemProcessor', () => {
  let messaging: jest.Mocked<MessagingService>;
  let templates: jest.Mocked<TemplatesService>;
  let waha: jest.Mocked<WahaClient>;
  let sendgrid: jest.Mocked<SendGridClient>;
  let prisma: any;
  let processor: MensagemProcessor;

  const candidatoTelefone = '+5547999998888';
  const candidatoEmail = 'ana@example.com';
  const mensagemId = '00000000-0000-4000-8000-000000000010';

  const variaveis = {
    candidato_nome: 'Ana',
    vaga_titulo: 'Dev Sr',
    link_confirmacao: 'https://t.example/c',
  };

  beforeEach(() => {
    messaging = {
      marcarEnviado: jest.fn(),
      marcarFalha: jest.fn(),
    } as unknown as jest.Mocked<MessagingService>;

    waha = {
      checkNumber: jest.fn(),
      sendText: jest.fn(),
    } as unknown as jest.Mocked<WahaClient>;

    sendgrid = {
      enviarEmail: jest.fn(),
    } as unknown as jest.Mocked<SendGridClient>;

    templates = {
      obterPorCodigo: jest.fn(async () => CONVITE_RESOLVIDO),
    } as unknown as jest.Mocked<TemplatesService>;

    prisma = {
      mensagem: { findUnique: jest.fn() },
    };

    processor = new MensagemProcessor(
      messaging,
      templates,
      waha,
      sendgrid,
      prisma as PrismaService,
    );
  });

  function basePayload(canal: 'WHATSAPP' | 'EMAIL', permitirFallback = true) {
    return {
      mensagemId,
      canalPrimario: canal,
      permitirFallback,
      templateCodigo: 'convite_triagem',
      variaveis,
    };
  }

  function mensagemFromDb(opts: { excluido?: boolean; status?: string } = {}) {
    return {
      id: mensagemId,
      status: opts.status ?? 'PENDENTE',
      candidato: {
        email: candidatoEmail,
        telefone: candidatoTelefone,
        excluido_em: opts.excluido ? new Date() : null,
      },
    };
  }

  it('rejeita payload inválido', async () => {
    await expect(
      processor.process(fakeJob({ mensagemId: 'x' })),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('pula envio se status != PENDENTE (job duplicado)', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(
      mensagemFromDb({ status: 'ENVIADO' }),
    );
    const out = await processor.process(fakeJob(basePayload('WHATSAPP')));
    expect(out.providerMsgId).toBe('(ja-enviada)');
    expect(waha.sendText).not.toHaveBeenCalled();
  });

  it('cancela envio se candidato foi excluído após enfileirar', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(
      mensagemFromDb({ excluido: true }),
    );
    await expect(
      processor.process(fakeJob(basePayload('WHATSAPP'))),
    ).rejects.toThrow(/excluído/);
    expect(messaging.marcarFalha).toHaveBeenCalled();
  });

  it('envia WhatsApp com sucesso: checkNumber → sendText → marcarEnviado', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(mensagemFromDb());
    waha.checkNumber.mockResolvedValue({
      numberExists: true,
      chatId: '5547999998888@c.us',
    });
    waha.sendText.mockResolvedValue({
      messageId: 'true_5547@c.us_AAA',
      timestamp: Date.now(),
    });

    const out = await processor.process(fakeJob(basePayload('WHATSAPP')));
    expect(out.canal).toBe('WHATSAPP');
    expect(out.providerMsgId).toBe('true_5547@c.us_AAA');
    expect(messaging.marcarEnviado).toHaveBeenCalledWith(
      mensagemId,
      'true_5547@c.us_AAA',
      'WHATSAPP',
      '5547999998888@c.us',
      undefined,
    );
  });

  it('falha permanente (número não existe) e fallback EMAIL com sucesso', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(mensagemFromDb());
    waha.checkNumber.mockResolvedValue({ numberExists: false });
    sendgrid.enviarEmail.mockResolvedValue({
      messageId: 'sg-msg-1',
    });

    const out = await processor.process(fakeJob(basePayload('WHATSAPP')));

    expect(out.canal).toBe('EMAIL');
    expect(out.providerMsgId).toBe('sg-msg-1');
    expect(sendgrid.enviarEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        para: candidatoEmail,
        assunto: expect.any(String),
      }),
    );
    expect(messaging.marcarEnviado).toHaveBeenCalledWith(
      mensagemId,
      'sg-msg-1',
      'EMAIL',
      candidatoEmail,
      expect.any(String),
    );
  });

  it('falha recuperável (5xx) é relançada para BullMQ re-tentar sem fallback', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(mensagemFromDb());
    waha.checkNumber.mockResolvedValue({
      numberExists: true,
      chatId: '5547999998888@c.us',
    });
    const err: any = new Error('ServiceUnavailable: WAHA down');
    err.status = 503;
    waha.sendText.mockRejectedValue(err);

    await expect(
      processor.process(fakeJob(basePayload('WHATSAPP'))),
    ).rejects.toThrow(/ServiceUnavailable/);
    expect(sendgrid.enviarEmail).not.toHaveBeenCalled();
    expect(messaging.marcarFalha).not.toHaveBeenCalled();
  });

  it('falha em ambos os canais marca FALHADO definitivo', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(mensagemFromDb());
    waha.checkNumber.mockResolvedValue({ numberExists: false });
    const sgErr: any = new Error('bounce permanente');
    sgErr.status = 400;
    sendgrid.enviarEmail.mockRejectedValue(sgErr);

    await expect(
      processor.process(fakeJob(basePayload('WHATSAPP'))),
    ).rejects.toThrow();
    expect(messaging.marcarFalha).toHaveBeenCalledWith(
      mensagemId,
      expect.stringMatching(/ambos os canais/i),
    );
  });

  it('template desabilitado após enfileirar → falha definitiva (marcarFalha)', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(mensagemFromDb());
    templates.obterPorCodigo.mockRejectedValue(
      new NotFoundException('Template "convite_triagem" não existe ou está inativo.'),
    );

    await expect(
      processor.process(fakeJob(basePayload('WHATSAPP'))),
    ).rejects.toThrow();
    expect(waha.sendText).not.toHaveBeenCalled();
    expect(messaging.marcarFalha).toHaveBeenCalled();
  });

  it('respeita permitirFallback=false', async () => {
    prisma.mensagem.findUnique.mockResolvedValue(mensagemFromDb());
    waha.checkNumber.mockResolvedValue({ numberExists: false });

    await expect(
      processor.process(fakeJob(basePayload('WHATSAPP', false))),
    ).rejects.toThrow();
    expect(sendgrid.enviarEmail).not.toHaveBeenCalled();
    expect(messaging.marcarFalha).toHaveBeenCalled();
  });
});
