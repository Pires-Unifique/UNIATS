import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { GraphClient } from './graph.client.js';

/**
 * Microsoft Graph (app-only). Global — qualquer módulo injeta `GraphClient`
 * sem reimportar (mesmo padrão de WahaModule). Inerte sem credenciais.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [GraphClient],
  exports: [GraphClient],
})
export class GraphModule {}
