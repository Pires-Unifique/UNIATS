import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AdmissaoController } from './admissao.controller.js';
import { AdmissaoService } from './admissao.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdmissaoController],
  providers: [AdmissaoService],
})
export class AdmissaoModule {}
