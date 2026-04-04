import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { ActionItem, Meeting, MeetingArtifact as ContractArtifact, Participant } from "@o3on/contracts";
import { v7 as uuidv7 } from "uuid";
import { AuthContext } from "../security/auth-context";
import { AddParticipantDto } from "./dto/add-participant.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { CreateUploadSessionDto } from "./dto/create-upload-session.dto";
import { UpdateMeetingDto } from "./dto/update-meeting.dto";
import { UploadStorageService } from "./upload-storage.service";
import { WorkerClient } from "./worker-client";
import { WorkerProcessingResult, WorkerTranscriptSegment } from "./worker-types";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";

interface StoredUpload {
  id: string;
  objectKey: string;
  expectedParts: number;
  completedAt?: string;
  filePath?: string;
  fileName?: string;
  fileSizeBytes?: number;
  contentType?: string;
  durationSeconds?: number;
}

interface StoredMeeting extends Meeting {
  orgId: string;
  createdBy: string;
  createdAt: string;
  upload?: StoredUpload;
}

@Injectable()
export class MeetingsService implements OnModuleInit {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly meetings = new Map<string, StoredMeeting>();
  private usePrisma = false;

  constructor(
    private readonly uploadStorageService: UploadStorageService,
    private readonly workerClient: WorkerClient,
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service
  ) {}

