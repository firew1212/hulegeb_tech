import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Headers,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import {
  RoleCode,
  type RequestUser,
} from '../authorization/authorization.constants.js';
import { RequireRoles } from '../authorization/roles.decorator.js';
import {
  CreateOrderDto,
  OrdersPaginationDto,
  SelectPaymentOptionDto,
  UpdateOrderStatusDto,
} from './orders.dto.js';
import { OfficialBuyerContactService } from './official-buyer-contact.service.js';
import { OrdersService } from './orders.service.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly officialBuyerContact: OfficialBuyerContactService,
  ) {}

  @RequireRoles(RoleCode.ADMIN)
  @Get('admin')
  listAdminOrders(@Query() pagination: OrdersPaginationDto) {
    return this.orders.listAdminOrders(pagination);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Get('admin/:id')
  getAdminOrder(@Param('id', new ParseUUIDPipe()) orderId: string) {
    return this.orders.getAdminOrder(orderId);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Post('admin/:id/confirm-stock')
  confirmAdminOrderStock(@Param('id', new ParseUUIDPipe()) orderId: string) {
    return this.orders.confirmAdminOrderStock(orderId);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Patch('admin/:id/status')
  updateAdminOrderStatus(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() input: UpdateOrderStatusDto,
  ) {
    return this.orders.updateAdminOrderStatus(orderId, input.status);
  }

  @RequireRoles(RoleCode.BUYER)
  @Get('contact')
  async getOfficialBuyerContact(
    @CurrentUser() user: RequestUser,
    @Query('orderId', new ParseUUIDPipe()) orderId: string,
  ) {
    const order = await this.orders.getBuyerOrder(user.id, orderId);
    if (!order.paymentOption) {
      throw new ConflictException(
        'Select a payment option before accessing admin contact information.',
      );
    }
    return this.officialBuyerContact.getContact();
  }

  @RequireRoles(RoleCode.BUYER)
  @Get()
  listBuyerOrders(
    @CurrentUser() user: RequestUser,
    @Query() pagination: OrdersPaginationDto,
  ) {
    return this.orders.listBuyerOrders(user.id, pagination);
  }

  @RequireRoles(RoleCode.BUYER)
  @Get(':id')
  getBuyerOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) orderId: string,
  ) {
    return this.orders.getBuyerOrder(user.id, orderId);
  }

  @RequireRoles(RoleCode.BUYER)
  @Patch(':id/payment')
  selectBuyerPaymentOption(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() input: SelectPaymentOptionDto,
  ) {
    return this.orders.selectBuyerPaymentOption(
      user.id,
      orderId,
      input.paymentOption,
    );
  }

  @RequireRoles(RoleCode.BUYER)
  @Post()
  createOrder(
    @CurrentUser() user: RequestUser,
    @Body() input: CreateOrderDto,
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

    return this.orders.createOrder(user.id, input, idempotencyKey);
  }
}
