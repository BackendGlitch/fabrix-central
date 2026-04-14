import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateAgentNameDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;
}
