import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { GupyModule } from '../gupy/gupy.module.js';
import { VagaTemplateController } from './vaga-template.controller.js';
import { VagaTemplateService } from './vaga-template.service.js';

/**
 * Importação de template de vaga (DHO) + publicação na Gupy.
 * PrismaService e StorageService são providos por módulos @Global;
 * GupyClient vem do GupyModule (exportado).
 */
@Module({
  imports: [GupyModule, AuthModule],
  controllers: [VagaTemplateController],
  providers: [VagaTemplateService],
})
export class VagaTemplateModule {}
