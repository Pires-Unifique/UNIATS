import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { SistemaController } from './sistema.controller.js';
import { SistemaService } from './sistema.service.js';

/** Seção Sistema — operação (status/QR/restart do WAHA). WahaModule é @Global. */
@Module({
  imports: [AuthModule],
  controllers: [SistemaController],
  providers: [SistemaService],
})
export class SistemaModule {}
