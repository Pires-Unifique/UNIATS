import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@uniats/db';
import {
  ConhecimentoEspecifico,
  PublicarVagaInput,
  PublicarVagaResultDTO,
} from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { GupyClient } from '../gupy/gupy.client.js';
import { CriarVagaGupyPayload } from '../gupy/gupy.types.js';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class VagaTemplateService {
  private readonly logger = new Logger(VagaTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gupy: GupyClient,
  ) {}

  /**
   * Arquiva o .xlsx original no object storage (auditoria, content-addressed).
   * Falha aqui é NÃO-fatal: devolve null para não bloquear a publicação.
   */
  async arquivarTemplate(file: Buffer): Promise<string | null> {
    try {
      const sha256 = createHash('sha256').update(file).digest('hex');
      const key = this.storage.buildKey({
        kind: 'template',
        sha256,
        extension: 'xlsx',
      });
      await this.storage.putObject(key, {
        body: file,
        contentType: XLSX_CONTENT_TYPE,
      });
      return sha256;
    } catch (err) {
      this.logger.warn(
        `Não foi possível arquivar o template no storage: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Cria a vaga na Gupy (rascunho), publica se solicitado e persiste a Vaga
   * local com o gupy_id retornado.
   */
  async publicar(input: PublicarVagaInput): Promise<PublicarVagaResultDTO> {
    const payload = this.montarPayloadGupy(input);
    const vagaCriada = await this.gupy.criarVaga(payload);

    if (input.publicarAgora) {
      await this.gupy.publicarVaga(vagaCriada.id);
    }

    const status = input.publicarAgora ? 'PUBLICADA' : 'RASCUNHO';
    const requisitosTexto = this.montarTextoConsolidado(input);

    const vaga = await this.prisma.vaga.create({
      data: {
        gupy_id: vagaCriada.id,
        codigo: input.code ?? vagaCriada.code ?? null,
        titulo: input.titulo,
        descricao: input.missao,
        departamento: input.departamentoNome ?? null,
        remoto: input.workplaceType === 'remote',
        tipo_contrato: input.type,
        status,
        data_publicacao: input.publicarAgora ? new Date() : null,
        requisitos_json: this.montarRequisitosJson(
          input,
        ) as unknown as Prisma.JsonObject,
        requisitos_texto: requisitosTexto,
        gupy_sincronizado_em: new Date(),
        gupy_payload: this.sanitizar(vagaCriada) as unknown as Prisma.JsonObject,
      },
      select: { id: true, gupy_id: true },
    });

    this.logger.log(
      `Vaga publicada via template (vagaId=${vaga.id}, gupyId=${vaga.gupy_id}, status=${status})`,
    );

    return {
      vagaId: vaga.id,
      gupyId: vaga.gupy_id.toString(),
      status,
    };
  }

  // ----------------------------------------------------------------
  //  Mapeamento template → Gupy
  // ----------------------------------------------------------------
  private montarPayloadGupy(input: PublicarVagaInput): CriarVagaGupyPayload {
    const payload: CriarVagaGupyPayload = {
      name: input.titulo,
      description: input.missao,
      type: input.type,
      departmentId: input.departmentId,
      roleId: input.roleId,
      hiringDeadline: input.hiringDeadline,
      numVacancies: input.numVacancies,
      publicationType: input.publicationType,
      responsibilities: this.formatarResponsabilidades(input.responsabilidades),
      prerequisites: this.montarPrerequisitos(input),
      additionalInformation: this.montarInformacoesAdicionais(input),
    };
    if (input.branchId != null) payload.branchId = input.branchId;
    if (input.workplaceType) payload.workplaceType = input.workplaceType;
    if (input.code) payload.code = input.code;
    if (input.recruiterEmail) payload.recruiterEmail = input.recruiterEmail;
    if (input.managerEmail) payload.managerEmail = input.managerEmail;
    return payload;
  }

  private formatarResponsabilidades(itens: string[]): string {
    if (!itens.length) return '';
    return itens.map((r) => `• ${r}`).join('\n');
  }

  private formatarConhecimentos(itens: ConhecimentoEspecifico[]): string {
    const grau: Record<string, string> = {
      B: 'Básico',
      I: 'Intermediário',
      A: 'Avançado',
    };
    return itens
      .map((c) => {
        const g = c.grau ? ` (${grau[c.grau] ?? c.grau})` : '';
        return `• ${c.texto}${g}`;
      })
      .join('\n');
  }

  private montarPrerequisitos(input: PublicarVagaInput): string {
    const partes: string[] = [];
    if (input.formacaoMinima) {
      partes.push(`FORMAÇÃO MÍNIMA:\n${input.formacaoMinima}`);
    }
    if (input.conhecimentos.length) {
      partes.push(
        `CONHECIMENTOS ESPECÍFICOS:\n${this.formatarConhecimentos(input.conhecimentos)}`,
      );
    }
    return partes.join('\n\n');
  }

  private montarInformacoesAdicionais(input: PublicarVagaInput): string {
    const partes: string[] = [];
    if (input.formacaoIdeal) {
      partes.push(`FORMAÇÃO IDEAL:\n${input.formacaoIdeal}`);
    }
    if (input.autonomiaParagrafos.length) {
      partes.push(
        `AUTONOMIA E COMPLEXIDADE:\n${input.autonomiaParagrafos
          .map((p) => `• ${p}`)
          .join('\n')}`,
      );
    }
    if (input.autonomiaNivel) {
      partes.push(`Nível do cargo: ${input.autonomiaNivel}`);
    }
    if (input.mensuravel != null) {
      partes.push(
        `Responsabilidade por resultados: ${
          input.mensuravel ? 'Mensurável' : 'Não mensurável'
        }`,
      );
    }
    return partes.join('\n\n');
  }

  private montarRequisitosJson(input: PublicarVagaInput): Record<string, unknown> {
    return {
      origem: 'template-dho',
      conhecimentos: input.conhecimentos,
      responsabilidades: input.responsabilidades,
      formacaoMinima: input.formacaoMinima ?? null,
      formacaoIdeal: input.formacaoIdeal ?? null,
      autonomiaNivel: input.autonomiaNivel ?? null,
      autonomiaParagrafos: input.autonomiaParagrafos,
      mensuravel: input.mensuravel ?? null,
      gupy: {
        departmentId: input.departmentId,
        roleId: input.roleId,
        branchId: input.branchId ?? null,
        type: input.type,
        numVacancies: input.numVacancies,
        hiringDeadline: input.hiringDeadline,
        workplaceType: input.workplaceType ?? null,
        publicationType: input.publicationType,
      },
      arquivoSha256: input.arquivoSha256 ?? null,
    };
  }

  /** Texto plano consolidado — alimenta embeddings/ranking (requisitos_texto). */
  private montarTextoConsolidado(input: PublicarVagaInput): string {
    return [
      input.titulo,
      input.missao,
      this.montarPrerequisitos(input),
      this.formatarResponsabilidades(input.responsabilidades),
      this.montarInformacoesAdicionais(input),
    ]
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n');
  }

  /** Converte bigint → string para gravar em coluna Json do Prisma. */
  private sanitizar(obj: unknown): unknown {
    return JSON.parse(
      JSON.stringify(obj, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    );
  }
}
