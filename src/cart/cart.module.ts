import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  imports: [OrdersModule, PrismaModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
