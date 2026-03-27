import { IsBoolean, IsOptional } from "class-validator";

export class ProcessMeetingDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
