import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { DevAuthGuard } from "./dev-auth.guard";
import { ProdAuthGuard } from "./prod-auth.guard";

@Global()
@Module({
  providers: [
    DevAuthGuard,
    ProdAuthGuard,
    {
      provide: APP_GUARD,
      inject: [ConfigService, DevAuthGuard, ProdAuthGuard],
      useFactory: (
        configService: ConfigService,
        devAuthGuard: DevAuthGuard,
        prodAuthGuard: ProdAuthGuard
      ) => {
        return configService.get<string>("AUTH_MODE") === "auth0" ? prodAuthGuard : devAuthGuard;
      }
    }
  ],
  exports: [DevAuthGuard, ProdAuthGuard]
})
export class SecurityModule {}
