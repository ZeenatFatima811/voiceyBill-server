import { Injectable } from "@nestjs/common";

import {
  changePasswordService,
  deleteUserService,
  findByIdUserService,
  sendDeleteAccountOtpService,
  updateUserService,
} from "../../services/user.service";

/** Injectable seam over the existing `services/user.service` functions. */
@Injectable()
export class UserService {
  findById(userId: Parameters<typeof findByIdUserService>[0]) {
    return findByIdUserService(userId);
  }

  update(
    userId: Parameters<typeof updateUserService>[0],
    body: Parameters<typeof updateUserService>[1],
    profilePic: Parameters<typeof updateUserService>[2],
  ) {
    return updateUserService(userId, body, profilePic);
  }

  changePassword(
    userId: Parameters<typeof changePasswordService>[0],
    body: Parameters<typeof changePasswordService>[1],
  ) {
    return changePasswordService(userId, body);
  }

  sendDeleteAccountOtp(
    userId: Parameters<typeof sendDeleteAccountOtpService>[0],
  ) {
    return sendDeleteAccountOtpService(userId);
  }

  delete(
    userId: Parameters<typeof deleteUserService>[0],
    body: Parameters<typeof deleteUserService>[1],
  ) {
    return deleteUserService(userId, body);
  }
}
