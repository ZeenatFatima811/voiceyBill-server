import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";

import { JwtStrategy } from "../../common/strategies/jwt.strategy";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  // JwtStrategy is registered here (and exported) so Passport knows the "jwt"
  // strategy before the first request reaches a protected prefix.
  providers: [AuthService, JwtStrategy],
  exports: [JwtStrategy],
})
export class AuthModule {}
