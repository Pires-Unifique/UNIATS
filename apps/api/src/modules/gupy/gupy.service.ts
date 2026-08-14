import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@collab/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';
import { AdmissaoService } from '../admissao/admissao.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PARSER_PROMPT_VERSION } from '../claude/claude.service.js';
import { GupyClient } from './gupy.client.js';

type CvExistente = {
  arquivo_url: string | null;
  parser_versao: string | null;
} | null;
import {
  paraUpsertCandidato,
  paraUpsertCandidatura,
  paraUpsertCurriculoGupy,
  paraUpsertVaga,
} from './mappers/gupy.mapper.js';

@Injectable()
export class GupyService {
  private readonly logger = new Logger(GupyService.name);

  constructor(
    private readonly client: GupyClient,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly admissao: AdmissaoService,
    @InjectQueue(QUEUE_NAMES.CV_DOWNLOAD)
    private readonly filaCV: Queue,
  ) {}

  /** Estado atual do currículo da candidatura (uma leitura, reusada nas decisões abaixo). */
  private buscarCvExistente(candidaturaId: string): Promise<CvExistente> {
    return this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: { arquivo_url: true, parser_versao: true },
    });
  }

  /**
   * CV com arquivo baixado E estruturado pela versão ATUAL do parser Claude:
   * re-sync não tem trabalho novo (re-baixar/re-parsear/re-embedar sairia caro
   * e idêntico). Vetor faltante é curado pelo cron de reconciliação; bump de
   * PARSER_PROMPT_VERSION invalida o skip e reprocessa todo mundo.
   */
  private static cvJaProcessado(cv: CvExistente): boolean {
    return !!cv?.arquivo_url && cv.parser_versao === PARSER_PROMPT_VERSION;
  }

  /**
   * TOMBSTONE LGPD — candidato apagado NUNCA volta.
   *
   * `paraUpsertCandidato` usa `update: base`, ou seja, todo sync reescreve nome,
   * e-mail, telefone e LinkedIn a partir do payload da Gupy. Sem esta trava, um
   * candidato anonimizado (por retenção ou a pedido do titular, Art. 18) seria
   * repopulado na próxima passada do cron — a exclusão duraria no máximo 6h e a
   * conformidade seria só aparente.
   *
   * A Gupy continua sendo a fonte, e o registro continua lá: o que fazemos é
   * recusar reimportá-lo. `excluido_em` é a lápide, e ela é definitiva enquanto
   * não for removida à mão no banco.
   */
  /**
   * Quando alguém PUXADO do banco de talentos depois se inscreve de verdade na
   * mesma vaga pela Gupy, existem duas identidades para a mesma pessoa: a
   * candidatura local (gupy_id NULL) e a inscrição que acaba de chegar.
   *
   * O upsert do sync casa por `gupy_id`, então tentaria CRIAR uma segunda linha
   * e bateria no unique (vaga_id, candidato_id) — quebrando o sync da vaga
   * inteira. Aqui a candidatura local ADOTA o gupy_id que chegou, preservando o
   * histórico (notas, entrevistas, mensagens) em vez de duplicar a pessoa.
   * `origem` continua BANCO_TALENTOS: ela de fato veio do banco.
   */
  private async adotarCandidaturaLocal(
    vagaId: string,
    candidatoId: string,
    gupyCandidaturaId: bigint,
  ): Promise<void> {
    const local = await this.prisma.candidatura.findUnique({
      where: { vaga_id_candidato_id: { vaga_id: vagaId, candidato_id: candidatoId } },
      select: { id: true, gupy_id: true },
    });
    if (!local || local.gupy_id !== null) return;
    await this.prisma.candidatura.update({
      where: { id: local.id },
      data: { gupy_id: gupyCandidaturaId },
    });
    this.logger.log(
      `Candidatura local (banco de talentos) ${local.id} adotou gupy_id=${gupyCandidaturaId} — a pessoa se inscreveu na vaga.`,
    );
  }

  private async candidatoApagado(gupyId: bigint): Promise<boolean> {
    const existente = await this.prisma.candidato.findUnique({
      where: { gupy_id: gupyId },
      select: { excluido_em: true },
    });
    return existente?.excluido_em != null;
  }

  /**
   * Aplica o currículo ESTRUTURADO da Gupy sem rebaixar um currículo que já
   * veio do PDF: quando o arquivo já foi baixado (arquivo_url) ou parseado
   * pelo Claude, o update do perfil estruturado zeraria o ponteiro do PDF no
   * storage e trocaria o texto completo pelo resumo pobre do perfil — o que
   * quebrava "ver currículo completo"/reprocessar após qualquer re-sync.
   */
  private async upsertCurriculoEstruturado(
    args: Prisma.CurriculoProcessadoUpsertArgs | null,
    existente: CvExistente,
  ): Promise<void> {
    if (!args) return;
    if (
      existente &&
      (existente.arquivo_url ||
        existente.parser_versao?.startsWith('claude-curriculo-'))
    ) {
      return;
    }
    await this.prisma.curriculoProcessado.upsert(args);
  }

  /**
   * Status varridos no backfill. A listagem SEM filtro da Gupy não devolve
   * rascunho/aprovação (validado em produção: sem filtro só vieram
   * published/closed/canceled; draft=539, approved=44 e waiting_approval=48
   * só saem com o filtro explícito). Varremos um status por vez.
   */
  private static readonly STATUS_SYNC = [
    'published',
    'approved',
    'waiting_approval',
    'draft',
    'frozen',
    'closed',
    'canceled',
  ] as const;

  /**
   * Sincroniza TODAS as vagas (paginado), varrendo um STATUS por vez:
   * rascunhos e aprovadas também entram (o gestor precisa ver as dele antes
   * da publicação) e vagas encerradas/canceladas na Gupy convergem em vez de
   * ficarem com status desatualizado no banco.
   * perPage 50: com fields=all as descrições HTML deixam a página pesada
   * (100 estourava o maxContentLength do client).
   * Em produção, agendamos via cron + filtramos por delta usando `gupy_sincronizado_em`.
   */
  async sincronizarTodasAsVagas(): Promise<{ total: number }> {
    let total = 0;
    const falhas: string[] = [];
    for (const status of GupyService.STATUS_SYNC) {
      try {
        for await (const v of this.client.iterarVagas({ status, perPage: 50 })) {
          const vaga = await this.prisma.vaga.upsert(paraUpsertVaga(v));
          await this.auth.vincularGestorAoSincronizar(vaga.id, vaga.gestor_email);
          total += 1;
          this.syncVagas.importadas = total; // progresso p/ quem roda em background
        }
      } catch (err) {
        // Um status inválido/indisponível na Gupy não derruba o backfill inteiro.
        falhas.push(`${status}: ${(err as Error).message}`);
        this.logger.warn(
          `Sync de vagas: status='${status}' falhou: ${(err as Error).message}`,
        );
      }
    }
    // Falha TOTAL (ex.: token inválido) precisa aparecer como erro no painel —
    // senão o usuário veria "0 importadas" como se fosse sucesso.
    if (falhas.length === GupyService.STATUS_SYNC.length) {
      throw new Error(`Todas as varreduras falharam — ${falhas[0]}`);
    }
    this.logger.log(
      `Backfill de vagas concluído: total=${total}` +
        (falhas.length ? ` (status com falha: ${falhas.length})` : ''),
    );
    return { total };
  }

  // Progresso do sync de vagas em background (in-memory; 1 instância).
  private syncVagas = {
    emAndamento: false,
    importadas: 0,
    erro: null as string | null,
  };

  statusSyncVagas() {
    return { ...this.syncVagas };
  }

  /**
   * Dispara, em BACKGROUND, a sincronização de TODAS as vagas e retorna na
   * hora — o request não fica preso atrás do timeout do proxy (nginx 504,
   * que o navegador reporta como erro de CORS). Acompanhe via `statusSyncVagas`.
   */
  iniciarSyncVagas(): { iniciado: boolean } & ReturnType<
    GupyService['statusSyncVagas']
  > {
    if (this.syncVagas.emAndamento) {
      return { iniciado: false, ...this.statusSyncVagas() };
    }
    this.syncVagas = { emAndamento: true, importadas: 0, erro: null };
    void this.sincronizarTodasAsVagas()
      .catch((err) => {
        this.syncVagas.erro = (err as Error).message;
        this.logger.error(`Sync de vagas falhou: ${(err as Error).message}`);
      })
      .finally(() => {
        this.syncVagas.emAndamento = false;
      });
    return { iniciado: true, ...this.statusSyncVagas() };
  }

  /**
   * Sincroniza candidaturas de uma vaga (paginado).
   * Enfileira o download do currículo de cada candidatura nova.
   *
   * `orcamentoCvs` (opcional) limita quantos currículos NOVOS entram na fila
   * nesta execução — os dados da candidatura são gravados de qualquer forma, só
   * o processamento pago (Claude + Voyage) é adiado. Usado pelo sync agendado
   * para nunca virar uma avalanche de processamento; sem ele o comportamento é
   * o de sempre (processa todos os novos).
   */
  async sincronizarCandidaturasDaVaga(
    gupyVagaId: bigint,
    orcamentoCvs?: { restante: number; adiados: number },
  ): Promise<{ total: number }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { gupy_id: gupyVagaId },
      select: { id: true },
    });
    if (!vaga) {
      throw new NotFoundException(
        `Vaga gupy_id=${gupyVagaId} ainda não importada. Sincronize a vaga primeiro.`,
      );
    }

    let total = 0;
    let apagados = 0;
    for await (const cand of this.client.iterarCandidaturas({ jobId: gupyVagaId })) {
      // Lápide LGPD: pula candidato, candidatura e currículo de quem já foi
      // apagado. Precisa vir ANTES do upsert — é ele que repopularia o PII.
      if (await this.candidatoApagado(cand.candidate.id)) {
        apagados += 1;
        continue;
      }

      const candidato = await this.prisma.candidato.upsert(
        paraUpsertCandidato(cand.candidate),
      );
      await this.adotarCandidaturaLocal(vaga.id, candidato.id, cand.id);
      const candidatura = await this.prisma.candidatura.upsert(
        paraUpsertCandidatura(cand, vaga.id, candidato.id),
      );

      const cvExistente = await this.buscarCvExistente(candidatura.id);

      // Currículo estruturado a partir do perfil da Gupy (fields=all).
      await this.upsertCurriculoEstruturado(
        paraUpsertCurriculoGupy(cand, candidatura.id, candidato.id),
        cvExistente,
      );

      // Só (re)enfileira o download quando há trabalho real: sem este skip,
      // cada passada do sync re-baixava → re-parseava (Claude) → re-embedava
      // (Voyage) TODAS as candidaturas (o dedupe por jobId expira em 24h).
      if (cand.resumeUrl && !GupyService.cvJaProcessado(cvExistente)) {
        if (orcamentoCvs && orcamentoCvs.restante <= 0) {
          // Teto da execução atingido: a candidatura já está gravada, o CV
          // entra na próxima rodada (a fila não guarda dívida).
          orcamentoCvs.adiados += 1;
        } else {
          await this.filaCV.add(
            'baixar-cv',
            {
              candidaturaId: candidatura.id,
              candidatoId: candidato.id,
              url: cand.resumeUrl,
            },
            {
              jobId: `cv-${candidatura.id}`, // idempotência no nível da fila
            },
          );
          if (orcamentoCvs) orcamentoCvs.restante -= 1;
        }
      }
      total += 1;
    }
    this.logger.log(
      `Candidaturas sincronizadas para vaga ${vaga.id}: total=${total}` +
        (apagados ? ` (${apagados} ignoradas — candidato apagado por LGPD)` : ''),
    );
    return { total };
  }

  // Progresso do import em massa de candidaturas (in-memory; 1 instância).
  private bulkCand = {
    emAndamento: false,
    totalVagas: 0,
    vagasProcessadas: 0,
    candidaturasImportadas: 0,
    cvsAdiados: 0,
  };

  statusBulkCandidaturas() {
    return { ...this.bulkCand };
  }

  /**
   * Dispara, em BACKGROUND, a sincronização de candidaturas de TODAS as vagas
   * já importadas. Retorna na hora; acompanhe via `statusBulkCandidaturas`.
   *
   * `tetoCvsNovos` limita o processamento pago desta execução (ver
   * `sincronizarCandidaturasDaVaga`). O sync agendado sempre passa um teto; o
   * disparo manual não passa nenhum (o usuário pediu explicitamente).
   */
  iniciarSyncCandidaturasTodas(
    opts: { tetoCvsNovos?: number } = {},
  ): { iniciado: boolean } & ReturnType<
    GupyService['statusBulkCandidaturas']
  > {
    if (this.bulkCand.emAndamento) {
      return { iniciado: false, ...this.statusBulkCandidaturas() };
    }
    this.bulkCand = {
      emAndamento: true,
      totalVagas: 0,
      vagasProcessadas: 0,
      candidaturasImportadas: 0,
      cvsAdiados: 0,
    };

    const orcamento =
      opts.tetoCvsNovos === undefined
        ? undefined
        : { restante: opts.tetoCvsNovos, adiados: 0 };

    void (async () => {
      // Só vagas "vivas": com o sync trazendo TODOS os status da Gupy, puxar
      // candidaturas de encerradas/canceladas históricas inflaria a fila de CVs
      // (download + embedding) sem valor para o fluxo atual. Atualização pontual
      // de candidatura de vaga encerrada continua chegando via webhook.
      const vagas = await this.prisma.vaga.findMany({
        where: {
          excluido_em: null,
          status: { notIn: ['ENCERRADA', 'CANCELADA'] },
        },
        select: { gupy_id: true },
      });
      this.bulkCand.totalVagas = vagas.length;
      for (const v of vagas) {
        try {
          const r = await this.sincronizarCandidaturasDaVaga(v.gupy_id, orcamento);
          this.bulkCand.candidaturasImportadas += r.total;
          if (orcamento) this.bulkCand.cvsAdiados = orcamento.adiados;
        } catch (err) {
          this.logger.warn(
            `Bulk candidaturas: vaga gupy=${v.gupy_id} falhou: ${(err as Error).message}`,
          );
        } finally {
          this.bulkCand.vagasProcessadas += 1;
        }
      }
    })()
      .catch((err) =>
        this.logger.error(`Bulk candidaturas falhou: ${(err as Error).message}`),
      )
      .finally(() => {
        this.bulkCand.emAndamento = false;
        // Truncagem NUNCA é silenciosa: se o teto adiou currículos, o log diz
        // quantos ficaram para a próxima rodada.
        const adiados = this.bulkCand.cvsAdiados;
        this.logger.log(
          `Bulk candidaturas concluído: ${this.bulkCand.candidaturasImportadas} candidatura(s) ` +
            `em ${this.bulkCand.vagasProcessadas} vaga(s)` +
            (adiados > 0 ? ` — ${adiados} currículo(s) adiado(s) pelo teto.` : '.'),
        );
      });

    return { iniciado: true, ...this.statusBulkCandidaturas() };
  }

  /**
   * Sincroniza apenas uma candidatura (usado pelo webhook).
   *
   * Devolve `id: null` quando o candidato está apagado por LGPD — o evento é
   * dado como tratado, sem erro: o webhook não deve ficar re-tentando algo que
   * decidimos deliberadamente não importar.
   */
  async sincronizarCandidatura(
    gupyId: bigint,
  ): Promise<{ id: string | null; ignorado?: 'candidato_apagado' }> {
    const cand = await this.client.obterCandidatura(gupyId);

    // A API real manda `job.id`; o campo plano `jobId` é legado/opcional.
    const jobGupyId = cand.jobId ?? cand.job?.id ?? null;
    if (jobGupyId === null) {
      throw new NotFoundException(
        `Candidatura gupy_id=${gupyId} sem vaga associada no payload.`,
      );
    }

    const vaga = await this.prisma.vaga.findUnique({
      where: { gupy_id: jobGupyId },
      select: { id: true },
    });
    if (!vaga) {
      // Não há como buscar UMA vaga na Gupy (sem GET /jobs/:id). A vaga entra
      // na próxima varredura do sync agendado, que também traz as candidaturas
      // dela — então este webhook não precisa ser recuperado.
      throw new NotFoundException(
        `Vaga gupy_id=${jobGupyId} ainda não importada — converge no próximo sync agendado`,
      );
    }

    // Lápide LGPD (ver `candidatoApagado`): quem foi apagado não volta por
    // webhook. Sem erro — o evento fica marcado como tratado.
    if (await this.candidatoApagado(cand.candidate.id)) {
      this.logger.log(
        `Candidatura gupy=${gupyId} ignorada: candidato apagado por LGPD.`,
      );
      return { id: null, ignorado: 'candidato_apagado' };
    }

    const candidato = await this.prisma.candidato.upsert(
      paraUpsertCandidato(cand.candidate),
    );
    const candidatura = await this.prisma.candidatura.upsert(
      paraUpsertCandidatura(cand, vaga.id, candidato.id),
    );

    const cvExistente = await this.buscarCvExistente(candidatura.id);

    await this.upsertCurriculoEstruturado(
      paraUpsertCurriculoGupy(cand, candidatura.id, candidato.id),
      cvExistente,
    );

    if (cand.resumeUrl && !GupyService.cvJaProcessado(cvExistente)) {
      await this.filaCV.add(
        'baixar-cv',
        {
          candidaturaId: candidatura.id,
          candidatoId: candidato.id,
          url: cand.resumeUrl,
        },
        { jobId: `cv-${candidatura.id}` },
      );
    }

    // Gatilho automático: ao entrar em CONTRATADO (passou do R&S → etapa de
    // admissão na Gupy), abre a admissão no Collab. Idempotente e sem exceção.
    if (candidatura.status === 'CONTRATADO') {
      try {
        const criou = await this.admissao.criarDeCandidaturaSeElegivel(
          candidatura.id,
        );
        if (criou) {
          this.logger.log(
            `Admissão criada automaticamente p/ candidatura ${candidatura.id} (CONTRATADO).`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Falha ao criar admissão automática p/ ${candidatura.id}: ${(err as Error).message}`,
        );
      }
    }

    return { id: candidatura.id };
  }
}
