import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type {
  Prisma,
  ProductCondition,
} from '../../generated/prisma/client.js';

export class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  titleEn!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  titleAm!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionAm?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['NEW', 'USED', 'REFURBISHED'])
  condition?: ProductCondition;
}

export class UpdateProductDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  titleEn?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  titleAm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionAm?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['NEW', 'USED', 'REFURBISHED'])
  condition?: ProductCondition;
}

export class CreateProductVariantDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(100)
  sku!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  name!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  attributes?: Prisma.InputJsonObject;

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  price!: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}

export class UpdateProductVariantDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  attributes?: Prisma.InputJsonObject;

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  price?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateProductImageDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altTextEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altTextAm?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateProductImageDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altTextEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  altTextAm?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class CreateCategoryDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  nameAm!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  descriptionAm?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(180)
  slug?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  nameEn?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  nameAm?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(5000)
  descriptionEn?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(5000)
  descriptionAm?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  parentId?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class PublicProductPaginationDto {
  @Transform(({ value }) =>
    value === undefined ? 1 : typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(1000000)
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

  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ') || undefined
      : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  subcategoryId?: string;

  @Transform(({ value }) =>
    value === undefined
      ? undefined
      : typeof value === 'string'
        ? Number(value)
        : value,
  )
  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  minPrice?: number;

  @Transform(({ value }) =>
    value === undefined
      ? undefined
      : typeof value === 'string'
        ? Number(value)
        : value,
  )
  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  maxPrice?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['NEW', 'USED', 'REFURBISHED'])
  condition?: ProductCondition;

  @Transform(({ value }) => (value === undefined ? 'newest' : value))
  @IsIn(['newest', 'oldest', 'price_asc', 'price_desc'])
  sort: 'newest' | 'oldest' | 'price_asc' | 'price_desc' = 'newest';
}
