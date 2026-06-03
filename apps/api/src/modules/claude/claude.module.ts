import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ClaudeService } from './claude.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class ClaudeModule {}
