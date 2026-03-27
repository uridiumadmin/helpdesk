import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("Connected to database.");
    } catch (error) {
      this.logger.warn("Database connection failed; storage will use in-memory fallback.");
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
