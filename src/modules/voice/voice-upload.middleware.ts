import multer from "multer";

import { AppError } from "../../utils/app-error";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      "audio/mpeg",
      "audio/mp3",
      "audio/webm",
      "audio/wav",
      "audio/ogg",
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          "Only MP3, WebM, WAV, and OGG audio files are supported",
          400,
        ),
      );
    }
  },
});

/**
 * Applied as route-scoped middleware rather than through Nest's
 * `FileInterceptor` — the interceptor rewrites Multer failures into Nest
 * HttpExceptions (e.g. `LIMIT_FILE_SIZE` becomes a 413), which would change the
 * response bodies the error handler produces for the MulterError branch.
 */
export const voiceUploadMiddleware = upload.single("file");
