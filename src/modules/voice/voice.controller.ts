import fs from "fs";
import os from "os";
import path from "path";

import {
  Controller,
  HttpCode,
  Inject,
  Post,
  UploadedFile,
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import { AppError } from "../../utils/app-error";
import { CategoryService } from "../category/category.service";

import { VoiceService } from "./voice.service";

@Controller(`${Env.BASE_PATH}/voice`)
export class VoiceController {
  constructor(
    @Inject(VoiceService) private readonly voiceService: VoiceService,
    @Inject(CategoryService)
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * Process a voice file and extract transaction data.
   *
   * Always answers 200: transport-level success is decoupled from processing
   * success so the mobile client can render a partial/failed transcription
   * inline. Failures are reported through `success: false` plus `data.error`.
   *
   * `file` is populated by the in-memory Multer middleware bound to this route
   * in `AppModule.configure()`.
   */
  @Post("process")
  @HttpCode(HTTPSTATUS.OK)
  async processVoiceTransaction(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    if (!file) {
      throw new AppError("No audio file provided", 400);
    }

    // Write buffer to OS temp directory to ensure writable path on serverless platforms
    const tmpDir = os.tmpdir();
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || ".webm";
    const tmpFilename = `voice-${uniqueSuffix}${ext}`;
    const tmpFilePath = path.join(tmpDir, tmpFilename);

    try {
      fs.writeFileSync(tmpFilePath, file.buffer);

      // Validate audio file
      if (!this.voiceService.validateAudioFile(tmpFilePath)) {
        throw new AppError("Invalid audio file format or size", 400);
      }

      console.log("Starting transcription...");

      // Load the user's categories (default + custom) so the AI classifies the
      // transaction into one of them instead of a hardcoded list.
      const userId = currentUser?._id;
      let userCategories: string[] = [];
      try {
        if (userId) userCategories = await this.categoryService.getNames(userId);
      } catch (err) {
        console.warn(
          "Failed to load user categories for voice classification:",
          err,
        );
      }

      // Set overall timeout for the entire process (45 seconds for Vercel Pro)
      const overallTimeout = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "Voice processing timeout - please try with shorter audio",
              ),
            ),
          45000,
        ),
      );

      const processVoice = async () => {
        const transcriptionResult =
          await this.voiceService.transcribeAudio(tmpFilePath);

        if (!transcriptionResult.text.trim()) {
          return {
            success: false,
            message: "Voice processed successfully",
            data: {
              error: "No speech detected in audio file",
            },
          };
        }

        console.log(`Transcription: ${transcriptionResult.text}`);

        console.log("Starting classification...");
        const transactionData = await this.voiceService.classifyTransaction(
          transcriptionResult.text,
          userCategories,
        );

        console.log(`Processing successful: ${transactionData.title}`);

        // Return the same format as the receipt scan endpoint
        const result = {
          title: transactionData.title,
          amount: transactionData.amount,
          date: transactionData.date,
          description: transactionData.description,
          category: transactionData.category,
          paymentMethod: transactionData.paymentMethod,
          type: transactionData.type,
          currency: transactionData.currency,
          voiceUrl: tmpFilePath, // Temporary file path on server
          transcription: transcriptionResult.text,
          confidence: transactionData.confidence,
        };

        return {
          success: true,
          message: "Voice processed successfully",
          data: result,
        };
      };

      // Race between processing and timeout. Awaited before returning so the
      // catch/finally below still apply to the losing branch.
      const result = await Promise.race([processVoice(), overallTimeout]);

      return result;
    } catch (error: any) {
      console.error("Unexpected error in voice processing:", error);

      // Handle specific timeout errors
      if (error.message.includes("timeout")) {
        return {
          success: false,
          message: "Voice processed successfully",
          data: {
            error:
              "Processing timeout - please try with shorter audio or try again",
          },
        };
      }

      return {
        success: false,
        message: "Voice processed successfully",
        data: {
          error: error.message || "Voice processing service unavailable",
        },
      };
    } finally {
      // Clean up temporary file written to OS temp dir
      try {
        if (fs.existsSync(tmpFilePath)) {
          fs.unlinkSync(tmpFilePath);
        }
      } catch (cleanupErr) {
        console.warn("Failed to clean up temp file:", cleanupErr);
      }
    }
  }
}
