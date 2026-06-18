import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { VagasController } from './vagas.controller.js';

@Module({
  imports: [AuthModule], // AuthGuard + escopo por papel
  controllers: [VagasController],
})
export class VagasModule {}
