import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @InjectQueue('order-queue') private readonly orderQueue: Queue,
  ) {}

  private readonly deductStockLuaScript = `
    local stockKey = KEYS[1]
    local quantity = tonumber(ARGV[1])

    local currentStock = redis.call('get', stockKey)
    if not currentStock then
      return -1
    end

    currentStock = tonumber(currentStock)
    if currentStock < quantity then
      return 0
    end

    redis.call('decrby', stockKey, quantity)
    return currentStock - quantity
  `;

  async placeOrder(createOrderDto: CreateOrderDto) {
    const { userId, productId, quantity } = createOrderDto;
    const redis = this.redisService.getClient();
    const stockKey = `product:stock:${productId}`;

    // 1. Chạy Lua Script trừ kho trên Redis
    const result = await redis.eval(
      this.deductStockLuaScript,
      1,
      stockKey,
      quantity,
    );

    if (result === -1) {
      throw new BadRequestException('Sản phẩm không tồn tại hoặc chưa mở bán Flash Sale');
    }

    if (result === 0) {
      throw new BadRequestException('Hàng trong kho đã hết (Out of stock)!');
    }

    // 2. Lấy giá sản phẩm
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      await redis.incrby(stockKey, quantity);
      throw new BadRequestException('Sản phẩm không hợp lệ');
    }

    const totalAmount = Number(product.price) * quantity;

    // 3. Tạo đơn hàng với trạng thái PENDING
    const order = await this.prisma.order.create({
      data: {
        userId,
        totalAmount,
        status: 'PENDING',
        items: {
          create: {
            productId,
            quantity,
            price: product.price,
          },
        },
      },
    });

    // 4. Bắn đơn hàng vào hàng đợi BullMQ để xử lý đồng bộ DB ngầm
    await this.orderQueue.add('process-order', {
      orderId: order.id,
      productId,
      quantity,
    });

    return {
      message: 'Đặt hàng thành công! Đơn hàng đã đưa vào hàng đợi xử lý.',
      orderId: order.id,
      remainingStockInRedis: result,
    };
  }
}