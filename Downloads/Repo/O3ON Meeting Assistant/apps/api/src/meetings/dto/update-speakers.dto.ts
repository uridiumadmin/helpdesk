import { IsArray, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class SpeakerMappingItem {
  @IsString()
  speakerLabel!: string;

  @IsString()
  @MaxLength(100)
  displayName!: string;
}

export class UpdateSpeakersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeakerMappingItem)
  mappings!: SpeakerMappingItem[];
}
