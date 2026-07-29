import { Injectable } from "@nestjs/common";

import {
  forgotPasswordService,
  loginService,
  refreshTokenService,
  registerService,
  resendOtpService,
  resetPasswordService,
  verifyOtpService,
} from "../../services/auth.service";
import { googleAuthService } from "../../services/google-auth.service";

/**
 * Injectable seam over the existing `services/auth.service` functions.
 *
 * The migration intentionally left the business logic untouched, so these are
 * thin delegations; they exist so controllers resolve their dependencies through
 * Nest's DI container instead of importing module-level functions directly.
 */
@Injectable()
export class AuthService {
  register(body: Parameters<typeof registerService>[0]) {
    return registerService(body);
  }

  login(body: Parameters<typeof loginService>[0]) {
    return loginService(body);
  }

  refreshToken(refreshToken: string) {
    return refreshTokenService(refreshToken);
  }

  verifyOtp(body: Parameters<typeof verifyOtpService>[0]) {
    return verifyOtpService(body);
  }

  resendOtp(body: Parameters<typeof resendOtpService>[0]) {
    return resendOtpService(body);
  }

  forgotPassword(body: Parameters<typeof forgotPasswordService>[0]) {
    return forgotPasswordService(body);
  }

  resetPassword(body: Parameters<typeof resetPasswordService>[0]) {
    return resetPasswordService(body);
  }

  googleAuth(body: Parameters<typeof googleAuthService>[0]) {
    return googleAuthService(body);
  }
}
