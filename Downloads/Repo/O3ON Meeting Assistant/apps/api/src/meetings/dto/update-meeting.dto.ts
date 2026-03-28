import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;
}
