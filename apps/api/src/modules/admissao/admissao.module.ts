import { Module } from '@nestjs/common';

import { AdmissaoController } from './admissao.controller.js';
import { AdmissaoService } from './admissao.service.js';

@Module({
  controllers: [AdmissaoController],
  providers: [AdmissaoService],
})
export class AdmissaoModule {}
