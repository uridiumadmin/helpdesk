import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

@Injectable()
export class UploadStorageService {
  constructor(private readonly configService: ConfigService) {}

  private get storageRoot(): string {
    return this.configService.get<string>("MEETING_STORAGE_ROOT") ?? "./var";
  }

  async saveUploadedFile(input: {
    orgId: string;
    meetingId: string;
    uploadId: string;
    originalName: string;
    bytes: Buffer;
  }): Promise<{ path: string; fileName: string; size: number }> {
    const directory = join(this.storageRoot, "uploads", input.orgId, input.meetingId, input.uploadId);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const rawName = basename(input.originalName || "recording.m4a").replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileName = extname(rawName) ? rawName : `${rawName}.m4a`;
    const path = join(directory, fileName);

    await writeFile(path, input.bytes, { mode: 0o600 });
    return {
      path,
      fileName,
      size: input.bytes.byteLength
    };
  }
}
