import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { WahaClient } from './waha.client.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [WahaClient],
  exports: [WahaClient],
})
export class WahaModule {}
