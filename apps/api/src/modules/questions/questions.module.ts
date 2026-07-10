import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PerguntasPadraoController } from './perguntas-padrao.controller.js';
import { PerguntasPadraoService } from './perguntas-padrao.service.js';
import { QuestionsController } from './questions.controller.js';
import { QuestionsService } from './questions.service.js';
import { RespostasController } from './respostas.controller.js';
import { RespostasEntrevistaService } from './respostas-entrevista.service.js';

/**
 * Camada 5 — Perguntas de entrevista + análise de respostas.
 *
 * Perguntas: geradas por Claude (vaga × currículo) OU cadastradas pelo time
 * (origem HUMANO), mais o banco de perguntas PADRÃO do DHO (cultura etc.).
 * Pós-reunião, RespostasEntrevistaService confronta o roteiro com o texto
 * final de falas e grava o que o candidato respondeu (sugestão IA, com
 * citação literal como evidência). Tudo versionado por `prompt_versao`.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    QuestionsController,
    PerguntasPadraoController,
    RespostasController,
  ],
  providers: [QuestionsService, PerguntasPadraoService, RespostasEntrevistaService],
  exports: [QuestionsService, RespostasEntrevistaService],
})
export class QuestionsModule {}
