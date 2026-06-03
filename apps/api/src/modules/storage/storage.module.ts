import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { StorageService } from './storage.service.js';

/**
 * Módulo global — qualquer outro módulo pode injetar StorageService sem
 * precisar reimportar. Faz sentido porque o storage é uma dependência
 * transversal (currículos, áudios, transcrições, exportações).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
