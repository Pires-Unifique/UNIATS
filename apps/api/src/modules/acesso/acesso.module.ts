import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AceleratoProvider } from './acelerato.provider.js';
import { ProvisaoAcessoProcessor } from './processors/provisao-acesso.processor.js';
import { ProvisaoAcessoService } from './provisao-acesso.service.js';

/**
 * Gatilho de saída para criação do usuário de AD (chamado no Acelerato hoje;
 * alvo plugável depois). Consome a fila PROVISAO_ACESSO. PrismaService é global.
 */
@Module({
  imports: [ConfigModule],
  providers: [AceleratoProvider, ProvisaoAcessoService, ProvisaoAcessoProcessor],
  exports: [ProvisaoAcessoService],
})
export class AcessoModule {}
