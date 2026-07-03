import { Global, Module } from '@nestjs/common';

import { ConfiguracoesService } from './configuracoes.service.js';

/**
 * Configurações do sistema (chave/valor no banco, env como padrão).
 * Global — mesmo padrão de WahaModule/CryptoModule: qualquer módulo pode ler
 * uma configuração sem import explícito.
 */
@Global()
@Module({
  providers: [ConfiguracoesService],
  exports: [ConfiguracoesService],
})
export class ConfiguracoesModule {}
