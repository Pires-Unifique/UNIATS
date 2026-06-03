import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { EmbeddingService } from '../services/embedding.service.js';
import { VoyageClient } from '../../voyage/voyage.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    VOYAGE_DIMENSIONS: 4,
    VOYAGE_MODEL: 'voyage-3',
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

describe('EmbeddingService', () => {
  let prisma: any;
  let voyage: jest.Mocked<VoyageClient>;
  let service: EmbeddingService;

  beforeEach(() => {
    prisma = {
      vaga: { findUnique: jest.fn() },
      curriculoProcessado: { findUnique: jest.fn() },
      embedding: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (cb) => cb(prisma)),
      $executeRaw: jest.fn(),
    };
    voyage = {
      embed: jest.fn(),
    } as unknown as jest.Mocked<VoyageClient>;
    service = new EmbeddingService(
      prisma as PrismaService,
      voyage,
      configMock(),
    );
  });

  describe('embedarVaga', () => {
    it('lança 404 se vaga inexistente', async () => {
      prisma.vaga.findUnique.mockResolvedValue(null);
      await expect(service.embedarVaga('v-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('chama Voyage, valida dimensão e insere via SQL bruto após deletar antigos', async () => {
      prisma.vaga.findUnique.mockResolvedValue({
        id: 'v-1',
        titulo: 'Dev Sr',
        descricao: 'd',
        requisitos_json: { skill: 'Node.js' },
      });
      voyage.embed.mockResolvedValue({
        vetores: [[0.1, 0.2, 0.3, 0.4]],
        modelo: 'voyage-3',
        usage: { total_tokens: 100 },
      });
      prisma.embedding.deleteMany.mockResolvedValue({ count: 1 });
      prisma.$executeRaw.mockResolvedValue(1);

      const out = await service.embedarVaga('v-1');

      expect(out.embeddingId).toMatch(/^[0-9a-f-]{36}$/);
      expect(voyage.embed).toHaveBeenCalledWith({
        textos: [expect.stringContaining('Dev Sr')],
        inputType: 'document',
      });
      expect(prisma.embedding.deleteMany).toHaveBeenCalledWith({
        where: { vaga_id: 'v-1', modelo: 'voyage-3' },
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('falha se Voyage retornar dimensão errada', async () => {
      prisma.vaga.findUnique.mockResolvedValue({
        id: 'v-1',
        titulo: 'X',
      });
      voyage.embed.mockResolvedValue({
        vetores: [[1, 2]], // 2 dims, esperava 4
        modelo: 'voyage-3',
        usage: { total_tokens: 1 },
      });
      await expect(service.embedarVaga('v-1')).rejects.toThrow(
        /dimensão inesperada/i,
      );
    });
  });

  describe('embedarCurriculo', () => {
    it('rejeita CV sem parser_versao ou pending', async () => {
      prisma.curriculoProcessado.findUnique.mockResolvedValue({
        parser_versao: 'pending',
        competencias: [],
        experiencias: [],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
      });
      await expect(service.embedarCurriculo('c-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('grava embedding do CV com texto canônico construído', async () => {
      prisma.curriculoProcessado.findUnique.mockResolvedValue({
        id: 'cv-1',
        resumo: 'Dev',
        competencias: ['Node'],
        experiencias: [{ cargo: 'Dev', empresa: 'X' }],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: 3,
        texto_normalizado: 'fallback',
        parser_versao: 'claude-curriculo-v1',
      });
      voyage.embed.mockResolvedValue({
        vetores: [[1, 1, 1, 1]],
        modelo: 'voyage-3',
        usage: { total_tokens: 50 },
      });
      prisma.embedding.deleteMany.mockResolvedValue({ count: 0 });
      prisma.$executeRaw.mockResolvedValue(1);

      const out = await service.embedarCurriculo('cand-1');
      expect(out.embeddingId).toMatch(/^[0-9a-f-]{36}$/);
      expect(voyage.embed).toHaveBeenCalledWith({
        textos: [expect.stringContaining('Resumo: Dev')],
        inputType: 'document',
      });
      expect(prisma.embedding.deleteMany).toHaveBeenCalledWith({
        where: { curriculo_id: 'cv-1', modelo: 'voyage-3' },
      });
    });
  });
});
