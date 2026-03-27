import { Module } from "@nestjs/common";
import { MeetingsController } from "./meetings.controller";
import { MeetingsService } from "./meetings.service";
import { UploadStorageService } from "./upload-storage.service";
import { WorkerClient } from "./worker-client";

@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService, UploadStorageService, WorkerClient]
})
export class MeetingsModule {}
