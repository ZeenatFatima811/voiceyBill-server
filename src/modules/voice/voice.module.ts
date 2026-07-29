import { Module } from "@nestjs/common";

import { CategoryModule } from "../category/category.module";

import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";

@Module({
  imports: [CategoryModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
