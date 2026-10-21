import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { SellerType } from '../../generated/prisma/client.js';

export class SellerApplicationDto {
  @IsIn(['INDIVIDUAL', 'BUSINESS'])
  sellerType!: SellerType;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  displayName!: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  legalName?: string;
}
