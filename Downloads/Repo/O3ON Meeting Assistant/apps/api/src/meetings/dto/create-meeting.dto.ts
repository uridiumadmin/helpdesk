import { IsArray, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateMeetingDto {
  @IsString()
  @MaxLength(140)
  title!: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantNames?: string[];
}
