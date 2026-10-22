import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import { Public, RequireRoles } from '../authorization/roles.decorator.js';
import {
  RoleCode,
  type RequestUser,
} from '../authorization/authorization.constants.js';
import {
  CreateCategoryDto,
  CreateProductDto,
  CreateProductImageDto,
  CreateProductVariantDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateProductVariantDto,
  PublicProductPaginationDto,
} from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  listActiveCategories() {
    return this.catalog.listActiveCategories();
  }

  @Public()
  @Get('products')
  listPublicProducts(@Query() pagination: PublicProductPaginationDto) {
    return this.catalog.listPublicProducts(pagination);
  }

  @Public()
  @Get('products/:productId')
  getPublicProduct(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.catalog.getPublicProduct(productId);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Get('admin/categories')
  listAllCategories() {
    return this.catalog.listAllCategories();
  }

  @RequireRoles(RoleCode.ADMIN)
  @Post('admin/categories')
  createCategory(@Body() input: CreateCategoryDto) {
    return this.catalog.createCategory(input);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Patch('admin/categories/:categoryId')
  updateCategory(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() input: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(categoryId, input);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Patch('admin/categories/:categoryId/deactivate')
  deactivateCategory(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
  ) {
    return this.catalog.deactivateCategory(categoryId);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Get('admin/products/pending')
  listPendingProducts() {
    return this.catalog.listPendingProducts();
  }

  @RequireRoles(RoleCode.ADMIN)
  @Post('admin/products/:productId/approve')
  approveProduct(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.catalog.approveProduct(productId);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Post('admin/products/:productId/reject')
  rejectProduct(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.catalog.rejectProduct(productId);
  }

  @RequireRoles(RoleCode.SELLER)
  @Post('seller/products')
  createProduct(
    @CurrentUser() user: RequestUser,
    @Body() input: CreateProductDto,
  ) {
    return this.catalog.createProduct(user, input);
  }

  @RequireRoles(RoleCode.SELLER)
  @Get('seller/products')
  listOwnProducts(@CurrentUser() user: RequestUser) {
    return this.catalog.listOwnProducts(user);
  }

  @RequireRoles(RoleCode.SELLER)
  @Get('seller/products/:productId')
  getOwnProduct(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.catalog.getOwnProduct(user, productId);
  }

  @RequireRoles(RoleCode.SELLER)
  @Patch('seller/products/:productId')
  updateProduct(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() input: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(user, productId, input);
  }

  @RequireRoles(RoleCode.SELLER)
  @Delete('seller/products/:productId')
  unpublishProduct(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.catalog.unpublishProduct(user, productId);
  }

  @RequireRoles(RoleCode.SELLER)
  @Post('seller/products/:productId/variants')
  createVariant(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() input: CreateProductVariantDto,
  ) {
    return this.catalog.createVariant(user, productId, input);
  }

  @RequireRoles(RoleCode.SELLER)
  @Patch('seller/products/:productId/variants/:variantId')
  updateVariant(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() input: UpdateProductVariantDto,
  ) {
    return this.catalog.updateVariant(user, productId, variantId, input);
  }

  @RequireRoles(RoleCode.SELLER)
  @Delete('seller/products/:productId/variants/:variantId')
  deactivateVariant(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
  ) {
    return this.catalog.deactivateVariant(user, productId, variantId);
  }

  @RequireRoles(RoleCode.SELLER)
  @Post('seller/products/:productId/images')
  createImage(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() input: CreateProductImageDto,
  ) {
    return this.catalog.createImage(user, productId, input);
  }

  @RequireRoles(RoleCode.SELLER)
  @Patch('seller/products/:productId/images/:imageId')
  updateImage(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
    @Body() input: UpdateProductImageDto,
  ) {
    return this.catalog.updateImage(user, productId, imageId, input);
  }

  @RequireRoles(RoleCode.SELLER)
  @Delete('seller/products/:productId/images/:imageId')
  removeImage(
    @CurrentUser() user: RequestUser,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
  ) {
    return this.catalog.removeImage(user, productId, imageId);
  }
}
