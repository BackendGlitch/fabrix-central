export class PairingStatusDto {
  status: 'pending' | 'approved' | 'expired' | 'consumed';
  expires_at: Date;
  approved_at?: Date;
  consumed_at?: Date;
}