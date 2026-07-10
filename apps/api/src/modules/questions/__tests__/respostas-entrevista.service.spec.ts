import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { RespostasEntrevistaService } from '../respostas-entrevista.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ClaudeService } from '../../claude/claude.service.js';

const ENTREVISTA_ID = '00000000-0000-4000-8000-0000000000e1';

function buildPrisma() {
  return {
    entrevista: { findUnique: jest.fn() },
    perguntaPadrao: { findMany: jest.fn().mockResolvedValue([]) },
    perguntaEntrevista: { findMany: jest.fn().mockResolvedValue([]) },
    respostaEntrevista: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // Forma de ARRAY do $transaction (lista de operações).
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops),
    ),
  };
}

function buildClaude() {
  return {
    analisarRespostasEntrevista: jest.fn(),
  };
}

describe('RespostasEntrevistaService.analisar', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let claude: ReturnType<typeof buildClaude>;
  let service: RespostasEntrevistaService;

  beforeEach(() => {
    prisma = buildPrisma();
    claude = buildClaude();
    service = new RespostasEntrevistaService(
      prisma as unknown as PrismaService,
      claude as unknown as ClaudeService,
    );
  });

  it('rejeita entrevista inexistente', async () => {
    prisma.entrevista.findUnique.mockResolvedValue(null);
    await expect(service.analisar(ENTREVISTA_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejeita entrevista sem transcrição', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: ENTREVISTA_ID,
      candidatura: { vaga_id: 'v-1' },
      candidato: { nome_completo: 'Fulano de Tal' },
      transcricao: null,
    });
    await expect(service.analisar(ENTREVISTA_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita quando não há nenhuma pergunta no roteiro', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: ENTREVISTA_ID,
      candidatura: { vaga_id: 'v-1' },
      candidato: { nome_completo: 'Fulano de Tal' },
      transcricao: { texto_fundido: 'Falas da reunião.', texto_completo: 'x' },
    });
    await expect(service.analisar(ENTREVISTA_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claude.analisarRespostasEntrevista).not.toHaveBeenCalled();
  });

  it('fluxo completo: usa o texto fundido, mapeia refs e rebaixa status sem citação', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: ENTREVISTA_ID,
      candidatura: { vaga_id: 'v-1' },
      candidato: { nome_completo: 'João da Silva' },
      transcricao: {
        texto_fundido: 'Recrutadora: Fala do transcript fundido.',
        texto_completo: 'texto cru que NÃO deve ser usado',
      },
    });
    // Roteiro: 1 padrão (DHO) + 2 da vaga/entrevista
    prisma.perguntaPadrao.findMany.mockResolvedValue([
      { id: 'pp-1', pergunta: 'O que você conhece da empresa?', objetivo: null },
    ]);
    prisma.perguntaEntrevista.findMany.mockResolvedValue([
      { id: 'pe-1', pergunta: 'Experiência com Node.js?', objetivo: 'Validar backend' },
      { id: 'pe-2', pergunta: 'Como lida com prazos apertados?', objetivo: null },
    ]);
    claude.analisarRespostasEntrevista.mockResolvedValue({
      respostas: [
        {
          ref: 'P1',
          status: 'abordada',
          tema_abordado: true,
          falante: 'João da Silva',
          sintese: 'Conhece a empresa por ser cliente.',
          citacao: 'sou cliente da Unifique há anos',
        },
        // P2: "abordada" SEM citação → rebaixada nas DUAS dimensões (âncora anti-alucinação)
        { ref: 'P2', status: 'abordada', tema_abordado: true, sintese: 'Sabe Node.' },
        // P3 ausente → deve virar NAO_ABORDADA / tema false
      ],
      promptVersao: 'claude-respostas-v2',
      modelo: 'claude-sonnet-4-6',
      tokensEntrada: 10,
      tokensSaida: 10,
    });

    await service.analisar(ENTREVISTA_ID);

    // Chamou o Claude com o texto FUNDIDO, o roteiro completo e o nome do candidato
    const [texto, roteiro, candidatoNome] =
      claude.analisarRespostasEntrevista.mock.calls[0];
    expect(texto).toContain('transcript fundido');
    expect(roteiro).toHaveLength(3);
    expect(roteiro[0]).toMatchObject({ ref: 'P1', pergunta: 'O que você conhece da empresa?' });
    expect(candidatoNome).toBe('João da Silva');

    // Apagou as antigas e recriou o conjunto inteiro
    expect(prisma.respostaEntrevista.deleteMany).toHaveBeenCalledWith({
      where: { entrevista_id: ENTREVISTA_ID },
    });
    const linhas = prisma.respostaEntrevista.createMany.mock.calls[0][0].data;
    expect(linhas).toHaveLength(3);

    // P1 (padrão): respondida pelo candidato, vinculada a pergunta_padrao_id
    expect(linhas[0]).toMatchObject({
      pergunta_padrao_id: 'pp-1',
      pergunta_id: null,
      status: 'ABORDADA',
      tema_abordado: true,
      falante: 'João da Silva',
      citacao: 'sou cliente da Unifique há anos',
      ordem: 1,
    });
    // P2 (vaga): sem citação → rebaixada nas duas dimensões
    expect(linhas[1]).toMatchObject({
      pergunta_id: 'pe-1',
      pergunta_padrao_id: null,
      status: 'NAO_ABORDADA',
      tema_abordado: false,
      falante: null,
      sintese: null,
      citacao: null,
    });
    // P3: o LLM não devolveu → não abordada
    expect(linhas[2]).toMatchObject({
      pergunta_id: 'pe-2',
      status: 'NAO_ABORDADA',
      tema_abordado: false,
      ordem: 3,
    });
  });

  it('tema tratado por OUTRO participante: status não respondida + tema_abordado com falante', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: ENTREVISTA_ID,
      candidatura: { vaga_id: 'v-1' },
      candidato: { nome_completo: 'João da Silva' },
      transcricao: { texto_fundido: 'Guilherme: o Teams confunde o português com inglês.', texto_completo: 'x' },
    });
    prisma.perguntaEntrevista.findMany.mockResolvedValue([
      { id: 'pe-1', pergunta: 'Qual língua o Teams costuma confundir na transcrição?', objetivo: null },
    ]);
    claude.analisarRespostasEntrevista.mockResolvedValue({
      respostas: [
        {
          ref: 'P1',
          status: 'nao_abordada',
          tema_abordado: true,
          falante: 'Guilherme Pires Viana',
          sintese: 'Quem tratou do tema foi Guilherme (não o candidato): o Teams distorce o português encaixando sonoridade do inglês.',
          citacao: 'o Teams confunde o português com inglês',
        },
      ],
      promptVersao: 'claude-respostas-v2',
      modelo: 'claude-sonnet-4-6',
      tokensEntrada: 5,
      tokensSaida: 5,
    });

    await service.analisar(ENTREVISTA_ID);

    const linhas = prisma.respostaEntrevista.createMany.mock.calls[0][0].data;
    expect(linhas[0]).toMatchObject({
      status: 'NAO_ABORDADA',
      tema_abordado: true,
      falante: 'Guilherme Pires Viana',
      citacao: 'o Teams confunde o português com inglês',
    });
    expect(linhas[0].sintese).toContain('Guilherme');
  });

  it('cai para o texto_completo quando não houve fusão', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: ENTREVISTA_ID,
      candidatura: { vaga_id: 'v-1' },
      transcricao: { texto_fundido: null, texto_completo: 'Texto do motor único.' },
    });
    prisma.perguntaEntrevista.findMany.mockResolvedValue([
      { id: 'pe-1', pergunta: 'Pergunta qualquer do roteiro?', objetivo: null },
    ]);
    claude.analisarRespostasEntrevista.mockResolvedValue({
      respostas: [{ ref: 'P1', status: 'nao_abordada' }],
      promptVersao: 'claude-respostas-v1',
      modelo: 'claude-sonnet-4-6',
      tokensEntrada: 1,
      tokensSaida: 1,
    });

    await service.analisar(ENTREVISTA_ID);

    const [texto] = claude.analisarRespostasEntrevista.mock.calls[0];
    expect(texto).toBe('Texto do motor único.');
  });
});
