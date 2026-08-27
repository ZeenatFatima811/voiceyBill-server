import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";

import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from "../../validators/auth.validator";
import { googleAuthSchema } from "../../validators/google-auth.validator";

import { AuthService } from "./auth.service";
import { CurrentUser } from "../../common/decorators/current-user.decorator";


@Controller(`${Env.BASE_PATH}/auth`)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
  ) { }

  @Post("register")
  @HttpCode(HTTPSTATUS.CREATED)
  async register(@Body() rawBody: unknown) {
    const body = registerSchema.parse(rawBody);

    const result = await this.authService.register(body);

    return {
      message: "Verification code sent to your email",
      data: result,
    };
  }

  @Post("login")
  @HttpCode(HTTPSTATUS.OK)
  async login(@Body() rawBody: Record<string, unknown>) {
    const body = loginSchema.parse({
      ...rawBody,
    });
    const { user, accessToken, refreshToken, expiresAt, reportSetting } =
      await this.authService.login(body);

    return {
      message: "User logged in successfully",
      user,
      accessToken,
      refreshToken,
      expiresAt,
      reportSetting,
    };
  }

  @Post("google")
  @HttpCode(HTTPSTATUS.OK)
  async googleAuth(@Body() rawBody: unknown) {
    const body = googleAuthSchema.parse(rawBody);

    const result = await this.authService.googleAuth(body);

    return {
      message: "User authenticated successfully with Google",
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      reportSetting: result.reportSetting,
    };
  }

  @Post("refresh-token")
  @HttpCode(HTTPSTATUS.OK)
  async refreshToken(@Body() rawBody: unknown) {
    const { refreshToken } = refreshTokenSchema.parse(rawBody);
    const result = await this.authService.refreshToken(refreshToken);

    return {
      message: "Token refreshed",
      ...result,
    };
  }

  @Post("logout")
  @HttpCode(HTTPSTATUS.NO_CONTENT)
  async logout(@CurrentUser() user: Express.User) {
    await this.authService.logout(user._id);
  }

  @Post("verify-otp")
  @HttpCode(HTTPSTATUS.OK)
  async verifyOtp(@Body() rawBody: unknown) {
    const body = verifyOtpSchema.parse(rawBody);
    const result = await this.authService.verifyOtp(body);

    return {
      message: "Email verified successfully",
      data: result,
    };
  }

  @Post("resend-otp")
  @HttpCode(HTTPSTATUS.OK)
  async resendOtp(@Body() rawBody: unknown) {
    const body = resendOtpSchema.parse(rawBody);
    const result = await this.authService.resendOtp(body);

    return {
      message: result.message,
    };
  }

  @Post("forgot-password")
  @HttpCode(HTTPSTATUS.OK)
  async forgotPassword(@Body() rawBody: unknown) {
    const body = forgotPasswordSchema.parse(rawBody);
    const result = await this.authService.forgotPassword(body);

    return {
      message: result.message,
    };
  }

  @Post("reset-password")
  @HttpCode(HTTPSTATUS.OK)
  async resetPassword(@Body() rawBody: unknown) {
    const body = resetPasswordSchema.parse(rawBody);
    const result = await this.authService.resetPassword(body);

    return {
      message: result.message,
    };
  }
}