  async onModuleInit() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.usePrisma = true;
      this.logger.log("MeetingsService: using Prisma/PostgreSQL for storage.");
    } catch {
      this.usePrisma = false;
      this.logger.warn("MeetingsService: database unavailable, using in-memory Map fallback.");
    }
  }

  /** Ensure Organization and User records exist for this auth context (auto-provisioning). */
  private async ensureUserExists(auth: AuthContext): Promise<void> {
    if (!this.usePrisma) return;
    try {
      await this.prisma.organization.upsert({
        where: { id: auth.orgId },
        create: { id: auth.orgId, name: "O3ON" },
        update: {},
      });
      await this.prisma.user.upsert({
        where: { id: auth.userId },
        create: {
          id: auth.userId,
          email: auth.email,
          fullName: auth.email.split("@")[0].replace(/[._-]/g, " "),
          role: auth.role,
          orgId: auth.orgId,
        },
        update: { email: auth.email, role: auth.role },
      });
    } catch (error) {
      this.logger.warn(`Auto-provisioning user failed: ${error}`);
    }
  }

  /** When usePrisma is true, rethrow known HTTP exceptions or throw ServiceUnavailableException. */
  private rethrowOrUnavailable(context: string, error: unknown): never {
    if (
      error instanceof NotFoundException ||
      error instanceof ForbiddenException ||
      error instanceof ConflictException ||
      error instanceof ServiceUnavailableException
    ) {
      throw error;
    }
    this.logger.error(`${context}: ${error}`);
    throw new ServiceUnavailableException("Baza podataka trenutno nije dostupna. Pokušajte ponovo.");
  }

  async createMeeting(auth: AuthContext, dto: CreateMeetingDto): Promise<Meeting> {
    if (this.usePrisma) {
      try {
        await this.ensureUserExists(auth);
        const meeting = await this.prisma.meeting.create({
          data: {
            id: uuidv7(),
            title: dto.title,
            startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
            durationMinutes: dto.durationMinutes ?? 60,
            language: "sr-RS",
            status: "draft",
            orgId: auth.orgId,
            createdById: auth.userId,
            participants: {
              create: (dto.participantNames ?? []).map((name) => ({
                id: uuidv7(),
                name,
                enrollmentStatus: "pending",
              })),
            },
          },
          include: { participants: true, artifact: true },
        });
        return this.prismaToMeetingResponse(meeting);
      } catch (error) {
        this.rethrowOrUnavailable("createMeeting", error);
      }
    }

    return this.createMeetingInMemory(auth, dto);
  }

  async updateMeeting(auth: AuthContext, meetingId: string, dto: UpdateMeetingDto): Promise<Meeting> {
    if (this.usePrisma) {
      try {
        const meeting = await this.prisma.meeting.findFirst({
          where: { id: meetingId, orgId: auth.orgId, createdById: auth.userId },
        });
        if (!meeting) {
          throw new NotFoundException(`Meeting ${meetingId} was not found.`);
        }
        if (meeting.createdById !== auth.userId) {
          throw new ForbiddenException("Only the meeting owner can edit meetings.");
        }

        const data: Record<string, unknown> = {};
        if (dto.title !== undefined) data.title = dto.title;
        if (dto.startsAt !== undefined) data.startsAt = new Date(dto.startsAt);
        if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;

        const updated = await this.prisma.meeting.update({
          where: { id: meetingId },
          data,
          include: { participants: true, artifact: true },
        });
        return this.prismaToMeetingResponse(updated);
      } catch (error) {
        this.rethrowOrUnavailable("updateMeeting", error);
      }
    }

    // In-memory fallback
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.orgId !== auth.orgId) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    if (meeting.createdBy !== auth.userId) {
      throw new ForbiddenException("Only the meeting owner can edit meetings.");
    }

    if (dto.title !== undefined) meeting.title = dto.title;
    if (dto.startsAt !== undefined) meeting.startsAt = dto.startsAt;
    if (dto.durationMinutes !== undefined) meeting.durationMinutes = dto.durationMinutes;

    return this.toMeetingResponse(meeting);
  }

  async listMeetings(auth: AuthContext): Promise<Meeting[]> {
    if (this.usePrisma) {
      try {
        const meetings = await this.prisma.meeting.findMany({
          where: {
            OR: [
              { orgId: auth.orgId, createdById: auth.userId },
              { shares: { some: { sharedWithEmail: auth.email } } },
            ],
          },
          include: { participants: true, artifact: true, shares: true },
          orderBy: { createdAt: "desc" },
        });
        return meetings.map((m) => this.prismaToMeetingResponse(m));
      } catch (error) {
        if (this.usePrisma) this.rethrowOrUnavailable("listMeetings", error);
      }
    }

    return Array.from(this.meetings.values())
      .filter((meeting) => meeting.orgId === auth.orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((meeting) => this.toMeetingResponse(meeting));
  }

  async addParticipant(auth: AuthContext, meetingId: string, dto: AddParticipantDto): Promise<Participant> {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const participant = await this.prisma.participant.create({
          data: {
            id: uuidv7(),
            meetingId,
            name: dto.displayName,
            email: dto.email,
            enrollmentStatus: "pending",
          },
        });
        return {
          id: participant.id,
          meetingId: participant.meetingId,
          name: participant.name,
          email: participant.email ?? undefined,
          enrollmentStatus: participant.enrollmentStatus as "pending" | "enrolled" | "needs_retry",
        };
      } catch (error) {
        this.rethrowOrUnavailable("addParticipant", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    const participant: Participant = {
      id: uuidv7(),
      meetingId,
      name: dto.displayName,
      email: dto.email,
      enrollmentStatus: "pending",
    };
    meeting.participants.push(participant);
    return participant;
  }

  async enrollParticipant(auth: AuthContext, meetingId: string, participantId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const participant = await this.prisma.participant.findFirst({
          where: { id: participantId, meetingId },
        });
        if (!participant) {
          throw new NotFoundException(`Participant ${participantId} was not found.`);
        }
        const allParticipants = await this.prisma.participant.findMany({
          where: { meetingId },
          orderBy: { name: "asc" },
        });
        const index = allParticipants.findIndex((p) => p.id === participantId);
        const speakerLabel = `speaker-${index + 1}`;
        await this.prisma.participant.update({
          where: { id: participantId },
          data: { enrollmentStatus: "enrolled", speakerLabel },
        });
        return {
          participantId,
          speakerProfileId: uuidv7(),
          enrolledAt: new Date().toISOString(),
        };
      } catch (error) {
        this.rethrowOrUnavailable("enrollParticipant", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    const participant = meeting.participants.find((item) => item.id === participantId);
    if (!participant) {
      throw new NotFoundException(`Participant ${participantId} was not found.`);
    }
    participant.enrollmentStatus = "enrolled";
    participant.speakerLabel = `speaker-${meeting.participants.indexOf(participant) + 1}`;
    return {
      participantId,
      speakerProfileId: uuidv7(),
      enrolledAt: new Date().toISOString(),
    };
  }

  async createUploadSession(auth: AuthContext, meetingId: string, dto: CreateUploadSessionDto) {
    const uploadId = uuidv7();
    const expectedParts = dto.expectedParts ?? 1;
    const objectKey = `${auth.orgId}/${meetingId}/${uploadId}/${dto.filename ?? "recording.m4a"}`;

    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        await this.prisma.upload.create({
          data: {
            id: uploadId,
            meetingId,
            objectKey,
            expectedParts,
          },
        });
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("createUploadSession", error);
        const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
        meeting.upload = { id: uploadId, objectKey, expectedParts };
      }
    } else {
      const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
      meeting.upload = { id: uploadId, objectKey, expectedParts };
    }

    let partUrls: Array<{ partNumber: number; url: string }>;

    if (this.s3Service.isAvailable) {
      partUrls = [];
      for (let i = 0; i < expectedParts; i++) {
        const partKey = expectedParts > 1 ? `${objectKey}.part${i + 1}` : objectKey;
        const presignedUrl = await this.s3Service.getPresignedUploadUrl(
          partKey,
          "application/octet-stream"
        );
        partUrls.push({
          partNumber: i + 1,
          url: presignedUrl ?? `/v1/meetings/${meetingId}/uploads/${uploadId}/file?partNumber=${i + 1}`,
        });
      }
    } else {
      partUrls = Array.from({ length: expectedParts }, (_, index) => ({
        partNumber: index + 1,
        url: `/v1/meetings/${meetingId}/uploads/${uploadId}/file?partNumber=${index + 1}`,
      }));
    }

    return {
      uploadId,
      chunkSizeBytes: 5 * 1024 * 1024,
      uploadUrl: `/v1/meetings/${meetingId}/uploads/${uploadId}/file`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      objectKey,
      expiresInSeconds: 900,
      partUrls,
    };
  }

  async uploadMeetingFile(
    auth: AuthContext,
    meetingId: string,
    uploadId: string,
    file: Express.Multer.File
  ) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const upload = await this.prisma.upload.findFirst({
          where: { id: uploadId, meetingId },
        });
        if (!upload) {
          throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
        }

        if (this.s3Service.isAvailable) {
          try {
            const objectKey = upload.objectKey;
            await this.s3Service.putObject(
              objectKey,
              file.buffer,
              file.mimetype || "application/octet-stream"
            );
            await this.prisma.upload.update({
              where: { id: uploadId },
              data: {
                filePath: objectKey,
                fileName: file.originalname || "recording.m4a",
                fileSizeBytes: BigInt(file.buffer.byteLength),
                contentType: file.mimetype || "application/octet-stream",
              },
            });
            return {
              uploadId,
              fileName: file.originalname || "recording.m4a",
              bytesStored: file.buffer.byteLength,
            };
          } catch (s3Error) {
            this.logger.warn(`S3 upload failed in Prisma mode, falling back to local storage: ${s3Error}`);
          }
        }

        const stored = await this.uploadStorageService.saveUploadedFile({
          orgId: auth.orgId,
          meetingId,
          uploadId,
          originalName: file.originalname || "recording.m4a",
          bytes: file.buffer,
        });
        await this.prisma.upload.update({
          where: { id: uploadId },
          data: {
            filePath: stored.path,
            fileName: stored.fileName,
            fileSizeBytes: BigInt(stored.size),
            contentType: file.mimetype || "application/octet-stream",
          },
        });
        return {
          uploadId,
          fileName: stored.fileName,
          bytesStored: stored.size,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("uploadMeetingFile", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.upload || meeting.upload.id !== uploadId) {
      throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
    }

    if (this.s3Service.isAvailable) {
      try {
        const objectKey = meeting.upload.objectKey;
        await this.s3Service.putObject(objectKey, file.buffer, file.mimetype || "application/octet-stream");
        meeting.upload.filePath = objectKey;
        meeting.upload.fileName = file.originalname || "recording.m4a";
        meeting.upload.fileSizeBytes = file.buffer.byteLength;
        meeting.upload.contentType = file.mimetype || "application/octet-stream";
        return {
          uploadId,
          fileName: meeting.upload.fileName,
          bytesStored: file.buffer.byteLength,
        };
      } catch (s3Error) {
        this.logger.warn(`S3 upload failed, falling back to local storage: ${s3Error}`);
      }
    }

    const stored = await this.uploadStorageService.saveUploadedFile({
      orgId: auth.orgId,
      meetingId,
      uploadId,
      originalName: file.originalname || "recording.m4a",
      bytes: file.buffer,
    });
    meeting.upload.filePath = stored.path;
    meeting.upload.fileName = stored.fileName;
    meeting.upload.fileSizeBytes = stored.size;
    meeting.upload.contentType = file.mimetype || "application/octet-stream";
    return {
      uploadId,
      fileName: stored.fileName,
      bytesStored: stored.size,
    };
  }

  async completeUpload(
    auth: AuthContext,
    meetingId: string,
    uploadId: string,
    partEtags?: string[],
    durationSeconds?: number
  ) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const upload = await this.prisma.upload.findFirst({
          where: { id: uploadId, meetingId },
        });
        if (!upload) {
          throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
        }
        await this.prisma.upload.update({
          where: { id: uploadId },
          data: { completedAt: new Date() },
        });

        const updateData: Record<string, unknown> = { status: "processing_chunks" };
        if (durationSeconds && durationSeconds > 0) {
          updateData.durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
        }
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: updateData,
        });

        let processingJobId = uuidv7();
        if (upload.filePath && this.workerClient.autoProcess) {
          // Per-chunk progressive processing
          const existingChunkCount = await this.prisma.chunkJob.count({ where: { meetingId } });
          const chunkJob = await this.prisma.chunkJob.create({
            data: {
              id: uuidv7(),
              meetingId,
              uploadId,
              chunkIndex: existingChunkCount,
              status: "pending",
            },
          });
          processingJobId = chunkJob.id;

          // Fire-and-forget: transcribe this chunk in background
          this.transcribeChunkBackground(chunkJob.id, meetingId, uploadId, durationSeconds).catch((err) => {
            this.logger.error(`Background chunk transcription failed for meeting ${meetingId}: ${err}`);
          });
        }

        return {
          processingJobId,
          uploadId,
          partsReceived: (partEtags ?? []).length,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("completeUpload", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.upload || meeting.upload.id !== uploadId) {
      throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
    }

    meeting.upload.completedAt = new Date().toISOString();
    if (durationSeconds && durationSeconds > 0) {
      meeting.upload.durationSeconds = durationSeconds;
      meeting.durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    }
    meeting.status = "processing";

    let processingJobId = uuidv7();
    if (meeting.upload.filePath && this.workerClient.autoProcess) {
      processingJobId = await this.runWorkerPipeline(auth, meeting);
    }

    return {
      processingJobId,
      uploadId,
      partsReceived: (partEtags ?? []).length,
    };
  }

  async queueProcessing(auth: AuthContext, meetingId: string, force = false) {
    if (this.usePrisma) {
      try {
        const meeting = await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        if (meeting.status === "processing" && !force) {
          return { meetingId, status: "processing", accepted: false };
        }
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "processing" },
        });

        const upload = await this.prisma.upload.findFirst({
          where: { meetingId },
          orderBy: { completedAt: "desc" },
        });

        const processingJobId = upload?.filePath
          ? await this.runWorkerPipelinePrisma(auth, meetingId)
          : uuidv7();

        return {
          processingJobId,
          meetingId,
          accepted: true,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("queueProcessing", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (meeting.status === "processing" && !force) {
      return { meetingId, status: "processing", accepted: false };
    }

    meeting.status = "processing";
    const processingJobId = meeting.upload?.filePath
      ? await this.runWorkerPipeline(auth, meeting)
      : uuidv7();

    return {
      processingJobId,
      meetingId,
      accepted: true,
    };
  }

  async startRecording(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "recording" },
        });
        return { jobId: uuidv7() };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("startRecording", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    meeting.status = "recording";
    return { jobId: uuidv7() };
  }

  async getTranscript(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        const meeting = await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const artifact = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (artifact) {
          return {
            meetingId,
            status: meeting.status,
            segments: artifact.transcriptJson,
          };
        }
        throw new ConflictException("Transcript is not ready yet.");
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
        this.rethrowOrUnavailable("getTranscript", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (meeting.artifact) {
      return {
        meetingId,
        status: meeting.status,
        segments: meeting.artifact.transcript,
      };
    }
    throw new ConflictException("Transcript is not ready yet.");
  }

  async getArtifacts(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const artifact = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (!artifact) {
          throw new ConflictException("Meeting artifacts are not ready yet.");
        }
        return this.prismaArtifactToContract(meetingId, artifact);
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
        this.rethrowOrUnavailable("getArtifacts", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.artifact) {
      throw new ConflictException("Meeting artifacts are not ready yet.");
    }
    return meeting.artifact;
  }

  async getMeetingStatus(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        const meeting = await this.prisma.meeting.findFirst({
          where: {
            id: meetingId,
            OR: [
              { orgId: auth.orgId },
              { shares: { some: { sharedWithEmail: auth.email } } },
            ],
          },
          include: { participants: true, uploads: { orderBy: { completedAt: "desc" }, take: 1 } },
        });
        if (!meeting) {
          throw new NotFoundException(`Meeting ${meetingId} was not found.`);
        }
        const upload = meeting.uploads[0];

        // Chunk progress info
        const chunksTotal = await this.prisma.chunkJob.count({ where: { meetingId } });
        const chunksCompleted = await this.prisma.chunkJob.count({
          where: { meetingId, status: "transcribed" },
        });

        return {
          id: meeting.id,
          status: meeting.status,
          participants: meeting.participants.length,
          uploadCompletedAt: upload?.completedAt?.toISOString(),
          uploadFileName: upload?.fileName,
          processingReady: Boolean(upload?.filePath),
          chunksTotal,
          chunksCompleted,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("getMeetingStatus", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    return {
      id: meeting.id,
      status: meeting.status,
      participants: meeting.participants.length,
      uploadCompletedAt: meeting.upload?.completedAt,
      uploadFileName: meeting.upload?.fileName,
      processingReady: Boolean(meeting.upload?.filePath),
      chunksTotal: 0,
      chunksCompleted: 0,
    };
  }

  async saveActionItems(auth: AuthContext, meetingId: string, actionItems: ActionItem[]) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const existing = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (existing) {
          await this.prisma.meetingArtifact.update({
            where: { meetingId },
            data: { actionItemsJson: JSON.parse(JSON.stringify(actionItems)) },
          });
        }
        return { meetingId, count: actionItems.length };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("saveActionItems", error);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    meeting.actionItems = actionItems;
    if (meeting.artifact) {
      meeting.artifact.actionItems = actionItems;
    }
    return { meetingId, count: actionItems.length };
  }

  /* ---------- Export meeting as Markdown ---------- */

  async exportMeeting(auth: AuthContext, meetingId: string): Promise<{
    title: string;
    startsAt: string;
    markdown: string;
  }> {
    let meetingTitle: string;
    let meetingStartsAt: string;
    let artifact: ContractArtifact | null = null;
    let participantNames: string[] = [];

    if (this.usePrisma) {
      try {
        const meeting = await this.prisma.meeting.findFirst({
          where: {
            id: meetingId,
            OR: [
              { orgId: auth.orgId },
              ...(auth.email ? [{ shares: { some: { sharedWithEmail: auth.email } } }] : []),
            ],
          },
          include: { participants: true },
        });
        if (!meeting) {
          throw new NotFoundException(`Meeting ${meetingId} was not found.`);
        }
        meetingTitle = meeting.title;
        meetingStartsAt = meeting.startsAt.toISOString();
        participantNames = meeting.participants.map((p) => p.name);

        const dbArtifact = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (dbArtifact) {
          artifact = this.prismaArtifactToContract(meetingId, dbArtifact);
        }
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("exportMeeting", error);
      }
    } else {
      const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
      meetingTitle = meeting.title;
      meetingStartsAt = meeting.startsAt;
      participantNames = meeting.participants.map((p) => p.name);
      if (meeting.artifact) {
        artifact = meeting.artifact;
      }
    }

    // Build markdown
    const lines: string[] = [];
    lines.push(`# ${meetingTitle!}`);
    lines.push("");
    lines.push(`**Datum:** ${meetingStartsAt!}`);
    if (participantNames!.length > 0) {
      lines.push(`**Ucesnici:** ${participantNames!.join(", ")}`);
    }
    lines.push("");

    if (artifact) {
      if (artifact.summary) {
        lines.push("## Rezime");
        lines.push("");
        lines.push(artifact.summary);
        lines.push("");
      }

      if (artifact.decisions && artifact.decisions.length > 0) {
        lines.push("## Odluke");
        lines.push("");
        artifact.decisions.forEach((d, i) => {
          lines.push(`${i + 1}. ${d}`);
        });
        lines.push("");
      }

      if (artifact.actionItems && artifact.actionItems.length > 0) {
        lines.push("## Akcioni koraci");
        lines.push("");
        artifact.actionItems.forEach((item) => {
          const owner = item.owner ? ` (${item.owner})` : "";
          lines.push(`- [ ] ${item.title}${owner}`);
        });
        lines.push("");
      }

      if (artifact.minutes && artifact.minutes.length > 0) {
        lines.push("## Zapisnik");
        lines.push("");
        artifact.minutes.forEach((m) => {
          lines.push(`- ${m}`);
        });
        lines.push("");
      }

      if (artifact.transcript && artifact.transcript.length > 0) {
        lines.push("## Transkript");
        lines.push("");
        artifact.transcript.forEach((seg) => {
          const speaker = seg.speakerName ?? seg.speakerLabel;
          const startMin = Math.floor(seg.startMs / 60000);
          const startSec = Math.floor((seg.startMs % 60000) / 1000);
          const ts = `${String(startMin).padStart(2, "0")}:${String(startSec).padStart(2, "0")}`;
          lines.push(`**${speaker}** [${ts}]: ${seg.text}`);
          lines.push("");
        });
      }

      if (artifact.risks && artifact.risks.length > 0) {
        lines.push("## Rizici");
        lines.push("");
        artifact.risks.forEach((r) => {
          lines.push(`- ${r}`);
        });
        lines.push("");
      }

      if (artifact.openQuestions && artifact.openQuestions.length > 0) {
        lines.push("## Otvorena pitanja");
        lines.push("");
        artifact.openQuestions.forEach((q) => {
          lines.push(`- ${q}`);
        });
        lines.push("");
      }
    } else {
      lines.push("_Rezultati obrade jos nisu dostupni._");
      lines.push("");
    }

    return {
      title: meetingTitle!,
      startsAt: meetingStartsAt!,
      markdown: lines.join("\n"),
    };
  }

  /* ---------- Delete meeting ---------- */

  async deleteMeeting(auth: AuthContext, meetingId: string): Promise<{ deleted: true }> {
    if (this.usePrisma) {
      try {
        const meeting = await this.prisma.meeting.findFirst({
          where: { id: meetingId, orgId: auth.orgId, createdById: auth.userId },
        });
        if (!meeting) {
          throw new NotFoundException(`Meeting ${meetingId} was not found.`);
        }
        if (meeting.createdById !== auth.userId) {
          throw new ForbiddenException("Only the meeting owner can delete meetings.");
        }
        // All related records (participants, uploads, artifacts, shares, processing jobs)
        // are cascade-deleted by Prisma schema onDelete: Cascade.
        await this.prisma.meeting.delete({ where: { id: meetingId } });
        return { deleted: true };
      } catch (error) {
        this.rethrowOrUnavailable("deleteMeeting", error);
      }
    }

    // In-memory fallback
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.orgId !== auth.orgId) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    if (meeting.createdBy !== auth.userId) {
      throw new ForbiddenException("Only the meeting owner can delete meetings.");
    }
    this.meetings.delete(meetingId);
    return { deleted: true };
  }

  /* ---------- Sharing ---------- */

  async shareMeeting(auth: AuthContext, meetingId: string, email: string) {
    if (!this.usePrisma) {
      return { message: "Sharing requires database persistence." };
    }

    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, orgId: auth.orgId, createdById: auth.userId },
    });
    if (!meeting) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    if (meeting.createdById !== auth.userId) {
      throw new ForbiddenException("Only the meeting owner can share meetings.");
    }

    const share = await this.prisma.meetingShare.create({
      data: {
        id: uuidv7(),
        meetingId,
        sharedWithEmail: email.toLowerCase(),
        sharedByUserId: auth.userId,
      },
    });

    return {
      id: share.id,
      meetingId: share.meetingId,
      sharedWithEmail: share.sharedWithEmail,
      sharedByUserId: share.sharedByUserId,
      createdAt: share.createdAt.toISOString(),
    };
  }

  async listShares(auth: AuthContext, meetingId: string) {
    if (!this.usePrisma) {
      return [];
    }

    await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);

    const shares = await this.prisma.meetingShare.findMany({
      where: { meetingId },
      orderBy: { createdAt: "desc" },
    });

    return shares.map((s) => ({
      id: s.id,
      meetingId: s.meetingId,
      sharedWithEmail: s.sharedWithEmail,
      sharedByUserId: s.sharedByUserId,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async revokeShare(auth: AuthContext, meetingId: string, shareId: string) {
    if (!this.usePrisma) {
      return { message: "Sharing requires database persistence." };
    }

    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, orgId: auth.orgId, createdById: auth.userId },
    });
    if (!meeting) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    if (meeting.createdById !== auth.userId) {
      throw new ForbiddenException("Only the meeting owner can revoke shares.");
    }

    const share = await this.prisma.meetingShare.findFirst({
      where: { id: shareId, meetingId },
    });
    if (!share) {
      throw new NotFoundException(`Share ${shareId} was not found.`);
    }

    await this.prisma.meetingShare.delete({ where: { id: shareId } });

    return { deleted: true };
  }

  /* ---------- Audio files ---------- */

  async getAudioFiles(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const uploads = await this.prisma.upload.findMany({
          where: { meetingId },
          orderBy: { completedAt: "desc" },
        });

        const results = [];
        for (const upload of uploads) {
          let downloadUrl = `/v1/meetings/${meetingId}/audio/${upload.id}/download`;

          if (this.s3Service.isAvailable && upload.filePath && !upload.filePath.startsWith("/")) {
            const presigned = await this.s3Service.getPresignedDownloadUrl(upload.filePath);
            if (presigned) {
              downloadUrl = presigned;
            }
          }

          results.push({
            uploadId: upload.id,
            fileName: upload.fileName ?? "recording.m4a",
            fileSizeBytes: upload.fileSizeBytes ? Number(upload.fileSizeBytes) : null,
            contentType: upload.contentType ?? "audio/mp4",
            downloadUrl,
          });
        }
        return results;
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("getAudioFiles", error);
      }
    }

    // In-memory fallback
    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.upload?.filePath) {
      return [];
    }

    return [{
      uploadId: meeting.upload.id,
      fileName: meeting.upload.fileName ?? "recording.m4a",
      fileSizeBytes: meeting.upload.fileSizeBytes ?? null,
      contentType: meeting.upload.contentType ?? "audio/mp4",
      downloadUrl: `/v1/meetings/${meetingId}/audio/${meeting.upload.id}/download`,
    }];
  }

  async getAudioDownloadInfo(auth: AuthContext, meetingId: string, uploadId: string): Promise<{
    type: "local" | "s3";
    filePath?: string;
    contentType: string;
    fileName: string;
  }> {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
        const upload = await this.prisma.upload.findFirst({
          where: { id: uploadId, meetingId },
        });
        if (!upload || !upload.filePath) {
          throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
        }

        // If filePath starts with "/" it's a local file; otherwise it's an S3 key
        if (upload.filePath.startsWith("/")) {
          return {
            type: "local",
            filePath: upload.filePath,
            contentType: upload.contentType ?? "audio/mp4",
            fileName: upload.fileName ?? "recording.m4a",
          };
        }

        // S3 path — redirect to presigned URL
        if (this.s3Service.isAvailable) {
          const presigned = await this.s3Service.getPresignedDownloadUrl(upload.filePath);
          if (presigned) {
            return {
              type: "s3",
              filePath: presigned,
              contentType: upload.contentType ?? "audio/mp4",
              fileName: upload.fileName ?? "recording.m4a",
            };
          }
        }

        // S3 key stored but S3 not available — try as local fallback
        return {
          type: "local",
          filePath: upload.filePath,
          contentType: upload.contentType ?? "audio/mp4",
          fileName: upload.fileName ?? "recording.m4a",
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("getAudioDownloadInfo", error);
      }
    }

    // In-memory fallback
    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.upload || meeting.upload.id !== uploadId || !meeting.upload.filePath) {
      throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
    }

    return {
      type: "local",
      filePath: meeting.upload.filePath,
      contentType: meeting.upload.contentType ?? "audio/mp4",
      fileName: meeting.upload.fileName ?? "recording.m4a",
    };
  }

  /* ---------- Per-chunk progressive processing ---------- */

  private async transcribeChunkBackground(
    chunkJobId: string,
    meetingId: string,
    uploadId: string,
    durationSeconds?: number
  ): Promise<void> {
    try {
      // Mark chunk as transcribing
      await this.prisma.chunkJob.update({
        where: { id: chunkJobId },
        data: { status: "transcribing", startedAt: new Date() },
      });

      // Load upload, meeting, participants
      const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
      if (!upload?.filePath) {
        throw new Error(`Upload ${uploadId} has no file path.`);
      }

      const meeting = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        include: { participants: true },
      });
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found.`);
      }

      const chunkJob = await this.prisma.chunkJob.findUnique({ where: { id: chunkJobId } });
      if (!chunkJob) {
        throw new Error(`ChunkJob ${chunkJobId} not found.`);
      }

      // Load prior context from previous chunk
      let priorContext = "";
      if (chunkJob.chunkIndex > 0) {
        const prevChunk = await this.prisma.chunkJob.findFirst({
          where: { meetingId, chunkIndex: chunkJob.chunkIndex - 1, status: "transcribed" },
        });
        if (prevChunk?.transcriptJson) {
          const prevSegments = prevChunk.transcriptJson as Array<{ text?: string }>;
          const allText = prevSegments.map((s) => s.text ?? "").join(" ");
          priorContext = allText.slice(-200);
        }
      }

      const participants = meeting.participants.map((p) => ({
        id: p.id,
        name: p.name,
        speaker_label: p.speakerLabel ?? undefined,
      }));

      const result = await this.workerClient.transcribeChunk({
        meeting_id: meetingId,
        chunk_id: chunkJobId,
        title: meeting.title,
        language: "sr",
        audio_uri: upload.filePath,
        duration_seconds: durationSeconds ?? meeting.durationMinutes * 60,
        participants,
        prior_context: priorContext,
      });

      // Store transcript in ChunkJob
      await this.prisma.chunkJob.update({
        where: { id: chunkJobId },
        data: {
          status: "transcribed",
          transcriptJson: JSON.parse(JSON.stringify(result.transcript_segments)),
          completedAt: new Date(),
        },
      });

      // Check if all chunks are done
      const totalChunks = await this.prisma.chunkJob.count({ where: { meetingId } });
      const completedChunks = await this.prisma.chunkJob.count({
        where: { meetingId, status: "transcribed" },
      });

      if (completedChunks >= totalChunks) {
        // All chunks transcribed — run summarization
        this.runSummarizationBackground(meetingId).catch((err) => {
          this.logger.error(`Background summarization failed for meeting ${meetingId}: ${err}`);
        });
      }
      // Otherwise meeting stays in "processing_chunks"

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Chunk transcription error for ${chunkJobId}: ${errorMessage}`);
      try {
        await this.prisma.chunkJob.update({
          where: { id: chunkJobId },
          data: {
            status: "failed",
            errorMessage,
            completedAt: new Date(),
          },
        });
      } catch (dbErr) {
        this.logger.error(`Failed to record chunk error in DB: ${dbErr}`);
      }
    }
  }

  private async runSummarizationBackground(meetingId: string): Promise<void> {
    try {
      // Set meeting status to "summarizing"
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: "summarizing" },
      });

      // Load all completed chunk jobs ordered by chunkIndex
      const chunkJobs = await this.prisma.chunkJob.findMany({
        where: { meetingId, status: "transcribed" },
        orderBy: { chunkIndex: "asc" },
      });

      // Merge transcript segments with time offset computation
      const mergedSegments: WorkerTranscriptSegment[] = [];
      let cumulativeOffset = 0;
      for (const cj of chunkJobs) {
        const segments = (cj.transcriptJson ?? []) as Array<{
          chunk_id?: string;
          speaker_id?: string;
          speaker?: string;
          start_seconds?: number;
          start?: number;
          end_seconds?: number;
          end?: number;
          text?: string;
          confidence?: number;
        }>;

        let chunkMaxEnd = 0;
        for (const seg of segments) {
          const startSec = seg.start_seconds ?? seg.start ?? 0;
          const endSec = seg.end_seconds ?? seg.end ?? 0;
          const adjustedStart = startSec + cumulativeOffset;
          const adjustedEnd = endSec + cumulativeOffset;
          mergedSegments.push({
            chunk_id: seg.chunk_id ?? `${cj.id}-seg`,
            speaker_id: seg.speaker_id ?? seg.speaker ?? "speaker_unknown",
            start_seconds: adjustedStart,
            end_seconds: adjustedEnd,
            text: seg.text ?? "",
            confidence: seg.confidence ?? 0.8,
          });
          if (endSec > chunkMaxEnd) chunkMaxEnd = endSec;
        }
        cumulativeOffset += chunkMaxEnd;
      }

      // Load meeting and participants for summarization
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        include: { participants: true },
      });
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found.`);
      }

      const participants = meeting.participants.map((p) => ({
        id: p.id,
        name: p.name,
        speaker_label: p.speakerLabel ?? undefined,
      }));

      const result = await this.workerClient.summarizeMeeting({
        meeting_id: meetingId,
        title: meeting.title,
        language: "sr",
        transcript_segments: mergedSegments,
        participants,
        notes: "",
      });

      // Build transcript for artifact storage (same format as applyWorkerResultPrisma)
      const transcript = mergedSegments.map((seg) => {
        const participant = meeting.participants.find(
          (candidate) =>
            candidate.speakerLabel === seg.speaker_id || candidate.id === seg.speaker_id
        );
        return {
          id: seg.chunk_id,
          speakerLabel: seg.speaker_id,
          speakerName: participant?.name,
          startMs: Math.round(seg.start_seconds * 1000),
          endMs: Math.round(seg.end_seconds * 1000),
          text: seg.text,
          confidence: seg.confidence,
        };
      });

      const actionItems = (result.artifact.action_items ?? []).map((item, index) => ({
        id: `${meetingId}-action-${index + 1}`,
        title: item.task,
        owner: item.owner ?? undefined,
        dueDate: item.due_date ?? undefined,
        confidence: item.confidence,
      }));

      const minutes = (result.artifact.meeting_minutes ?? "")
        .split(/\n+/)
        .map((line: string) => line.trim())
        .filter(Boolean);

      const needsReview = (result.warnings ?? []).length > 0;

      await this.prisma.meetingArtifact.upsert({
        where: { meetingId },
        create: {
          id: uuidv7(),
          meetingId,
          summaryText: result.artifact.summary,
          transcriptJson: JSON.parse(JSON.stringify(transcript)),
          minutesJson: JSON.parse(JSON.stringify(minutes)),
          decisionsJson: JSON.parse(JSON.stringify(result.artifact.decisions ?? [])),
          risksJson: JSON.parse(JSON.stringify(result.artifact.risks ?? [])),
          openQuestionsJson: JSON.parse(JSON.stringify(result.artifact.next_steps ?? [])),
          actionItemsJson: JSON.parse(JSON.stringify(actionItems)),
          needsReview,
        },
        update: {
          summaryText: result.artifact.summary,
          transcriptJson: JSON.parse(JSON.stringify(transcript)),
          minutesJson: JSON.parse(JSON.stringify(minutes)),
          decisionsJson: JSON.parse(JSON.stringify(result.artifact.decisions ?? [])),
          risksJson: JSON.parse(JSON.stringify(result.artifact.risks ?? [])),
          openQuestionsJson: JSON.parse(JSON.stringify(result.artifact.next_steps ?? [])),
          actionItemsJson: JSON.parse(JSON.stringify(actionItems)),
          needsReview,
        },
      });

      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          status: needsReview ? "needs_review" : "ready",
          summary: result.artifact.summary,
        },
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Summarization error for meeting ${meetingId}: ${errorMessage}`);
      try {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "failed" },
        });
      } catch (dbErr) {
        this.logger.error(`Failed to record summarization error in DB: ${dbErr}`);
      }
    }
  }

  async getPartialTranscript(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);

        const totalChunks = await this.prisma.chunkJob.count({ where: { meetingId } });
        const chunkJobs = await this.prisma.chunkJob.findMany({
          where: { meetingId, status: "transcribed" },
          orderBy: { chunkIndex: "asc" },
        });

        // Merge transcript segments with time offsets
        const segments: Array<{
          speaker: string;
          text: string;
          start: number;
          end: number;
          confidence: number;
        }> = [];

        let cumulativeOffset = 0;
        for (const cj of chunkJobs) {
          const chunkSegments = (cj.transcriptJson ?? []) as Array<{
            speaker?: string;
            speaker_id?: string;
            text?: string;
            start?: number;
            start_seconds?: number;
            end?: number;
            end_seconds?: number;
            confidence?: number;
          }>;
          let chunkMaxEnd = 0;
          for (const seg of chunkSegments) {
            const startSec = seg.start ?? seg.start_seconds ?? 0;
            const endSec = seg.end ?? seg.end_seconds ?? 0;
            segments.push({
              speaker: seg.speaker ?? seg.speaker_id ?? "speaker_unknown",
              text: seg.text ?? "",
              start: startSec + cumulativeOffset,
              end: endSec + cumulativeOffset,
              confidence: seg.confidence ?? 0.8,
            });
            if (endSec > chunkMaxEnd) chunkMaxEnd = endSec;
          }
          cumulativeOffset += chunkMaxEnd;
        }

        return {
          segments,
          chunksCompleted: chunkJobs.length,
          chunksTotal: totalChunks,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.rethrowOrUnavailable("getPartialTranscript", error);
      }
    }

    // In-memory fallback: no chunk jobs in memory mode
    return { segments: [], chunksCompleted: 0, chunksTotal: 0 };
  }

  /* ---------- In-memory helpers (Map fallback) ---------- */

  private createMeetingInMemory(auth: AuthContext, dto: CreateMeetingDto): Meeting {
    const meeting: StoredMeeting = {
      id: uuidv7(),
      title: dto.title,
      startsAt: dto.startsAt ?? new Date().toISOString(),
      durationMinutes: dto.durationMinutes ?? 60,
      language: "sr-RS",
      status: "draft",
      summary: undefined,
      actionItems: [],
      orgId: auth.orgId,
      createdAt: new Date().toISOString(),
      createdBy: auth.userId,
      participants: (dto.participantNames ?? []).map((name, index) => ({
        id: uuidv7(),
        meetingId: `pending-${index}`,
        name,
        enrollmentStatus: "pending",
      })),
    };

    meeting.participants = meeting.participants.map((participant) => ({
      ...participant,
      meetingId: meeting.id,
    }));

    this.meetings.set(meeting.id, meeting);
    return this.toMeetingResponse(meeting);
  }

  private getMeetingForOrg(orgId: string, meetingId: string): StoredMeeting {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.orgId !== orgId) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    return meeting;
  }

  private toMeetingResponse(meeting: StoredMeeting): Meeting {
    return {
      id: meeting.id,
      title: meeting.title,
      startsAt: meeting.startsAt,
      durationMinutes: meeting.durationMinutes,
      language: meeting.language,
      status: meeting.status,
      participants: meeting.participants,
      summary: meeting.artifact?.summary ?? meeting.summary,
      actionItems: meeting.artifact?.actionItems ?? meeting.actionItems,
      artifact: meeting.artifact,
    };
  }

  /* ---------- Speaker mappings ---------- */

  async getSpeakerMappings(auth: AuthContext, meetingId: string) {
    if (!this.usePrisma) {
      return [];
    }
    try {
      await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
      return this.prisma.speakerMapping.findMany({
        where: { meetingId },
        select: { speakerLabel: true, displayName: true },
      });
    } catch (error) {
      this.rethrowOrUnavailable("getSpeakerMappings", error);
    }
  }

  async updateSpeakerMappings(
    auth: AuthContext,
    meetingId: string,
    mappings: Array<{ speakerLabel: string; displayName: string }>
  ) {
    if (!this.usePrisma) {
      return { updated: 0 };
    }
    try {
      await this.getPrismaMeetingForOrg(auth.orgId, meetingId, auth.email);
      for (const m of mappings) {
        await this.prisma.speakerMapping.upsert({
          where: {
            meetingId_speakerLabel: { meetingId, speakerLabel: m.speakerLabel },
          },
          create: {
            meetingId,
            speakerLabel: m.speakerLabel,
            displayName: m.displayName,
          },
          update: {
            displayName: m.displayName,
          },
        });
      }
      return { updated: mappings.length };
    } catch (error) {
      this.rethrowOrUnavailable("updateSpeakerMappings", error);
    }
  }

  /* ---------- Prisma helpers ---------- */

  private async getPrismaMeetingForOrg(orgId: string, meetingId: string, email?: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        OR: [
          { orgId },
          ...(email ? [{ shares: { some: { sharedWithEmail: email } } }] : []),
        ],
      },
    });
    if (!meeting) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    return meeting;
  }

  private prismaToMeetingResponse(meeting: {
    id: string;
    title: string;
    startsAt: Date;
    durationMinutes: number;
    language: string;
    status: string;
    summary: string | null;
    participants: Array<{
      id: string;
      meetingId: string;
      name: string;
      email: string | null;
      speakerLabel: string | null;
      enrollmentStatus: string;
    }>;
    artifact: {
      id: string;
      meetingId: string;
      summaryText: string;
      transcriptJson: unknown;
      minutesJson: unknown;
      decisionsJson: unknown;
      risksJson: unknown;
      openQuestionsJson: unknown;
      actionItemsJson: unknown;
      needsReview: boolean;
    } | null;
  }): Meeting {
    const participants: Participant[] = meeting.participants.map((p) => ({
      id: p.id,
      meetingId: p.meetingId,
      name: p.name,
      email: p.email ?? undefined,
      speakerLabel: p.speakerLabel ?? undefined,
      enrollmentStatus: p.enrollmentStatus as "pending" | "enrolled" | "needs_retry",
    }));

    let artifact: ContractArtifact | undefined;
    if (meeting.artifact) {
      artifact = this.prismaArtifactToContract(meeting.id, meeting.artifact);
    }

    return {
      id: meeting.id,
      title: meeting.title,
      startsAt: meeting.startsAt.toISOString(),
      durationMinutes: meeting.durationMinutes,
      language: meeting.language as "sr-RS",
      status: meeting.status as Meeting["status"],
      participants,
      summary: artifact?.summary ?? meeting.summary ?? undefined,
      actionItems: artifact?.actionItems,
      artifact,
    };
  }

  private prismaArtifactToContract(
    meetingId: string,
    artifact: {
      summaryText: string;
      transcriptJson: unknown;
      minutesJson: unknown;
      decisionsJson: unknown;
      risksJson: unknown;
      openQuestionsJson: unknown;
      actionItemsJson: unknown;
      needsReview: boolean;
    }
  ): ContractArtifact {
    return {
      meetingId,
      summary: artifact.summaryText,
      transcript: artifact.transcriptJson as ContractArtifact["transcript"],
      minutes: artifact.minutesJson as string[],
      decisions: artifact.decisionsJson as string[],
      risks: artifact.risksJson as string[],
      openQuestions: artifact.openQuestionsJson as string[],
      actionItems: artifact.actionItemsJson as ActionItem[],
      needsReview: artifact.needsReview,
    };
  }

  /* ---------- Worker pipeline (in-memory mode) ---------- */

  private async runWorkerPipeline(auth: AuthContext, meeting: StoredMeeting): Promise<string> {
    const upload = meeting.upload;
    if (!upload?.filePath) {
      return uuidv7();
    }

    const payload = this.buildWorkerPayload(auth, meeting.id, meeting.title, meeting.participants, upload);

    const result = await this.workerClient.processMeeting(payload);
    if (result) {
      this.applyWorkerResult(meeting, result);
    }
    return uuidv7();
  }

  /* ---------- Worker pipeline (Prisma mode) ---------- */

  private async runWorkerPipelinePrisma(
    auth: AuthContext,
    meetingId: string,
    durationSeconds?: number
  ): Promise<string> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { participants: true, uploads: { orderBy: { completedAt: "desc" }, take: 1 } },
    });
    if (!meeting) return uuidv7();

    const upload = meeting.uploads[0];
    if (!upload?.filePath) return uuidv7();

    const jobId = uuidv7();
    await this.prisma.processingJob.create({
      data: {
        id: jobId,
        meetingId,
        status: "pending",
      },
    });

    const storedUpload: StoredUpload = {
      id: upload.id,
      objectKey: upload.objectKey,
      expectedParts: upload.expectedParts,
      filePath: upload.filePath ?? undefined,
      fileName: upload.fileName ?? undefined,
      fileSizeBytes: upload.fileSizeBytes ? Number(upload.fileSizeBytes) : undefined,
      contentType: upload.contentType ?? undefined,
      durationSeconds: durationSeconds ?? meeting.durationMinutes * 60,
    };

    const contractParticipants: Participant[] = meeting.participants.map((p) => ({
      id: p.id,
      meetingId: p.meetingId,
      name: p.name,
      email: p.email ?? undefined,
      speakerLabel: p.speakerLabel ?? undefined,
      enrollmentStatus: p.enrollmentStatus as "pending" | "enrolled" | "needs_retry",
    }));

    const payload = this.buildWorkerPayload(
      auth,
      meeting.id,
      meeting.title,
      contractParticipants,
      storedUpload
    );

    // Fire-and-forget: run worker in background without awaiting
    this.executeWorkerPrisma(jobId, meetingId, contractParticipants, payload).catch((err) => {
      this.logger.error(`Background worker pipeline failed for meeting ${meetingId}: ${err}`);
    });

    return jobId;
  }

  private async executeWorkerPrisma(
    jobId: string,
    meetingId: string,
    participants: Participant[],
    payload: unknown
  ): Promise<void> {
    try {
      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: { status: "running" },
      });

      const result = await this.workerClient.processMeeting(payload);
      if (result) {
        await this.applyWorkerResultPrisma(meetingId, participants, result);
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: "completed",
            completedAt: new Date(),
            workerResultJson: JSON.parse(JSON.stringify(result)),
          },
        });
      } else {
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: { status: "completed", completedAt: new Date() },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Worker pipeline error for job ${jobId}: ${errorMessage}`);
      try {
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            completedAt: new Date(),
            errorMessage,
          },
        });
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "failed" },
        });
      } catch (dbErr) {
        this.logger.error(`Failed to record worker error in DB: ${dbErr}`);
      }
    }
  }

  private buildWorkerPayload(
    auth: AuthContext,
    meetingId: string,
    title: string,
    participants: Participant[],
    upload: StoredUpload
  ) {
    return {
      meeting_id: meetingId,
      title,
      organizer_id: auth.userId,
      language: "sr",
      notes: `tenant=${auth.orgId}`,
      audio_source: {
        source_id: upload.id,
        uri: upload.filePath,
        duration_seconds: upload.durationSeconds ?? 3600,
        language: "sr",
      },
      participants: participants.map((participant) => ({
        participant_id: participant.id,
        display_name: participant.name,
        email: participant.email ?? null,
        locale: "sr-RS",
        speaker_label: participant.speakerLabel ?? null,
      })),
      enrollments: participants
        .filter((participant) => participant.enrollmentStatus === "enrolled")
        .map((participant) => ({
          participant_id: participant.id,
          enrollment_sample_id: `${participant.id}-enrollment`,
          sample_uri: upload.filePath,
          confidence: 0.75,
        })),
      chunk_seconds: 45,
      chunk_overlap_seconds: 5,
    };
  }

  /* ---------- Apply worker result (in-memory) ---------- */

  private applyWorkerResult(meeting: StoredMeeting, result: WorkerProcessingResult): void {
    const transcript = result.transcript_segments.map((segment) => {
      const participant = meeting.participants.find(
        (candidate) =>
          candidate.speakerLabel === segment.speaker_id || candidate.id === segment.speaker_id
      );

      return {
        id: segment.chunk_id,
        speakerLabel: segment.speaker_id,
        speakerName: participant?.name,
        startMs: Math.round(segment.start_seconds * 1000),
        endMs: Math.round(segment.end_seconds * 1000),
        text: segment.text,
        confidence: segment.confidence,
      };
    });

    const actionItems = result.artifact.action_items.map((item, index) => ({
      id: `${meeting.id}-action-${index + 1}`,
      title: item.task,
      owner: item.owner ?? undefined,
      dueDate: item.due_date ?? undefined,
      confidence: item.confidence,
    }));

    // APPEND transcript segments to existing artifact (multi-chunk support)
    const existingTranscript = meeting.artifact?.transcript ?? [];
    const mergedTranscript = [...existingTranscript, ...transcript];

    const existingActionItems = meeting.artifact?.actionItems ?? [];
    const mergedActionItems = [...existingActionItems, ...actionItems];

    meeting.artifact = {
      meetingId: meeting.id,
      transcript: mergedTranscript,
      summary: result.artifact.summary,
      minutes: result.artifact.meeting_minutes
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
      decisions: Array.isArray(result.artifact.decisions) ? result.artifact.decisions : (result.artifact.decisions ? [result.artifact.decisions] : []),
      risks: Array.isArray(result.artifact.risks) ? result.artifact.risks : (result.artifact.risks ? [result.artifact.risks] : []),
      openQuestions: Array.isArray(result.artifact.next_steps) ? result.artifact.next_steps : (result.artifact.next_steps ? [result.artifact.next_steps] : []),
      actionItems: mergedActionItems,
      needsReview: (result.warnings ?? []).length > 0,
    };
    const artifact = meeting.artifact;
    meeting.summary = artifact.summary;
    meeting.actionItems = mergedActionItems;
    meeting.status = artifact.needsReview ? "needs_review" : "ready";
  }

  /* ---------- Apply worker result (Prisma) ---------- */

  private async applyWorkerResultPrisma(
    meetingId: string,
    participants: Participant[],
    result: WorkerProcessingResult
  ): Promise<void> {
    const transcript = result.transcript_segments.map((segment) => {
      const participant = participants.find(
        (candidate) =>
          candidate.speakerLabel === segment.speaker_id || candidate.id === segment.speaker_id
      );
      return {
        id: segment.chunk_id,
        speakerLabel: segment.speaker_id,
        speakerName: participant?.name,
        startMs: Math.round(segment.start_seconds * 1000),
        endMs: Math.round(segment.end_seconds * 1000),
        text: segment.text,
        confidence: segment.confidence,
      };
    });

    const actionItems = result.artifact.action_items.map((item, index) => ({
      id: `${meetingId}-action-${index + 1}`,
      title: item.task,
      owner: item.owner ?? undefined,
      dueDate: item.due_date ?? undefined,
      confidence: item.confidence,
    }));

    const minutes = result.artifact.meeting_minutes
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const needsReview = (result.warnings ?? []).length > 0;
    const status = needsReview ? "needs_review" : "ready";

    // APPEND transcript segments to existing artifact (multi-chunk support)
    const existing = await this.prisma.meetingArtifact.findUnique({ where: { meetingId } });
    const existingTranscript = existing?.transcriptJson
      ? (Array.isArray(existing.transcriptJson) ? existing.transcriptJson : [])
      : [];
    const existingActionItems = existing?.actionItemsJson
      ? (Array.isArray(existing.actionItemsJson) ? existing.actionItemsJson : [])
      : [];
    const mergedTranscript = [...(existingTranscript as unknown[]), ...transcript];
    const mergedActionItems = [...(existingActionItems as unknown[]), ...actionItems];

    await this.prisma.meetingArtifact.upsert({
      where: { meetingId },
      create: {
        id: uuidv7(),
        meetingId,
        summaryText: result.artifact.summary,
        transcriptJson: JSON.parse(JSON.stringify(mergedTranscript)),
        minutesJson: JSON.parse(JSON.stringify(minutes)),
        decisionsJson: JSON.parse(JSON.stringify(result.artifact.decisions ?? [])),
        risksJson: JSON.parse(JSON.stringify(result.artifact.risks ?? [])),
        openQuestionsJson: JSON.parse(JSON.stringify(result.artifact.next_steps ?? [])),
        actionItemsJson: JSON.parse(JSON.stringify(mergedActionItems)),
        needsReview,
      },
      update: {
        summaryText: result.artifact.summary,
        transcriptJson: JSON.parse(JSON.stringify(mergedTranscript)),
        minutesJson: JSON.parse(JSON.stringify(minutes)),
        decisionsJson: JSON.parse(JSON.stringify(result.artifact.decisions ?? [])),
        risksJson: JSON.parse(JSON.stringify(result.artifact.risks ?? [])),
        openQuestionsJson: JSON.parse(JSON.stringify(result.artifact.next_steps ?? [])),
        actionItemsJson: JSON.parse(JSON.stringify(mergedActionItems)),
        needsReview,
      },
    });

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status,
        summary: result.artifact.summary,
      },
    });
  }
}
