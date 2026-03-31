import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartPairingRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nodeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  agentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  appVersion?: string;
}
