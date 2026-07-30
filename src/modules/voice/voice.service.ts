import { Injectable } from "@nestjs/common";

import { voiceConfig } from "../../config/voice.config";
import { GeminiClassificationService } from "../../services/gemini.service";
import { UpliftAIService } from "../../services/uplift.service";

/**
 * Injectable seam over the transcription and classification clients.
 *
 * Both were module-level singletons in the old controller; keeping a single Nest
 * provider preserves that — the underlying clients are constructed once per
 * process rather than per request.
 */
@Injectable()
export class VoiceService {
  private readonly uplift = new UpliftAIService(voiceConfig.uplift_ai_api_key);

  private readonly gemini = new GeminiClassificationService(
    voiceConfig.openai_api_key,
  );

  validateAudioFile(filePath: string) {
    return this.uplift.validateAudioFile(filePath);
  }

  transcribeAudio(filePath: string) {
    return this.uplift.transcribeAudio(filePath);
  }

  classifyTransaction(text: string, categories: string[]) {
    return this.gemini.classifyTransaction(text, categories);
  }
}
