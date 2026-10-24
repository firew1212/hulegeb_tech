import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import {
  RoleCode,
  type RequestUser,
} from '../authorization/authorization.constants.js';
import { RequireRoles } from '../authorization/roles.decorator.js';
import { AddCartItemDto, UpdateCartItemDto } from './cart.dto.js';
import { CartService } from './cart.service.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

@RequireRoles(RoleCode.BUYER)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  getCart(@CurrentUser() user: RequestUser) {
    return this.cart.getCart(user.id);
  }

  @Post('items')
  addItem(@CurrentUser() user: RequestUser, @Body() input: AddCartItemDto) {
    return this.cart.addItem(user.id, input.variantId, input.quantity);
  }

  @Patch('items/:variantId')
  updateItem(
    @CurrentUser() user: RequestUser,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() input: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(user.id, variantId, input.quantity);
  }

  @Delete('items/:variantId')
  removeItem(
    @CurrentUser() user: RequestUser,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
  ) {
    return this.cart.removeItem(user.id, variantId);
  }

  @Post('checkout')
  checkout(
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    ) {
      throw new BadRequestException(
        'The Idempotency-Key header must contain 1 to 255 letters, digits, dots, underscores, colons, or hyphens, and start with a letter or digit.',
      );
    }

    return this.cart.checkout(user.id, idempotencyKey);
  }
}
