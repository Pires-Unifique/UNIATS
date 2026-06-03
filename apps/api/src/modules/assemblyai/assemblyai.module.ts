import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AssemblyAIClient } from './assemblyai.client.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [AssemblyAIClient],
  exports: [AssemblyAIClient],
})
export class AssemblyAIModule {}
