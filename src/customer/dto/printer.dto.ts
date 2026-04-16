export class PrinterOptionMetadataDto {
  [key: string]: unknown;
}

export class PrinterDto {
  id!: string;
  nodeId!: string;
  displayName!: string;
  status!: 'online' | 'offline';
  activityState!: 'idle' | 'working' | 'offline';
  lastHeartbeatAt!: Date | null;
  options?: PrinterOptionMetadataDto;
}

export class ListCustomerPrintersResponseDto {
  printers!: PrinterDto[];
  count!: number;
}
