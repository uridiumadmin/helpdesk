import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ActionItem } from "@o3on/contracts";
import { Response } from "express";
import { createReadStream, existsSync } from "node:fs";
import { CurrentAuth } from "../security/auth-context.decorator";
import { AuthContext } from "../security/auth-context";
import { AddParticipantDto } from "./dto/add-participant.dto";
import { CompleteUploadDto } from "./dto/complete-upload.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { CreateUploadSessionDto } from "./dto/create-upload-session.dto";
import { ProcessMeetingDto } from "./dto/process-meeting.dto";
import { ShareMeetingDto } from "./dto/share-meeting.dto";
import { UpdateMeetingDto } from "./dto/update-meeting.dto";
import { MeetingsService } from "./meetings.service";

@Controller("meetings")
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  listMeetings(@CurrentAuth() auth: AuthContext) {
    return this.meetingsService.listMeetings(auth);
  }

  @Post()
  createMeeting(@CurrentAuth() auth: AuthContext, @Body() dto: CreateMeetingDto) {
    return this.meetingsService.createMeeting(auth, dto);
  }

  @Put(":meetingId")
  updateMeeting(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: UpdateMeetingDto
  ) {
    return this.meetingsService.updateMeeting(auth, meetingId, dto);
  }

  @Post(":meetingId/recording/start")
  startRecording(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.startRecording(auth, meetingId);
  }

  @Post(":meetingId/participants")
  addParticipant(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: AddParticipantDto
  ) {
    return this.meetingsService.addParticipant(auth, meetingId, dto);
  }

  @Post(":meetingId/participants/:participantId/enroll")
  enrollParticipant(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string
  ) {
    return this.meetingsService.enrollParticipant(auth, meetingId, participantId);
  }

  @Post(":meetingId/uploads/session")
  createUploadSession(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: CreateUploadSessionDto
  ) {
    return this.meetingsService.createUploadSession(auth, meetingId, dto);
  }

  @Post(":meetingId/uploads/:uploadId/file")
  @UseInterceptors(FileInterceptor("file"))
  uploadMeetingFile(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Param("uploadId") uploadId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 1024 * 1024 * 512 })
        .build({ fileIsRequired: true })
    )
    file: Express.Multer.File
  ) {
    const looksLikeMedia =
      /^(audio|video)\//.test(file.mimetype || "") ||
      /\.(m4a|mp3|wav|aac|ogg|mp4|mov|webm)$/i.test(file.originalname || "");
    if (!looksLikeMedia) {
      throw new BadRequestException("Only audio or video uploads are allowed.");
    }
    return this.meetingsService.uploadMeetingFile(auth, meetingId, uploadId, file);
  }

  @Post(":meetingId/uploads/complete")
  completeUpload(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: CompleteUploadDto
  ) {
    return this.meetingsService.completeUpload(
      auth,
      meetingId,
      dto.uploadId,
      dto.partEtags,
      dto.durationSeconds
    );
  }

  @Post(":meetingId/process")
  processMeeting(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: ProcessMeetingDto
  ) {
    return this.meetingsService.queueProcessing(auth, meetingId, dto.force);
  }

  @Get(":meetingId/status")
  getStatus(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getMeetingStatus(auth, meetingId);
  }

  @Get(":meetingId/partial-transcript")
  getPartialTranscript(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getPartialTranscript(auth, meetingId);
  }

  @Get(":meetingId/transcript")
  getTranscript(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getTranscript(auth, meetingId);
  }

  @Get(":meetingId/artifacts")
  getArtifacts(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getArtifacts(auth, meetingId);
  }

  @Get(":meetingId/export")
  async exportMeeting(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Res() res: Response
  ) {
    const { title, markdown } = await this.meetingsService.exportMeeting(auth, meetingId);
    const safeTitle = title.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().replace(/\s+/g, "_");
    res.set({
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeTitle || "meeting"}.md"`,
    });
    res.send(markdown);
  }

  @Put(":meetingId/action-items")
  saveActionItems(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body("items") items: ActionItem[]
  ) {
    return this.meetingsService.saveActionItems(auth, meetingId, items);
  }

  /* ---------- Delete ---------- */

  @Delete(":meetingId")
  @HttpCode(200)
  deleteMeeting(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string
  ) {
    return this.meetingsService.deleteMeeting(auth, meetingId);
  }

  /* ---------- Sharing ---------- */

  @Post(":meetingId/shares")
  shareMeeting(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: ShareMeetingDto
  ) {
    return this.meetingsService.shareMeeting(auth, meetingId, dto.email);
  }

  @Get(":meetingId/shares")
  listShares(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string
  ) {
    return this.meetingsService.listShares(auth, meetingId);
  }

  @Delete(":meetingId/shares/:shareId")
  @HttpCode(200)
  revokeShare(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Param("shareId") shareId: string
  ) {
    return this.meetingsService.revokeShare(auth, meetingId, shareId);
  }

  /* ---------- Audio ---------- */

  @Get(":meetingId/audio")
  getAudioFiles(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string
  ) {
    return this.meetingsService.getAudioFiles(auth, meetingId);
  }

  @Get(":meetingId/audio/:uploadId/download")
  async downloadAudio(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Param("uploadId") uploadId: string,
    @Res() res: Response
  ) {
    const info = await this.meetingsService.getAudioDownloadInfo(auth, meetingId, uploadId);

    if (info.type === "s3" && info.filePath) {
      // Redirect to S3 presigned URL
      return res.redirect(info.filePath);
    }

    // Stream local file
    if (!info.filePath || !existsSync(info.filePath)) {
      return res.status(404).json({ message: "Audio file not found on disk." });
    }

    res.set({
      "Content-Type": info.contentType,
      "Content-Disposition": `attachment; filename="${info.fileName}"`,
    });

    const stream = createReadStream(info.filePath);
    stream.pipe(res);
  }
}
