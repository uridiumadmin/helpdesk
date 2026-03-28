import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsEmail, IsString, MinLength } from "class-validator";
import { CurrentAuth } from "./security/auth-context.decorator";
import { AuthContext } from "./security/auth-context";
import { encodeDevToken } from "./security/dev-token";

class CreateSessionDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  password!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly configService: ConfigService) {}

  @Post("session")
  createSession(@Body() dto: CreateSessionDto) {
    if (this.configService.get<string>("AUTH_MODE") !== "development") {
      throw new ForbiddenException("Credential login is disabled when AUTH_MODE=auth0.");
    }

    const secret = this.configService.get<string>("DEV_AUTH_SECRET")?.trim();
    if (!secret) {
      throw new ForbiddenException("DEV_AUTH_SECRET must be configured for development auth.");
    }

    // USER_CREDENTIALS format: email:password|email:password|...
    // If set, each user has their own password. Falls back to DEV_AUTH_PASSWORD for all users.
    const userCredentials = this.configService.get<string>("USER_CREDENTIALS")?.trim();
    if (userCredentials) {
      const credentials = new Map<string, string>();
      for (const entry of userCredentials.split("|")) {
        const sepIndex = entry.indexOf(":");
        if (sepIndex > 0) {
          credentials.set(entry.slice(0, sepIndex).trim().toLowerCase(), entry.slice(sepIndex + 1).trim());
        }
      }
      const userPassword = credentials.get(dto.email.toLowerCase());
      if (!userPassword) {
        throw new ForbiddenException("Vaš nalog nema pristup ovoj aplikaciji.");
      }
      if (dto.password !== userPassword) {
        throw new UnauthorizedException("Pogrešna lozinka.");
      }
    } else {
      // Fallback: single password for all users
      const expectedPassword = this.configService.get<string>("DEV_AUTH_PASSWORD")?.trim();
      if (!expectedPassword || dto.password !== expectedPassword) {
        throw new UnauthorizedException("Pogrešna lozinka.");
      }
      // Check allowed users list (comma-separated emails)
      const allowedUsers = (this.configService.get<string>("ALLOWED_USERS") ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (allowedUsers.length > 0 && !allowedUsers.includes(dto.email.toLowerCase())) {
        throw new ForbiddenException("Vaš nalog nema pristup ovoj aplikaciji.");
      }
    }

    const local = {
      orgId: "org-o3on",
      userId: `dev:${dto.email.toLowerCase()}`,
      email: dto.email,
      role: "owner" as const
    };

    return {
      accessToken: encodeDevToken(local, secret),
      refreshToken: null,
      user: {
        id: local.userId,
        email: local.email,
        fullName: dto.email.split("@")[0].replace(/[._-]/g, " "),
        role: local.role
      },
      organization: {
        id: local.orgId,
        name: "O3ON"
      }
    };
  }

  @Delete("session")
  @HttpCode(204)
  dropSession() {
    return;
  }

  @Get("me")
  me(@CurrentAuth() auth: AuthContext) {
    const authMode = this.configService.get<string>("AUTH_MODE");
    const secret = this.configService.get<string>("DEV_AUTH_SECRET")?.trim();
    return {
      accessToken: authMode === "development" && secret ? encodeDevToken(auth, secret) : "",
      refreshToken: null,
      user: {
        id: auth.userId,
        email: auth.email,
        fullName: auth.email.split("@")[0].replace(/[._-]/g, " "),
        role: auth.role
      },
      organization: {
        id: auth.orgId,
        name: "O3ON"
      }
    };
  }
}
