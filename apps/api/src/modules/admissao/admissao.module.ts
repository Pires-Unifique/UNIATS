import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AdmissaoController } from './admissao.controller.js';
import { AdmissaoService } from './admissao.service.js';
import { RgOcrProcessor } from './processors/rg-ocr.processor.js';

// StorageService, ClaudeService e as filas (RG_OCR/PROVISAO_ACESSO) são globais.
@Module({
  imports: [AuthModule],
  controllers: [AdmissaoController],
  providers: [AdmissaoService, RgOcrProcessor],
})
export class AdmissaoModule {}
