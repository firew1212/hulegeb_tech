import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../authorization/authorization.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProductStatus } from '../../generated/prisma/client.js';
import {
  CreateCategoryDto,
  CreateProductDto,
  CreateProductImageDto,
  CreateProductVariantDto,
  UpdateCategoryDto,
  PublicProductPaginationDto,
  UpdateProductDto,
  UpdateProductImageDto,
  UpdateProductVariantDto,
} from './catalog.dto.js';

const productStatus = {
  pendingApproval: 'PENDING_APPROVAL',
  approved: 'APPROVED',
  rejected: 'REJECTED',
} satisfies Record<'pendingApproval' | 'approved' | 'rejected', ProductStatus>;

const productDetails = {
  category: {
    select: { id: true, slug: true, nameEn: true, nameAm: true },
  },
  variants: { orderBy: { createdAt: 'asc' as const } },
  images: { orderBy: { sortOrder: 'asc' as const } },
};

const productModerationDetails = {
  ...productDetails,
  seller: {
    select: {
      id: true,
      displayName: true,
      legalName: true,
      status: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  },
};

const publicProductWhere = {
  status: productStatus.approved,
  category: { isActive: true },
  seller: {
    status: 'APPROVED',
    user: { status: 'ACTIVE' },
  },
  variants: {
    some: { isActive: true, stockQuantity: { gt: 0 } },
  },
} as const;

const publicProductSelect = {
  id: true,
  slug: true,
  titleEn: true,
  titleAm: true,
  descriptionEn: true,
  descriptionAm: true,
  condition: true,
  createdAt: true,
  category: {
    select: {
      id: true,
      slug: true,
      nameEn: true,
      nameAm: true,
      descriptionEn: true,
      descriptionAm: true,
    },
  },
  variants: {
    where: { isActive: true, stockQuantity: { gt: 0 } },
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      name: true,
      attributes: true,
      price: true,
      stockQuantity: true,
    },
  },
  images: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      imageUrl: true,
      altTextEn: true,
      altTextAm: true,
      sortOrder: true,
    },
  },
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listActiveCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        children: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        },
      },
    });
  }

  async listPublicProducts(pagination: PublicProductPaginationDto) {
    const { page, limit } = pagination;
    const where = publicProductWhere;
    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: publicProductSelect,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      data: products,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPublicProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...publicProductWhere },
      select: publicProductSelect,
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }

  listAllCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        parent: {
          select: { id: true, slug: true, nameEn: true, nameAm: true },
        },
      },
    });
  }

  async createCategory(input: CreateCategoryDto) {
    if (input.parentId) {
      await this.assertCategoryExists(input.parentId);
    }

    try {
      return await this.prisma.category.create({
        data: {
          slug: input.slug,
          nameEn: input.nameEn.trim(),
          nameAm: input.nameAm.trim(),
          descriptionEn: input.descriptionEn?.trim(),
          descriptionAm: input.descriptionAm?.trim(),
          parentId: input.parentId,
          sortOrder: input.sortOrder,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A category with this slug already exists.',
        );
      }
      throw error;
    }
  }

  async updateCategory(categoryId: string, input: UpdateCategoryDto) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one category field is required.');
    }

    const existing = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, parentId: true },
    });
    if (!existing) {
      throw new NotFoundException('Category not found.');
    }

    if (input.parentId !== undefined && input.parentId !== null) {
      await this.assertParentDoesNotCreateCycle(categoryId, input.parentId);
    }

    try {
      return await this.prisma.category.update({
        where: { id: categoryId },
        data: {
          slug: input.slug,
          nameEn: input.nameEn?.trim(),
          nameAm: input.nameAm?.trim(),
          descriptionEn: input.descriptionEn?.trim() ?? input.descriptionEn,
          descriptionAm: input.descriptionAm?.trim() ?? input.descriptionAm,
          parentId: input.parentId,
          sortOrder: input.sortOrder,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A category with this slug already exists.',
        );
      }
      throw error;
    }
  }

  async deactivateCategory(categoryId: string) {
    const updated = await this.prisma.category.updateMany({
      where: {
        id: categoryId,
        products: { none: {} },
        children: { none: {} },
      },
      data: { isActive: false },
    });
    if (updated.count === 1) {
      return this.prisma.category.findUniqueOrThrow({
        where: { id: categoryId },
      });
    }
    const categoryExists = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!categoryExists) {
      throw new NotFoundException('Category not found.');
    }
    throw new ConflictException(
      'A category with products or child categories cannot be deactivated.',
    );
  }

  listPendingProducts() {
    return this.prisma.product.findMany({
      where: { status: productStatus.pendingApproval },
      orderBy: { createdAt: 'asc' },
      include: productModerationDetails,
    });
  }

  approveProduct(productId: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          slug: true,
          titleEn: true,
          titleAm: true,
          descriptionEn: true,
          descriptionAm: true,
          status: true,
          category: { select: { isActive: true } },
          seller: { select: { status: true } },
        },
      });
      if (!product) {
        throw new NotFoundException('Product not found.');
      }
      if (product.status !== productStatus.pendingApproval) {
        throw new ConflictException('Only pending products can be approved.');
      }
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) ||
        product.slug.length > 180 ||
        !/\S/.test(product.titleEn) ||
        product.titleEn.length > 255 ||
        !/\S/.test(product.titleAm) ||
        product.titleAm.length > 255 ||
        (product.descriptionEn?.length ?? 0) > 5000 ||
        (product.descriptionAm?.length ?? 0) > 5000
      ) {
        throw new BadRequestException(
          'Product slug and English and Amharic product fields must be valid before approval.',
        );
      }
      if (!product.category.isActive) {
        throw new BadRequestException(
          'Products in inactive categories cannot be approved.',
        );
      }
      if (product.seller.status !== 'APPROVED') {
        throw new ConflictException(
          'Products from sellers without approved status cannot be approved.',
        );
      }

      const updated = await tx.product.updateMany({
        where: { id: product.id, status: productStatus.pendingApproval },
        data: { status: productStatus.approved },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Product status has changed.');
      }

      return tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: productModerationDetails,
      });
    });
  }

  rejectProduct(productId: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, status: true },
      });
      if (!product) {
        throw new NotFoundException('Product not found.');
      }
      if (product.status !== productStatus.pendingApproval) {
        throw new ConflictException('Only pending products can be rejected.');
      }

      const updated = await tx.product.updateMany({
        where: { id: product.id, status: productStatus.pendingApproval },
        data: { status: productStatus.rejected },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Product status has changed.');
      }

      return tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: productModerationDetails,
      });
    });
  }

  async createProduct(user: RequestUser, input: CreateProductDto) {
    const sellerId = await this.getApprovedSellerId(user.id);
    await this.assertActiveCategory(input.categoryId);

    try {
      return await this.prisma.product.create({
        data: {
          categoryId: input.categoryId,
          slug: input.slug,
          titleEn: input.titleEn,
          titleAm: input.titleAm,
          descriptionEn: input.descriptionEn,
          descriptionAm: input.descriptionAm,
          condition: input.condition,
          sellerId,
          status: 'PENDING_APPROVAL',
        },
        include: productDetails,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A product with this slug already exists.');
      }
      throw error;
    }
  }

  async listOwnProducts(user: RequestUser) {
    const sellerId = await this.getApprovedSellerId(user.id);
    return this.prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: productDetails,
    });
  }

  async getOwnProduct(user: RequestUser, productId: string) {
    const sellerId = await this.getApprovedSellerId(user.id);
    return this.findOwnedProduct(sellerId, productId);
  }

  async updateProduct(
    user: RequestUser,
    productId: string,
    input: UpdateProductDto,
  ) {
    const sellerId = await this.getApprovedSellerId(user.id);
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one product field is required.');
    }
    if (input.categoryId) {
      await this.assertActiveCategory(input.categoryId);
    }

    try {
      const updated = await this.prisma.product.updateMany({
        where: { id: productId, sellerId },
        data: {
          categoryId: input.categoryId,
          slug: input.slug,
          titleEn: input.titleEn,
          titleAm: input.titleAm,
          descriptionEn: input.descriptionEn,
          descriptionAm: input.descriptionAm,
          condition: input.condition,
          status: 'PENDING_APPROVAL',
        },
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Product not found.');
      }
      return this.findOwnedProduct(sellerId, productId);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A product with this slug already exists.');
      }
      throw error;
    }
  }

  async unpublishProduct(user: RequestUser, productId: string) {
    const sellerId = await this.getApprovedSellerId(user.id);
    const updated = await this.prisma.product.updateMany({
      where: { id: productId, sellerId },
      data: { status: 'UNAVAILABLE' },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Product not found.');
    }
    return this.findOwnedProduct(sellerId, productId);
  }

  async createVariant(
    user: RequestUser,
    productId: string,
    input: CreateProductVariantDto,
  ) {
    const sellerId = await this.getApprovedSellerId(user.id);
    const product = await this.findOwnedProduct(sellerId, productId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: input.sku,
            name: input.name,
            attributes: input.attributes,
            price: input.price,
            stockQuantity: input.stockQuantity ?? 0,
          },
        });
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'PENDING_APPROVAL' },
        });
        return variant;
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A product variant with this SKU exists.');
      }
      throw error;
    }
  }

  async updateVariant(
    user: RequestUser,
    productId: string,
    variantId: string,
    input: UpdateProductVariantDto,
  ) {
    const sellerId = await this.getApprovedSellerId(user.id);
    const product = await this.findOwnedProduct(sellerId, productId);
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one variant field is required.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.productVariant.updateMany({
          where: { id: variantId, productId: product.id },
          data: {
            name: input.name,
            attributes: input.attributes,
            price: input.price,
            stockQuantity: input.stockQuantity,
            isActive: input.isActive,
          },
        });
        if (updated.count !== 1) {
          throw new NotFoundException('Product variant not found.');
        }
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'PENDING_APPROVAL' },
        });
        return tx.productVariant.findUniqueOrThrow({
          where: { id: variantId },
        });
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A product variant with this SKU exists.');
      }
      throw error;
    }
  }

  async createImage(
    user: RequestUser,
    productId: string,
    input: CreateProductImageDto,
  ) {
    const sellerId = await this.getApprovedSellerId(user.id);
    const product = await this.findOwnedProduct(sellerId, productId);
    return this.prisma.$transaction(async (tx) => {
      const image = await tx.productImage.create({
        data: {
          productId: product.id,
          imageUrl: input.imageUrl,
          altTextEn: input.altTextEn,
          altTextAm: input.altTextAm,
          sortOrder: input.sortOrder,
        },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { status: 'PENDING_APPROVAL' },
      });
      return image;
    });
  }

  async updateImage(
    user: RequestUser,
    productId: string,
    imageId: string,
    input: UpdateProductImageDto,
  ) {
    const sellerId = await this.getApprovedSellerId(user.id);
    const product = await this.findOwnedProduct(sellerId, productId);
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one image field is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productImage.updateMany({
        where: { id: imageId, productId: product.id },
        data: {
          imageUrl: input.imageUrl,
          altTextEn: input.altTextEn,
          altTextAm: input.altTextAm,
          sortOrder: input.sortOrder,
        },
      });
      if (updated.count !== 1) {
        throw new NotFoundException('Product image not found.');
      }
      await tx.product.update({
        where: { id: product.id },
        data: { status: 'PENDING_APPROVAL' },
      });
      return tx.productImage.findUniqueOrThrow({ where: { id: imageId } });
    });
  }

  async removeImage(user: RequestUser, productId: string, imageId: string) {
    const sellerId = await this.getApprovedSellerId(user.id);
    const product = await this.findOwnedProduct(sellerId, productId);
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.productImage.deleteMany({
        where: { id: imageId, productId: product.id },
      });
      if (deleted.count !== 1) {
        throw new NotFoundException('Product image not found.');
      }
      await tx.product.update({
        where: { id: product.id },
        data: { status: 'PENDING_APPROVAL' },
      });
      return { deleted: true };
    });
  }

  async deactivateVariant(
    user: RequestUser,
    productId: string,
    variantId: string,
  ) {
    return this.updateVariant(user, productId, variantId, { isActive: false });
  }

  private async getApprovedSellerId(userId: string) {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (!seller || seller.status !== 'APPROVED') {
      throw new ForbiddenException('An approved seller account is required.');
    }
    return seller.id;
  }

  private async assertActiveCategory(categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Active category not found.');
    }
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Parent category not found.');
    }
  }

  private async assertParentDoesNotCreateCycle(
    categoryId: string,
    parentId: string,
  ) {
    let currentParentId: string | null = parentId;
    const visited = new Set<string>();

    while (currentParentId !== null) {
      if (currentParentId === categoryId || visited.has(currentParentId)) {
        throw new BadRequestException(
          'The selected parent would create a category cycle.',
        );
      }
      visited.add(currentParentId);

      const parentRecord: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentParentId },
          select: { parentId: true },
        });
      if (!parentRecord) {
        throw new NotFoundException('Parent category not found.');
      }
      currentParentId = parentRecord.parentId;
    }
  }

  private async findOwnedProduct(sellerId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, sellerId },
      include: productDetails,
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
