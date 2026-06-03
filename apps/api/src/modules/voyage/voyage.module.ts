import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { VoyageClient } from './voyage.client.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [VoyageClient],
  exports: [VoyageClient],
})
export class VoyageModule {}
