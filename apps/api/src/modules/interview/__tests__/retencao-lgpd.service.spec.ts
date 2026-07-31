import { Prisma } from '@collab/db';

import { RetencaoLGPDService } from '../services/retencao-lgpd.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

function montar() {
  const prisma: any = {
    entrevista: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    transcricao: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    registroAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const storage: any = { deleteObject: jest.fn().mockResolvedValue(undefined) };
  const service = new RetencaoLGPDService(
    prisma as PrismaService,
    storage as StorageService,
  );
  return { service, prisma, storage };
}

describe('RetencaoLGPDService.apagarAudiosExpirados', () => {
  it('apaga o blob no storage antes de zerar a referência no banco', async () => {
    const { service, prisma, storage } = montar();
    prisma.entrevista.findMany.mockResolvedValue([
      { id: 'e-1', audio_url: 'audio/aa/bb/sha.enc', audio_sha256: 'a'.repeat(64) },
    ]);

    const r = await service.apagarAudiosExpirados();

    expect(r.removidos).toBe(1);
    expect(storage.deleteObject).toHaveBeenCalledWith('audio/aa/bb/sha.enc');
    expect(prisma.entrevista.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { audio_url: null, audio_sha256: null, audio_expira_em: null },
    });
    expect(prisma.registroAuditoria.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acao: 'retencao_lgpd_audio' }),
      }),
    );
  });

  it('se o storage falhar, PRESERVA audio_url para o cron tentar de novo', async () => {
    const { service, prisma, storage } = montar();
    prisma.entrevista.findMany.mockResolvedValue([
      { id: 'e-1', audio_url: 'audio/aa/bb/sha.enc', audio_sha256: null },
    ]);
    storage.deleteObject.mockRejectedValue(new Error('MinIO fora do ar'));

    const r = await service.apagarAudiosExpirados();

    expect(r.removidos).toBe(0);
    expect(prisma.entrevista.update).not.toHaveBeenCalled();
    expect(prisma.registroAuditoria.create).not.toHaveBeenCalled();
  });

  it('processa cada entrevista de forma independente (uma falha não bloqueia as outras)', async () => {
    const { service, prisma, storage } = montar();
    prisma.entrevista.findMany.mockResolvedValue([
      { id: 'e-1', audio_url: 'audio/1.enc', audio_sha256: null },
      { id: 'e-2', audio_url: 'audio/2.enc', audio_sha256: null },
    ]);
    storage.deleteObject.mockImplementation(async (key: string) => {
      if (key === 'audio/1.enc') throw new Error('falha pontual');
    });

    const r = await service.apagarAudiosExpirados();

    expect(r.removidos).toBe(1);
    expect(prisma.entrevista.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e-2' } }),
    );
  });
});

describe('RetencaoLGPDService.truncarTranscricoesExpiradas', () => {
  it('limpa também a fusão e os segmentos do 2º motor (mesmo conteúdo bruto)', async () => {
    const { service, prisma } = montar();
    prisma.transcricao.findMany.mockResolvedValue([
      { id: 't-1', entrevista_id: 'e-1', texto_completo: 'conversa inteira' },
    ]);

    const r = await service.truncarTranscricoesExpiradas();

    expect(r.truncadas).toBe(1);
    const arg = prisma.transcricao.update.mock.calls[0][0];
    expect(arg.data).toEqual(
      expect.objectContaining({
        texto_completo: '[retencao_lgpd: conteudo removido]',
        whisper_segmentos: Prisma.DbNull,
        texto_fundido: null,
        segmentos_fundidos: Prisma.DbNull,
        expira_em: null,
      }),
    );
  });
});
