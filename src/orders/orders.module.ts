import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { OrdersController } from './orders.controller.js';
import { OfficialBuyerContactService } from './official-buyer-contact.service.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [OrdersController],
  providers: [OfficialBuyerContactService, OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
