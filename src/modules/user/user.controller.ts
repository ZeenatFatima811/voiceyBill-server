import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  UploadedFile,
} from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import {
  changePasswordSchema,
  deleteAccountSchema,
  updateUserSchema,
} from "../../validators/user.validator";

import { UserService } from "./user.service";

@Controller(`${Env.BASE_PATH}/user`)
export class UserController {
  constructor(
    @Inject(UserService) private readonly userService: UserService,
  ) {}

  @Get("current-user")
  @HttpCode(HTTPSTATUS.OK)
  async getCurrentUser(@CurrentUser() currentUser: Express.User | undefined) {
    const userId = currentUser?._id;

    const user = await this.userService.findById(userId);
    return {
      message: "User fetched successfully",
      user,
    };
  }

  /**
   * `profilePicture` is populated by the Cloudinary-backed Multer middleware
   * bound to this route in `AppModule.configure()`.
   */
  @Put("update")
  @HttpCode(HTTPSTATUS.OK)
  async updateUser(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
    @UploadedFile() profilePic: Express.Multer.File | undefined,
  ) {
    const body = updateUserSchema.parse(rawBody);
    const userId = currentUser?._id;

    const user = await this.userService.update(userId, body, profilePic);

    return {
      message: "User profile updated successfully",
      data: user,
    };
  }

  @Put("change-password")
  @HttpCode(HTTPSTATUS.OK)
  async changePassword(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const body = changePasswordSchema.parse(rawBody);
    const userId = currentUser?._id;

    return this.userService.changePassword(userId, body);
  }

  @Post("account/otp")
  @HttpCode(HTTPSTATUS.OK)
  async sendDeleteAccountOtp(
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const userId = currentUser?._id;
    await this.userService.sendDeleteAccountOtp(userId);

    return { message: "OTP sent to your registered email" };
  }

  @Delete("account")
  @HttpCode(HTTPSTATUS.OK)
  async deleteUser(
    @Body() rawBody: unknown,
    @CurrentUser() currentUser: Express.User | undefined,
  ) {
    const body = deleteAccountSchema.parse(rawBody);
    const userId = currentUser?._id;
    await this.userService.delete(userId, body);

    return { message: "User account deleted successfully" };
  }
}
