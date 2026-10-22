import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // Giới hạn riêng cho đặt hàng: tối đa 3 lần / 10 giây
  @Throttle({ default: { limit: 3, ttl: 10000 } })
  @Post()
  placeOrder(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.placeOrder(createOrderDto);
  }
}