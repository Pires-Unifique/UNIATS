import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MeetStreamClient } from './meetstream.client.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [MeetStreamClient],
  exports: [MeetStreamClient],
})
export class MeetStreamModule {}
