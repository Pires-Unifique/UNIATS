import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ClaudeService } from '../claude/claude.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type StatusResposta = 'ABORDADA' | 'PARCIAL' | 'NAO_ABORDADA';

const STATUS_LLM_PARA_ENUM: Record<string, StatusResposta> = {
  abordada: 'ABORDADA',
  parcial: 'PARCIAL',
  nao_abordada: 'NAO_ABORDADA',
};

/** Teto de perguntas por análise (bate com o maxItems do tool schema). */
const MAX_PERGUNTAS = 60;

const SELECT_RESPOSTA = {
  id: true,
  entrevista_id: true,
  pergunta_id: true,
  pergunta_padrao_id: true,
  pergunta_texto: true,
  ordem: true,
  status: true,
  tema_abordado: true,
  falante: true,
  sintese: true,
  citacao: true,
  modelo: true,
  prompt_versao: true,
  criado_em: true,
} as const;

/**
 * Análise pós-reunião: confronta o roteiro (perguntas padrão ativas do DHO +
 * perguntas da vaga/entrevista) com o texto final de falas — o fundido, quando
 * a fusão dos 2 motores já rodou — e grava, por pergunta, o que o candidato
 * respondeu. Reanalisar APAGA e recria o conjunto da entrevista (idempotente).
 *
 * Roda automaticamente após a fusão (best-effort) e sob demanda pelo botão da
 * tela — o DHO pode cadastrar perguntas DEPOIS da entrevista e reanalisar.
 */
@Injectable()
export class RespostasEntrevistaService {
  private readonly logger = new Logger(RespostasEntrevistaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
  ) {}

  async listar(entrevistaId: string) {
    return this.prisma.respostaEntrevista.findMany({
      where: { entrevista_id: entrevistaId },
      orderBy: { ordem: 'asc' },
      select: SELECT_RESPOSTA,
    });
  }

  async analisar(entrevistaId: string) {
    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        id: true,
        candidatura: { select: { vaga_id: true } },
        candidato: { select: { nome_completo: true } },
        transcricao: {
          select: { texto_fundido: true, texto_completo: true },
        },
      },
    });
    if (!entrevista) {
      throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    }

    // Texto analisado: a "melhor versão" (fusão Teams×Whisper) quando existe;
    // senão o texto do motor que chegou. Sem transcrição não há o que analisar.
    const texto =
      entrevista.transcricao?.texto_fundido?.trim() ||
      entrevista.transcricao?.texto_completo?.trim();
    if (!texto) {
      throw new BadRequestException(
        'Entrevista ainda sem transcrição — a análise roda sobre o texto das falas.',
      );
    }

    // Roteiro: perguntas padrão ativas (DHO) + perguntas da vaga (gerais) e da
    // entrevista específica, na ordem da tela.
    const [padrao, daVaga] = await Promise.all([
      this.prisma.perguntaPadrao.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: 'asc' }, { criado_em: 'asc' }],
        select: { id: true, pergunta: true, objetivo: true },
      }),
      this.prisma.perguntaEntrevista.findMany({
        where: {
          vaga_id: entrevista.candidatura.vaga_id,
          OR: [{ entrevista_id: null }, { entrevista_id: entrevistaId }],
        },
        orderBy: { ordem: 'asc' },
        select: { id: true, pergunta: true, objetivo: true },
      }),
    ]);

    const roteiro = [
      ...padrao.map((p) => ({ tipo: 'padrao' as const, ...p })),
      ...daVaga.map((p) => ({ tipo: 'entrevista' as const, ...p })),
    ];
    if (!roteiro.length) {
      throw new BadRequestException(
        'Nenhuma pergunta cadastrada ou gerada para esta entrevista.',
      );
    }
    if (roteiro.length > MAX_PERGUNTAS) {
      this.logger.warn(
        `Roteiro com ${roteiro.length} perguntas — analisando só as ${MAX_PERGUNTAS} primeiras (entrevista ${entrevistaId}).`,
      );
      roteiro.length = MAX_PERGUNTAS;
    }

    const comRef = roteiro.map((p, idx) => ({ ...p, ref: `P${idx + 1}` }));
    const analise = await this.claude.analisarRespostasEntrevista(
      texto,
      comRef.map((p) => ({
        ref: p.ref,
        pergunta: p.pergunta,
        objetivo: p.objetivo,
      })),
      entrevista.candidato?.nome_completo,
    );

    const porRef = new Map(analise.respostas.map((r) => [r.ref, r]));

    // Uma linha por pergunta do roteiro, SEMPRE: ref que o LLM não devolveu
    // vira "não abordada" (cobertura completa e determinística). Coerência
    // entre as duas dimensões forçada aqui — a âncora anti-alucinação é a
    // citação: qualquer alegação (resposta do candidato OU tema na conversa)
    // sem trecho literal é rebaixada.
    const linhas = comRef.map((p, idx) => {
      const r = porRef.get(p.ref);
      let status: StatusResposta = r
        ? STATUS_LLM_PARA_ENUM[r.status]
        : 'NAO_ABORDADA';
      const citacao = r?.citacao?.trim() || null;
      // Candidato respondeu ⇒ tema apareceu, por definição.
      let temaAbordado = r?.tema_abordado === true || status !== 'NAO_ABORDADA';
      if (!citacao) {
        status = 'NAO_ABORDADA';
        temaAbordado = false;
      }
      return {
        entrevista_id: entrevistaId,
        pergunta_id: p.tipo === 'entrevista' ? p.id : null,
        pergunta_padrao_id: p.tipo === 'padrao' ? p.id : null,
        pergunta_texto: p.pergunta,
        ordem: idx + 1,
        status,
        tema_abordado: temaAbordado,
        falante: temaAbordado
          ? (r?.falante?.trim().slice(0, 120) || null)
          : null,
        sintese: temaAbordado ? (r?.sintese?.trim() || null) : null,
        citacao: temaAbordado ? citacao : null,
        modelo: analise.modelo,
        prompt_versao: analise.promptVersao,
      };
    });

    await this.prisma.$transaction([
      this.prisma.respostaEntrevista.deleteMany({
        where: { entrevista_id: entrevistaId },
      }),
      this.prisma.respostaEntrevista.createMany({ data: linhas }),
    ]);

    const abordadas = linhas.filter((l) => l.status !== 'NAO_ABORDADA').length;
    this.logger.log(
      `Respostas analisadas: entrevista=${entrevistaId} perguntas=${linhas.length} ` +
        `abordadas=${abordadas} tokens=${analise.tokensEntrada}/${analise.tokensSaida}`,
    );

    return this.listar(entrevistaId);
  }
}
