import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type {
  OrderStatus,
  PaymentOption,
} from '../../generated/prisma/enums.js';

const validOrderStatuses = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;

export class UpdateOrderStatusDto {
  @IsIn(validOrderStatuses)
  status!: OrderStatus;
}

export class SelectPaymentOptionDto {
  @IsIn(['DEPOSIT', 'FULL'])
  paymentOption!: PaymentOption;
}

export class OrdersPaginationDto {
  @Transform(({ value }) =>
    value === undefined ? 1 : typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @Transform(({ value }) =>
    value === undefined
      ? 20
      : typeof value === 'string'
        ? Number(value)
        : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreateOrderLineDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ArrayUnique((line: CreateOrderLineDto) => line.variantId)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  items!: CreateOrderLineDto[];
}
