import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';
import { AdmissaoService } from '../admissao/admissao.service.js';
import { AuthService } from '../auth/auth.service.js';
import { GupyClient } from './gupy.client.js';
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
    @InjectQueue(QUEUE_NAMES.GUPY_SYNC)
    private readonly filaSync: Queue,
  ) {}

  /**
   * Sincroniza UMA vaga (busca na Gupy → upsert local).
   * Idempotente — pode ser chamado N vezes.
   */
  async sincronizarVaga(gupyId: bigint): Promise<{ id: string }> {
    const vagaGupy = await this.client.obterVaga(gupyId);
    const upsert = paraUpsertVaga(vagaGupy);
    const vaga = await this.prisma.vaga.upsert(upsert);
    // Liga ao gestor que já tenha logado (se o e-mail bater e a vaga estiver sem dono).
    await this.auth.vincularGestorAoSincronizar(vaga.id, vaga.gestor_email);
    this.logger.log(`Vaga sincronizada: ${vaga.id} (gupy=${vagaGupy.id})`);
    return { id: vaga.id };
  }

  /**
   * Sincroniza TODAS as vagas (paginado), SEM filtro de status: rascunhos e
   * aprovadas também entram (o gestor precisa ver as dele antes da publicação)
   * e vagas encerradas/canceladas na Gupy convergem em vez de ficarem com
   * status desatualizado no banco.
   * Em produção, agendamos via cron + filtramos por delta usando `gupy_sincronizado_em`.
   */
  async sincronizarTodasAsVagas(): Promise<{ total: number }> {
    let total = 0;
    for await (const v of this.client.iterarVagas()) {
      const vaga = await this.prisma.vaga.upsert(paraUpsertVaga(v));
      await this.auth.vincularGestorAoSincronizar(vaga.id, vaga.gestor_email);
      total += 1;
    }
    this.logger.log(`Backfill de vagas concluído: total=${total}`);
    return { total };
  }

  /**
   * Sincroniza candidaturas de uma vaga (paginado).
   * Enfileira o download do currículo de cada candidatura nova.
   */
  async sincronizarCandidaturasDaVaga(gupyVagaId: bigint): Promise<{ total: number }> {
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
    for await (const cand of this.client.iterarCandidaturas({ jobId: gupyVagaId })) {
      const candidato = await this.prisma.candidato.upsert(
        paraUpsertCandidato(cand.candidate),
      );
      const candidatura = await this.prisma.candidatura.upsert(
        paraUpsertCandidatura(cand, vaga.id, candidato.id),
      );

      // Currículo estruturado a partir do perfil da Gupy (fields=all).
      const curriculo = paraUpsertCurriculoGupy(cand, candidatura.id, candidato.id);
      if (curriculo) await this.prisma.curriculoProcessado.upsert(curriculo);

      // Enfileira download do CV se URL disponível e ainda não baixado.
      if (cand.resumeUrl) {
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
      }
      total += 1;
    }
    this.logger.log(
      `Candidaturas sincronizadas para vaga ${vaga.id}: total=${total}`,
    );
    return { total };
  }

  // Progresso do import em massa de candidaturas (in-memory; 1 instância).
  private bulkCand = {
    emAndamento: false,
    totalVagas: 0,
    vagasProcessadas: 0,
    candidaturasImportadas: 0,
  };

  statusBulkCandidaturas() {
    return { ...this.bulkCand };
  }

  /**
   * Dispara, em BACKGROUND, a sincronização de candidaturas de TODAS as vagas
   * já importadas. Retorna na hora; acompanhe via `statusBulkCandidaturas`.
   */
  iniciarSyncCandidaturasTodas(): { iniciado: boolean } & ReturnType<
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
    };

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
          const r = await this.sincronizarCandidaturasDaVaga(v.gupy_id);
          this.bulkCand.candidaturasImportadas += r.total;
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
        this.logger.log(
          `Bulk candidaturas concluído: ${this.bulkCand.candidaturasImportadas} candidatura(s) em ${this.bulkCand.vagasProcessadas} vaga(s).`,
        );
      });

    return { iniciado: true, ...this.statusBulkCandidaturas() };
  }

  /** Sincroniza apenas uma candidatura (usado pelo webhook). */
  async sincronizarCandidatura(gupyId: bigint): Promise<{ id: string }> {
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
      // Vaga ainda não importada — enfileira a sincronização dela e re-tenta depois.
      await this.filaSync.add('sincronizar-vaga', { gupyId: jobGupyId });
      throw new NotFoundException(
        `Vaga gupy_id=${jobGupyId} ainda não importada — agendado backfill`,
      );
    }

    const candidato = await this.prisma.candidato.upsert(
      paraUpsertCandidato(cand.candidate),
    );
    const candidatura = await this.prisma.candidatura.upsert(
      paraUpsertCandidatura(cand, vaga.id, candidato.id),
    );

    const curriculo = paraUpsertCurriculoGupy(cand, candidatura.id, candidato.id);
    if (curriculo) await this.prisma.curriculoProcessado.upsert(curriculo);

    if (cand.resumeUrl) {
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
    // admissão na Gupy), abre a admissão no UniATS. Idempotente e sem exceção.
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
