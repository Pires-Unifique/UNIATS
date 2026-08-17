import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@collab/db';

import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../../embeddings/embedding.provider.js';
import type { CurriculoEstruturado } from '../../claude/curriculo.schema.js';
import {
  prepararCurriculoParaIA,
  SELECT_CURRICULO_PARA_IA,
} from '../../redacao/curriculo-para-ia.js';
import {
  TEXTO_CANONICO_VERSAO,
  montarTextoCanonicoCurriculo,
  montarTextoCanonicoVaga,
} from './texto-canonico.js';

export type EmbeddingAlvo = 'vaga' | 'curriculo';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly dimensoes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
  ) {
    // A dimensão esperada vem do provedor ativo (Voyage=1024, e5-base=768, etc.).
    this.dimensoes = this.provider.dimensoes;
  }

  /**
   * Gera (ou regenera) o embedding de uma VAGA.
   * Idempotente por (vaga_id, modelo) — apaga registros anteriores do mesmo modelo
   * antes de inserir um novo, para evitar acúmulo histórico ofuscando a busca.
   */
  async embedarVaga(vagaId: string): Promise<{ embeddingId: string }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: {
        id: true,
        titulo: true,
        descricao: true,
        departamento: true,
        unidade: true,
        cidade: true,
        estado: true,
        remoto: true,
        tipo_contrato: true,
        requisitos_json: true,
        requisitos_texto: true,
      },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    const texto = montarTextoCanonicoVaga(vaga);
    if (!texto.trim()) {
      throw new BadRequestException(
        'Vaga sem dados suficientes para gerar embedding.',
      );
    }

    return this.gravar({
      alvo: 'vaga',
      alvoId: vaga.id,
      texto,
    });
  }

  /**
   * Gera (ou regenera) o embedding de um CURRÍCULO já estruturado pela Camada 2.
   */
  async embedarCurriculo(
    candidaturaId: string,
  ): Promise<{ embeddingId: string }> {
    const cv = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: {
        id: true,
        parser_versao: true,
        ...SELECT_CURRICULO_PARA_IA,
      },
    });
    if (!cv) {
      throw new NotFoundException(
        `Currículo da candidatura ${candidaturaId} não existe.`,
      );
    }
    if (!cv.parser_versao || cv.parser_versao === 'pending') {
      throw new BadRequestException(
        `Currículo da candidatura ${candidaturaId} ainda não foi estruturado.`,
      );
    }

    // FRONTEIRA: o vetor sai daqui para a Voyage, fora do Brasil. Só o que
    // passa por `prepararCurriculoParaIA` pode ir junto.
    const seguro = prepararCurriculoParaIA(cv);

    const texto = montarTextoCanonicoCurriculo({
      resumo: seguro.resumo,
      estruturado: {
        experiencias:
          seguro.experiencias as CurriculoEstruturado['experiencias'],
        formacoes: seguro.formacoes as CurriculoEstruturado['formacoes'],
        competencias: seguro.competencias,
        idiomas: seguro.idiomas as CurriculoEstruturado['idiomas'],
        certificacoes:
          seguro.certificacoes as CurriculoEstruturado['certificacoes'],
        anos_experiencia: seguro.anos_experiencia ?? undefined,
      },
    });

    // O fallback é o texto CENSURADO — nunca `texto_normalizado` cru, que
    // carrega as descrições em texto livre.
    const textoFinal = texto.trim() || seguro.textoLiteral;
    if (!textoFinal) {
      throw new BadRequestException(
        'Currículo sem conteúdo suficiente para embedding.',
      );
    }

    return this.gravar({
      alvo: 'curriculo',
      alvoId: cv.id,
      texto: textoFinal,
    });
  }

  /**
   * EMBEDDING EM LOTE de uma vaga: gera o vetor da vaga + de TODOS os CVs
   * estruturados em poucas requisições (lotes de ≤128 por chamada ao provider),
   * em vez de 1 requisição por CV. Remove o gargalo do rate limit (1 chamada
   * para a vaga inteira ≈ segundos, contra ~22s × N com chamadas individuais).
   *
   * Por padrão pula CVs que já têm vetor (idempotente/rápido em re-execução).
   */
  async embedarVagaEmLote(
    vagaId: string,
    opts: { reembedar?: boolean; incluirReprovados?: boolean } = {},
  ): Promise<{
    vaga: boolean;
    curriculos: number;
    pulados: number;
    interrompido: boolean;
    restantes: number;
  }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: {
        id: true,
        titulo: true,
        descricao: true,
        departamento: true,
        unidade: true,
        cidade: true,
        estado: true,
        remoto: true,
        tipo_contrato: true,
        requisitos_json: true,
        requisitos_texto: true,
      },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    type Item = { alvo: EmbeddingAlvo; alvoId: string; texto: string };
    const itens: Item[] = [];

    // Limite de tokens por requisição. No free tier (TPM baixo) precisa caber em
    // RPM × budget ≤ TPM (ex.: 3 RPM × 3300 ≈ 9.9K < 10K TPM). Default conservador
    // pro free; tier pago sobe via EMBEDDING_TOKEN_BUDGET no env.
    const TOKEN_BUDGET = Math.max(
      500,
      Number(process.env.EMBEDDING_TOKEN_BUDGET ?? 3300),
    );
    const MAX_INPUTS = Math.min(
      128,
      Math.max(1, Number(process.env.EMBEDDING_BATCH_SIZE ?? 128)),
    );
    const estTokens = (t: string) => Math.ceil(t.length / 4);
    // Teto por item: nem um CV isolado pode passar do budget — senão um currículo
    // muito grande, mandado sozinho (chunk de 1), estoura o TPM. ~4 chars/token.
    const maxCharsPorItem = TOKEN_BUDGET * 4;
    const capTexto = (t: string) =>
      t.length > maxCharsPorItem ? t.slice(0, maxCharsPorItem) : t;

    const textoVaga = montarTextoCanonicoVaga(vaga);
    if (textoVaga.trim()) {
      // Pula o embedding da vaga se ela já tem vetor (a menos que reembedar):
      // sem isto, cada chamada repetida do loop do front re-embeda a vaga e
      // desperdiça uma janela do throttle (≈22s no trial) que deveria ir p/ CVs.
      const vagaJaEmbedada =
        !opts.reembedar &&
        (await this.prisma.embedding.count({ where: { vaga_id: vaga.id } })) > 0;
      if (!vagaJaEmbedada) {
        itens.push({ alvo: 'vaga', alvoId: vaga.id, texto: capTexto(textoVaga) });
      }
    }

    // CVs estruturados da vaga. Por padrão ignora candidaturas descartadas
    // (REPROVADO/DESISTENTE) — a menos que incluirReprovados=true.
    const cvs = await this.prisma.curriculoProcessado.findMany({
      where: {
        candidatura: {
          vaga_id: vagaId,
          ...(opts.incluirReprovados
            ? {}
            : { status: { notIn: ['REPROVADO', 'DESISTENTE'] } }),
        },
      },
      select: {
        id: true,
        parser_versao: true,
        ...SELECT_CURRICULO_PARA_IA,
      },
    });

    // CVs que já têm vetor (para pular quando reembedar=false).
    let jaComVetor = new Set<string>();
    if (!opts.reembedar && cvs.length) {
      const rows = await this.prisma.embedding.findMany({
        where: { curriculo_id: { in: cvs.map((c) => c.id) } },
        select: { curriculo_id: true },
        distinct: ['curriculo_id'],
      });
      jaComVetor = new Set(
        rows.map((r) => r.curriculo_id).filter((v): v is string => !!v),
      );
    }

    let pulados = 0;
    for (const cv of cvs) {
      if (!cv.parser_versao || cv.parser_versao === 'pending') {
        pulados++;
        continue;
      }
      if (jaComVetor.has(cv.id)) {
        pulados++;
        continue;
      }
      // Mesma fronteira do caminho unitário — ver `embedarCurriculo`.
      const seguro = prepararCurriculoParaIA(cv);
      const texto =
        montarTextoCanonicoCurriculo({
          resumo: seguro.resumo,
          estruturado: {
            experiencias:
              seguro.experiencias as CurriculoEstruturado['experiencias'],
            formacoes: seguro.formacoes as CurriculoEstruturado['formacoes'],
            competencias: seguro.competencias,
            idiomas: seguro.idiomas as CurriculoEstruturado['idiomas'],
            certificacoes:
              seguro.certificacoes as CurriculoEstruturado['certificacoes'],
            anos_experiencia: seguro.anos_experiencia ?? undefined,
          },
        }).trim() || seguro.textoLiteral;
      if (!texto.trim()) {
        pulados++;
        continue;
      }
      itens.push({ alvo: 'curriculo', alvoId: cv.id, texto: capTexto(texto) });
    }

    if (!itens.length) {
      return { vaga: false, curriculos: 0, pulados, interrompido: false, restantes: 0 };
    }

    // Lotes ADAPTATIVOS por orçamento de tokens (TOKEN_BUDGET, definido no topo):
    // o limite real do Voyage é tokens/requisição, não nº de CVs. Empacotamos
    // itens até perto do budget (ou do teto de MAX_INPUTS). O throttle espaça as
    // chamadas; ~4 chars/token superestima (PT-BR 4-5) → lotes menores = seguro.
    const lotes: Item[][] = [];
    let atual: Item[] = [];
    let tokensAtual = 0;
    for (const it of itens) {
      const tk = estTokens(it.texto);
      if (
        atual.length > 0 &&
        (tokensAtual + tk > TOKEN_BUDGET || atual.length >= MAX_INPUTS)
      ) {
        lotes.push(atual);
        atual = [];
        tokensAtual = 0;
      }
      atual.push(it); // item isolado maior que o orçamento vai sozinho (chunk de 1)
      tokensAtual += tk;
    }
    if (atual.length) lotes.push(atual);

    // Processa e GRAVA chunk a chunk (commit incremental). Assim, se o Voyage
    // estourar o rate limit (429) no meio de uma vaga grande, o que já embedou
    // FICA salvo — e como pulamos CVs já embedados, re-rodar continua de onde parou.
    let curriculos = 0;
    let temVaga = false;
    let modelo = this.provider.nome;
    let interrompido = false;
    let erro: unknown = null;

    // Orçamento de tempo POR REQUISIÇÃO: processa lotes até ~BUDGET e devolve
    // parcial (interrompido=true) se sobrar. Sem isto, uma vaga grande processa
    // TODOS os lotes numa única chamada (minutos, throttle do Voyage) e estoura o
    // timeout do proxy reverso — que o browser reporta como erro de CORS (a
    // resposta de gateway não traz Access-Control-Allow-Origin). O front re-chama
    // em loop e, como pulamos o que já embedou, continua de onde parou.
    // Adapta ao tier: trial (lento) faz ~1 lote/chamada; tier pago faz vários.
    const BUDGET_MS = Math.max(
      5_000,
      Number(process.env.EMBEDDING_LOTE_BUDGET_MS ?? 20_000),
    );
    const inicioMs = Date.now();
    let lotesFeitos = 0;

    for (const lote of lotes) {
      // Depois de ao menos 1 lote, respeita o orçamento de tempo da requisição.
      if (lotesFeitos > 0 && Date.now() - inicioMs >= BUDGET_MS) {
        interrompido = true;
        break;
      }
      let out: { vetores: number[][]; modelo: string };
      try {
        out = await this.provider.embed({
          textos: lote.map((it) => it.texto),
          inputType: 'document',
        });
      } catch (e) {
        // 429/rede: para, mas mantém o que já foi gravado nos chunks anteriores.
        erro = e;
        interrompido = true;
        break;
      }
      modelo = out.modelo;

      for (const v of out.vetores) {
        if (v.length !== this.dimensoes) {
          throw new Error(
            `Vetor com dimensão inesperada: ${v.length} ≠ ${this.dimensoes}`,
          );
        }
      }

      await this.prisma.$transaction(async (tx) => {
        const vagaIds = lote.filter((i) => i.alvo === 'vaga').map((i) => i.alvoId);
        const cvIds = lote.filter((i) => i.alvo === 'curriculo').map((i) => i.alvoId);
        if (vagaIds.length) {
          await tx.embedding.deleteMany({ where: { vaga_id: { in: vagaIds }, modelo } });
        }
        if (cvIds.length) {
          await tx.embedding.deleteMany({ where: { curriculo_id: { in: cvIds }, modelo } });
        }
        for (let k = 0; k < lote.length; k++) {
          const it = lote[k];
          const vetorLiteral = `[${out.vetores[k].join(',')}]`;
          const id = crypto.randomUUID();
          if (it.alvo === 'vaga') {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO embeddings (id, vaga_id, trecho, vetor, modelo, modelo_versao, criado_em)
              VALUES (${id}::uuid, ${it.alvoId}::uuid, ${it.texto},
                ${vetorLiteral}::vector, ${modelo}, ${TEXTO_CANONICO_VERSAO}, NOW())
            `);
          } else {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO embeddings (id, curriculo_id, trecho, vetor, modelo, modelo_versao, criado_em)
              VALUES (${id}::uuid, ${it.alvoId}::uuid, ${it.texto},
                ${vetorLiteral}::vector, ${modelo}, ${TEXTO_CANONICO_VERSAO}, NOW())
            `);
          }
        }
      });

      temVaga = temVaga || lote.some((i) => i.alvo === 'vaga');
      curriculos += lote.filter((i) => i.alvo === 'curriculo').length;
      lotesFeitos++;
    }

    // Se NADA foi gravado e houve erro, propaga (usuário vê a falha). Se houve
    // progresso, retorna parcial (200) com interrompido=true — re-rodar continua.
    if (curriculos === 0 && !temVaga && erro) throw erro;

    const restantes = itens.filter((i) => i.alvo === 'curriculo').length - curriculos;
    this.logger.log(
      `Embedding em lote: vaga=${vagaId} vetorVaga=${temVaga} cvs=${curriculos} ` +
        `pulados=${pulados} restantes=${restantes} interrompido=${interrompido} modelo=${modelo}`,
    );
    return { vaga: temVaga, curriculos, pulados, interrompido, restantes };
  }

  /**
   * Núcleo: chama Voyage, valida dimensão, apaga embeddings anteriores do mesmo
   * (alvo, modelo) e insere o novo via SQL bruto (pgvector).
   */
  private async gravar(input: {
    alvo: EmbeddingAlvo;
    alvoId: string;
    texto: string;
  }): Promise<{ embeddingId: string }> {
    // Curto-circuito por CONTEÚDO: se o vetor vigente foi gerado deste mesmo
    // texto (coluna `trecho`), mesmo modelo e mesma versão canônica, re-embedar
    // produziria um vetor idêntico — não chama o provider. É o guard contra
    // loops de retry/sync recobrando conteúdo inalterado (a mecânica da queima
    // de 8M tokens Voyage em jun/2026). Texto/modelo/versão diferentes seguem
    // o fluxo normal e substituem o vetor.
    const vigente = await this.prisma.embedding.findFirst({
      where:
        input.alvo === 'vaga'
          ? { vaga_id: input.alvoId, modelo: this.provider.nome }
          : { curriculo_id: input.alvoId, modelo: this.provider.nome },
      select: { id: true, trecho: true, modelo_versao: true },
    });
    if (
      vigente &&
      vigente.modelo_versao === TEXTO_CANONICO_VERSAO &&
      vigente.trecho === input.texto
    ) {
      this.logger.debug(
        `Embedding já vigente para ${input.alvo}=${input.alvoId} — pulando provider.`,
      );
      return { embeddingId: vigente.id };
    }

    const { vetores, modelo, usage } = await this.provider.embed({
      textos: [input.texto],
      inputType: 'document',
    });

    const vetor = vetores[0];
    if (vetor.length !== this.dimensoes) {
      throw new Error(
        `Vetor com dimensão inesperada: ${vetor.length} ≠ ${this.dimensoes}`,
      );
    }

    // Mantemos histórico curto: 1 embedding por (alvo, modelo). Re-embedar substitui.
    // Uma única transação evita janela onde o ranking veria 0 vetores.
    const embeddingId: string = await this.prisma.$transaction<string>(async (tx): Promise<string> => {
      if (input.alvo === 'vaga') {
        await tx.embedding.deleteMany({
          where: { vaga_id: input.alvoId, modelo },
        });
      } else {
        await tx.embedding.deleteMany({
          where: { curriculo_id: input.alvoId, modelo },
        });
      }

      // pgvector exige a sintaxe '[v1,v2,...]'::vector. Geramos com cuidado:
      // - vetor é array de Number(), portanto seguro (não é entrada de usuário).
      // - IDs são UUIDs validados pelo Prisma e passamos como parâmetros (não interpolação).
      const vetorLiteral = `[${vetor.join(',')}]`;
      const id = crypto.randomUUID();

      if (input.alvo === 'vaga') {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO embeddings (id, vaga_id, trecho, vetor, modelo, modelo_versao, criado_em)
          VALUES (
            ${id}::uuid,
            ${input.alvoId}::uuid,
            ${input.texto},
            ${vetorLiteral}::vector,
            ${modelo},
            ${TEXTO_CANONICO_VERSAO},
            NOW()
          )
        `);
      } else {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO embeddings (id, curriculo_id, trecho, vetor, modelo, modelo_versao, criado_em)
          VALUES (
            ${id}::uuid,
            ${input.alvoId}::uuid,
            ${input.texto},
            ${vetorLiteral}::vector,
            ${modelo},
            ${TEXTO_CANONICO_VERSAO},
            NOW()
          )
        `);
      }

      return id;
    });

    this.logger.log(
      `Embedding gravado: alvo=${input.alvo} id=${input.alvoId} ` +
        `tokens=${usage?.total_tokens ?? 'n/a'} modelo=${modelo}`,
    );

    return { embeddingId };
  }
}
