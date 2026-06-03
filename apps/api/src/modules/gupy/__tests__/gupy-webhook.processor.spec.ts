import { describe, expect, it, jest } from '@jest/globals';

import { GupyWebhookProcessor } from '../processors/gupy-webhook.processor.js';

function montarProcessor(opts?: {
  findUniqueImpl?: jest.Mock;
  updateImpl?: jest.Mock;
  serviceImpl?: any;
}) {
  const findUnique = opts?.findUniqueImpl ?? jest.fn();
  const update = opts?.updateImpl ?? jest.fn().mockResolvedValue(undefined);
  const prisma = {
    webhookRecebido: { findUnique, update },
  } as any;
  const service = opts?.serviceImpl ?? {
    sincronizarCandidatura: jest.fn().mockResolvedValue({ id: 'app-1' }),
    sincronizarVaga: jest.fn().mockResolvedValue({ id: 'vaga-1' }),
  };
  return {
    processor: new GupyWebhookProcessor(prisma, service),
    prisma,
    service,
  };
}

describe('GupyWebhookProcessor', () => {
  it('aborta silenciosamente quando o registro não existe', async () => {
    const { processor, prisma } = montarProcessor({
      findUniqueImpl: jest.fn().mockResolvedValue(null),
    });
    const job: any = {
      data: { webhookId: 'wh-nope', event: 'application.created' },
    };
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(prisma.webhookRecebido.update).not.toHaveBeenCalled();
  });

  it('faz skip se já processado', async () => {
    const { processor, service } = montarProcessor({
      findUniqueImpl: jest.fn().mockResolvedValue({
        id: 'wh-1',
        processado: true,
        payload: { data: { id: 1 } },
      }),
    });
    await processor.process({
      data: { webhookId: 'wh-1', event: 'application.created' },
    } as any);
    expect(service.sincronizarCandidatura).not.toHaveBeenCalled();
  });

  it('despacha application.created → sincronizarCandidatura e marca processado', async () => {
    const { processor, prisma, service } = montarProcessor({
      findUniqueImpl: jest.fn().mockResolvedValue({
        id: 'wh-1',
        processado: false,
        payload: { data: { id: '5544332211' } },
      }),
    });
    await processor.process({
      data: { webhookId: 'wh-1', event: 'application.created' },
    } as any);

    expect(service.sincronizarCandidatura).toHaveBeenCalledWith(
      BigInt('5544332211'),
    );
    expect(prisma.webhookRecebido.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: expect.objectContaining({ processado: true }),
    });
  });

  it('despacha job.updated → sincronizarVaga', async () => {
    const { processor, service } = montarProcessor({
      findUniqueImpl: jest.fn().mockResolvedValue({
        id: 'wh-2',
        processado: false,
        payload: { data: { id: 987654 } },
      }),
    });
    await processor.process({
      data: { webhookId: 'wh-2', event: 'job.updated' },
    } as any);
    expect(service.sincronizarVaga).toHaveBeenCalledWith(BigInt(987654));
  });

  it('em caso de erro, incrementa tentativas, persiste ultimo_erro e re-lança', async () => {
    const erro = new Error('falha de upstream');
    const service = {
      sincronizarCandidatura: jest.fn().mockRejectedValue(erro),
      sincronizarVaga: jest.fn(),
    };
    const { processor, prisma } = montarProcessor({
      findUniqueImpl: jest.fn().mockResolvedValue({
        id: 'wh-3',
        processado: false,
        payload: { data: { id: 1 } },
      }),
      serviceImpl: service,
    });

    await expect(
      processor.process({
        data: { webhookId: 'wh-3', event: 'application.created' },
      } as any),
    ).rejects.toThrow('falha de upstream');

    expect(prisma.webhookRecebido.update).toHaveBeenCalledWith({
      where: { id: 'wh-3' },
      data: expect.objectContaining({
        tentativas: { increment: 1 },
        ultimo_erro: expect.stringContaining('falha de upstream'),
      }),
    });
  });

  it('lança erro se payload.data.id estiver ausente', async () => {
    const { processor } = montarProcessor({
      findUniqueImpl: jest.fn().mockResolvedValue({
        id: 'wh-4',
        processado: false,
        payload: { data: {} },
      }),
    });
    await expect(
      processor.process({
        data: { webhookId: 'wh-4', event: 'application.created' },
      } as any),
    ).rejects.toThrow('payload.data.id ausente');
  });
});
