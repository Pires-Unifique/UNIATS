import { Module } from '@nestjs/common';

import { VagasController } from './vagas.controller.js';

@Module({
  controllers: [VagasController],
})
export class VagasModule {}
