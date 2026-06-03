import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Request } from 'express';

import { GupyWebhookController } from '../gupy-webhook.controller.js';

import {
  webhookApplicationCreatedJson,
  webhookJobUpdatedJson,
  envelopeInvalido,
} from './fixtures/gupy.fixtures.js';

const SEGREDO = 'segredo-de-testes-NUNCA-EM-PROD';

function assinar(raw: Buffer, segredo = SEGREDO): string {
  const hex = createHmac('sha256', segredo).update(raw).digest('hex');
  return `sha256=${hex}`;
}

function montarReq(body: Buffer): Request {
  return { body } as unknown as Request;
}

function montarController(opts?: {
  createImpl?: jest.Mock;
  addImpl?: jest.Mock;
}): {
  controller: GupyWebhookController;
  prisma: any;
  fila: any;
} {
  const create = opts?.createImpl ?? jest.fn().mockResolvedValue({ id: 'wh-uuid-1' });
  const add = opts?.addImpl ?? jest.fn().mockResolvedValue(undefined);
  const prisma = { webhookRecebido: { create } } as any;
  const fila = { add } as any;
  const config = {
    get: (k: string) => (k === 'GUPY_WEBHOOK_SECRET' ? SEGREDO : undefined),
    getOrThrow: (k: string) => {
      if (k === 'GUPY_WEBHOOK_SECRET') return SEGREDO;
      throw new Error(`unknown ${k}`);
    },
  } as any;

  const controller = new GupyWebhookController(config, prisma, fila);
  return { controller, prisma, fila };
}

describe('GupyWebhookController.receber', () => {
  it('rejeita quando body não é Buffer', async () => {
    const { controller } = montarController();
    const req = { body: undefined } as unknown as Request;
    await expect(controller.receber(req, 'sha256=00', undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita quando body é Buffer vazio', async () => {
    const { controller } = montarController();
    await expect(
      controller.receber(montarReq(Buffer.alloc(0)), 'sha256=00', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita quando assinatura está ausente', async () => {
    const { controller } = montarController();
    const raw = Buffer.from('{}');
    await expect(
      controller.receber(montarReq(raw), undefined, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita assinatura inválida', async () => {
    const { controller, prisma } = montarController();
    const raw = Buffer.from(JSON.stringify(webhookApplicationCreatedJson));
    await expect(
      controller.receber(
        montarReq(raw),
        'sha256=' + '00'.repeat(32), // hex válido, mas hash errado
        undefined,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.webhookRecebido.create).not.toHaveBeenCalled();
  });

  it('rejeita assinatura em formato inválido (não-hex / length errada)', async () => {
    const { controller } = montarController();
    const raw = Buffer.from(JSON.stringify(webhookApplicationCreatedJson));
    for (const bad of [
      'sha256=zzzzzz',
      'sha256=', // vazia
      'md5=' + 'a'.repeat(64),
      'sha256=' + 'a'.repeat(63),
      'plainstring',
    ]) {
      await expect(
        controller.receber(montarReq(raw), bad, undefined),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejeita JSON malformado mesmo com HMAC correto', async () => {
    const { controller } = montarController();
    const raw = Buffer.from('{not json}');
    await expect(
      controller.receber(montarReq(raw), assinar(raw), undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita envelope com event desconhecido', async () => {
    const { controller } = montarController();
    const raw = Buffer.from(JSON.stringify(envelopeInvalido));
    await expect(
      controller.receber(montarReq(raw), assinar(raw), undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita evento application.created e enfileira processamento', async () => {
    const { controller, prisma, fila } = montarController();
    const raw = Buffer.from(JSON.stringify(webhookApplicationCreatedJson));
    const res = await controller.receber(montarReq(raw), assinar(raw), undefined);

    expect(res).toEqual({ status: 'accepted', id: 'wh-uuid-1' });
    expect(prisma.webhookRecebido.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'gupy',
        evento: 'application.created',
        external_id: 'evt-001-create',
        assinatura_ok: true,
      }),
    });
    expect(fila.add).toHaveBeenCalledWith(
      'application.created',
      { webhookId: 'wh-uuid-1', event: 'application.created' },
      expect.objectContaining({
        jobId: 'gupy-wh-wh-uuid-1',
        attempts: 8,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
  });

  it('aceita evento job.updated', async () => {
    const { controller, prisma, fila } = montarController();
    const raw = Buffer.from(JSON.stringify(webhookJobUpdatedJson));
    const res = await controller.receber(montarReq(raw), assinar(raw), undefined);
    expect(res.status).toBe('accepted');
    expect(prisma.webhookRecebido.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ evento: 'job.updated' }),
    });
    expect(fila.add).toHaveBeenCalled();
  });

  it('idempotência: duplicata (P2002) retorna status=duplicate sem enfileirar', async () => {
    const erroDuplicata = Object.assign(new Error('dup'), { code: 'P2002' });
    const create = jest.fn().mockRejectedValue(erroDuplicata);
    const { controller, fila } = montarController({ createImpl: create });

    const raw = Buffer.from(JSON.stringify(webhookApplicationCreatedJson));
    const res = await controller.receber(montarReq(raw), assinar(raw), undefined);
    expect(res).toEqual({ status: 'duplicate' });
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('propaga erros não-P2002', async () => {
    const erroOutro = Object.assign(new Error('db down'), { code: 'P1001' });
    const create = jest.fn().mockRejectedValue(erroOutro);
    const { controller } = montarController({ createImpl: create });

    const raw = Buffer.from(JSON.stringify(webhookApplicationCreatedJson));
    await expect(
      controller.receber(montarReq(raw), assinar(raw), undefined),
    ).rejects.toThrow('db down');
  });

  it('usa eventId do header se o envelope não tiver', async () => {
    const { controller, prisma } = montarController();
    const semId = { ...webhookApplicationCreatedJson, eventId: undefined };
    const raw = Buffer.from(JSON.stringify(semId));
    await controller.receber(montarReq(raw), assinar(raw), 'header-event-id-42');
    expect(prisma.webhookRecebido.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ external_id: 'header-event-id-42' }),
    });
  });

  it('aceita assinatura com case-insensitive (sha256=ABC...)', async () => {
    const { controller } = montarController();
    const raw = Buffer.from(JSON.stringify(webhookApplicationCreatedJson));
    const hex = createHmac('sha256', SEGREDO).update(raw).digest('hex').toUpperCase();
    const res = await controller.receber(montarReq(raw), `sha256=${hex}`, undefined);
    expect(res.status).toBe('accepted');
  });
});
