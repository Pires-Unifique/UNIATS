import { Module } from '@nestjs/common';

import { QuestionsController } from './questions.controller.js';
import { QuestionsService } from './questions.service.js';

/**
 * Camada 5 — Gerador de perguntas pré-entrevista.
 *
 * Service usa Claude tool-use para produzir 6-10 perguntas customizadas
 * com base em vaga + currículo estruturado. Recrutador pode editar inline
 * antes da entrevista. Tudo é versionado por `prompt_versao` em
 * `perguntas_entrevista` para auditoria.
 */
@Module({
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
