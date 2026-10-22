import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderProcessor } from './order.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'order-queue',
    }),
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderProcessor],
})
export class OrderModule {}